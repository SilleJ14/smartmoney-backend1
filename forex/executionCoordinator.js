import { classifyPositionEffect, isOpeningRisk } from "./identity.js";
import { mayAutoExecute } from "./approvalRegistry.js";
import { canOpenRisk, permittedUnits, FOREX_RISK_LIMITS } from "./riskManager.js";
import { conversionLossPerUnit } from "./instrumentSpecs.js";
import { spreadChecks } from "./spreadCost.js";
import { chasedAway, entryExpired, stopDistanceOk } from "./strategyExits.js";
import { calendarForDecision } from "./calendarFeed.js";

function blocked(reason, extra = {}) {
  return { ok: false, state: "BLOCKED", reason, ...extra };
}

export function createExecutionCoordinator({
  adapter,
  registry,
  store,
  instanceId = "local",
} = {}) {
  if (!adapter) throw new Error("BROKER_ADAPTER_REQUIRED");

  async function submit(plan) {
    const durable = store?.isDurable?.() === true;
    if (!durable) return blocked("DURABLE_STORAGE_UNAVAILABLE");
    if (plan?.overridePermissions || plan?.aiDirective) return blocked("UNTRUSTED_INPUT");
    if (!plan?.executionReady) return blocked("EXECUTION_NOT_READY");
    if (plan.incidentLockActive || plan.pauseEntries) return blocked("INCIDENT_LOCK");
    if (adapter.liveHost || plan.environment === "LIVE") return blocked("LIVE_BLOCKED");

    const reducing = plan.positionFill === "REDUCE_ONLY" || plan.intent === "close";
    if (!reducing) {
      if (plan.intent === "automatic" && !plan.autoTradingAuthorized) {
        return blocked("STRATEGY_NOT_APPROVED");
      }
      if (plan.intent === "automatic" && !mayAutoExecute(registry, plan.strategyId, plan.environment || "FORWARD_PRACTICE")) {
        return blocked("STRATEGY_NOT_APPROVED");
      }
      const calendar = calendarForDecision(plan.calendar, { now: plan.now });
      if (plan.intent === "automatic" && calendar.ok !== true) return blocked(calendar.reason || "CALENDAR_UNAVAILABLE");
      if (plan.quoteOk !== true) return blocked("QUOTE_STALE");
      if (plan.confirmedAt && entryExpired({ confirmedAt: plan.confirmedAt, now: plan.now })) {
        return blocked("ENTRY_EXPIRED");
      }
      if (chasedAway({
        side: plan.direction === "sell" || Number(plan.units) < 0 ? "sell" : "buy",
        confirmationPrice: plan.confirmationPrice,
        currentPrice: plan.worstEntryPrice,
        A: plan.A,
      }) && plan.confirmationPrice) {
        return blocked("CHASED_PRICE");
      }
    }

    const effect = classifyPositionEffect({
      currentUnits: plan.currentUnits,
      orderUnits: plan.units,
    });
    if (!reducing && isOpeningRisk(effect) && oneOpenOnPair(plan)) {
      return blocked("SCALE_IN_DISABLED", { effect });
    }
    if (reducing && isOpeningRisk(effect)) {
      return blocked("CLOSE_WOULD_OPEN", { effect });
    }

    if (isOpeningRisk(effect)) {
      const lossPerUnit = conversionLossPerUnit({
        worstEntry: plan.worstEntryPrice,
        stop: plan.stop,
        conversionFactor: plan.conversionFactor || 1,
        costAllowance: plan.costAllowance,
      });
      const size = permittedUnits({
        allowedRisk: plan.allowedRisk,
        worstEntry: plan.worstEntryPrice,
        stop: plan.stop,
        costAllowance: plan.costAllowance,
        instrument: plan.instrument,
        conversionFactor: plan.conversionFactor,
      });
      if (!(size >= Math.abs(plan.units)) || !(lossPerUnit > 0)) {
        return blocked("INSUFFICIENT_MARGIN", { effect });
      }
      const risk = canOpenRisk({
        effect,
        remainingDailyRisk: plan.remainingDailyRisk,
        plannedRisk: plan.plannedRiskPercent,
        openPlusPending: plan.openPlusPendingPercent,
        sameDirection: plan.sameDirectionPercent,
      });
      if (!risk.ok) return blocked(risk.reason, { effect });
      if (!stopDistanceOk({ entry: plan.worstEntryPrice, stop: plan.stop, A: plan.A })) {
        return blocked("STOP_DISTANCE", { effect });
      }
      const spread = spreadChecks({
        bid: plan.bid,
        ask: plan.ask,
        stopDistance: Math.abs(Number(plan.worstEntryPrice) - Number(plan.stop)),
        absoluteLimit: plan.instrument?.absoluteSpreadLimit,
        targetDistance: Math.abs(Number(plan.takeProfitOnFill) - Number(plan.worstEntryPrice)),
        costs: plan.costAllowance,
      });
      if (!spread.ok) return blocked(spread.reason, { effect });
      const buffer = FOREX_RISK_LIMITS.marginBufferPercent / 100;
      if (Number(plan.marginAvailable) >= 0 && Number(plan.requiredMargin) > Number(plan.marginAvailable) * (1 - buffer)) {
        return blocked("INSUFFICIENT_MARGIN", { effect });
      }
      if (!plan.priceBound || !plan.stopLossOnFill) return blocked("MISSING_PROTECTION", { effect });
    }

    const intentId = plan.intentId || `fx-${Date.now()}`;
    try {
      await store.commit((ledger) => {
        if (ledger.owner && ledger.owner.instanceId !== instanceId) {
          throw Object.assign(new Error("NOT_EXECUTION_OWNER"), { reason: "NOT_EXECUTION_OWNER" });
        }
        const duplicate = ledger.intents.some((row) => (
          row.clientRequestId && row.clientRequestId === plan.clientRequestId && row.state !== "REJECTED"
        ));
        if (duplicate) throw Object.assign(new Error("DUPLICATE_INTENT"), { reason: "DUPLICATE_INTENT" });
        ledger.intents.push({
          intentId,
          accountId: plan.accountId,
          instrumentId: plan.instrumentId,
          units: plan.units,
          state: "INTENT_SAVED",
          clientRequestId: plan.clientRequestId,
          strategyId: plan.strategyId,
          candidateId: plan.candidateId,
        });
        ledger.reservations.push({
          intentId,
          risk: plan.plannedRiskPercent,
          expiresAt: plan.expiresAt,
          state: "RESERVED",
        });
      });
    } catch (error) {
      return blocked(error.reason || "DURABLE_STORAGE_UNAVAILABLE");
    }

    try {
      const response = reducing && plan.brokerTradeId && adapter.closeTrade
        ? await adapter.closeTrade(plan.brokerTradeId)
        : await adapter.createMarketOrder({
          instrument: plan.instrumentId,
          units: plan.units,
          priceBound: plan.priceBound,
          stopLossPrice: plan.stopLossOnFill,
          takeProfitPrice: plan.takeProfitOnFill,
          reduceOnly: reducing,
        });
      await store.commit((ledger) => {
        const row = ledger.intents.find((item) => item.intentId === intentId);
        if (row) row.state = "ACKNOWLEDGED";
      });
      return { ok: true, state: "ACKNOWLEDGED", effect, intentId, response };
    } catch (error) {
      await store.commit((ledger) => {
        const row = ledger.intents.find((item) => item.intentId === intentId);
        if (row) row.state = error.halt === "UNCERTAIN_ORDER" ? "OUTCOME_UNKNOWN" : "REJECTED";
      }).catch(() => {});
      return {
        ok: false,
        state: error.halt === "UNCERTAIN_ORDER" ? "OUTCOME_UNKNOWN" : "BLOCKED",
        reason: error.halt || error.reason || "ORDER_OUTCOME_UNKNOWN",
        effect,
        intentId,
        keepReservation: error.halt === "UNCERTAIN_ORDER",
      };
    }
  }

  function oneOpenOnPair(plan) {
    return plan.openOnInstrument === true;
  }

  return { submit };
}

export function referenceEquity(account) {
  return Number(account?.NAV) || 0;
}
