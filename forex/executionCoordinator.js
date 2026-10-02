import { classifyPositionEffect, isOpeningRisk } from "./identity.js";
import { automaticEntryPermission } from "./approvalRegistry.js";
import { canOpenRisk, permittedUnits, FOREX_RISK_LIMITS } from "./riskManager.js";
import { conversionLossPerUnit } from "./instrumentSpecs.js";
import { spreadChecks } from "./spreadCost.js";
import { chasedAway, entryExpired, stopDistanceOk } from "./strategyExits.js";
import { calendarForDecision } from "./calendarFeed.js";
import { randomUUID } from "node:crypto";
import { ingestTransactions } from "./fills.js";
import { orderOutcome } from "./orderOutcome.js";
import { refreshExecutionPlan } from "./executionEvidence.js";

function blocked(reason, extra = {}) {
  return { ok: false, state: "BLOCKED", reason, ...extra };
}

export function createExecutionCoordinator({
  adapter,
  registry,
  store,
  journal,
  instanceId = "local",
  getEntryPause,
  getAutoEnabled,
  getCalendar,
  refreshPlan = refreshExecutionPlan,
  nowFn = Date.now,
} = {}) {
  if (!adapter) throw new Error("BROKER_ADAPTER_REQUIRED");

  async function submit(plan) {
    const durable = store?.isDurable?.() === true;
    if (!durable) return blocked("DURABLE_STORAGE_UNAVAILABLE");
    const reducing = plan?.positionFill === "REDUCE_ONLY" || plan?.intent === "close";
    if (!reducing && journal !== undefined && journal?.health?.().ok !== true) {
      return blocked("FOREX_JOURNAL_UNAVAILABLE");
    }
    if (plan?.overridePermissions || plan?.aiDirective) return blocked("UNTRUSTED_INPUT");
    if (!reducing && !plan?.executionReady) return blocked("EXECUTION_NOT_READY");
    if (!reducing && getEntryPause?.() === true) return blocked("ENTRIES_PAUSED");
    if (!reducing && (plan.incidentLockActive || plan.pauseEntries)) return blocked("INCIDENT_LOCK");
    if (adapter.liveHost || plan.environment === "LIVE") return blocked("LIVE_BLOCKED");

    if (reducing) {
      // Verify the position at the broker; caller-supplied units cannot authorize an exit.
      if (typeof adapter.getOpenTrades !== "function" || !plan.brokerTradeId) return blocked("EXIT_POSITION_UNVERIFIED");
      let trades;
      try { trades = (await adapter.getOpenTrades()).trades; }
      catch { return blocked("EXIT_POSITION_UNVERIFIED"); }
      const trade = trades?.find((row) => String(row.id) === String(plan.brokerTradeId));
      const current = Number(trade?.currentUnits);
      const units = Number(plan.units);
      if (!trade || trade.instrument !== plan.instrumentId || !Number.isFinite(current) || !current
        || !Number.isFinite(units) || !units || Math.sign(units) === Math.sign(current)
        || Math.abs(units) > Math.abs(current)) return blocked("CLOSE_WOULD_OPEN");
      plan = { ...plan, currentUnits: current };
    }
    const practiceOrder = plan?.practiceOrdersEnabled === true
      && plan?.environment === "FORWARD_PRACTICE"
      && adapter.liveHost !== true;
    if (!reducing) {
      if (plan.intent === "automatic" && (plan.autoTradingAuthorized !== true || getAutoEnabled?.() === false)) {
        return blocked("FOREX_AUTOPILOT_OFF");
      }
      if (plan.intent === "automatic") {
        const entryPermission = automaticEntryPermission(registry, plan.strategyId, {
          autopilotEnabled: getAutoEnabled ? getAutoEnabled() === true : plan.autoTradingAuthorized === true,
          environment: plan.environment || "FORWARD_PRACTICE",
        });
        if (!entryPermission.allowed) return blocked(entryPermission.reason);
        plan = { ...plan, entryPermission };
      }
      try { plan = await refreshPlan(adapter, store, plan, nowFn); }
      catch (error) { return blocked(error.reason || error.message || "EXECUTION_EVIDENCE_UNAVAILABLE"); }
      if (getCalendar) plan = { ...plan, calendar: getCalendar() };
      const calendar = calendarForDecision(plan.calendar, { now: plan.now, instrument: plan.instrumentId });
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
        conversionFactor: plan.conversionFactor,
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
        remainingWeeklyRisk: plan.remainingWeeklyRisk,
        plannedRisk: plan.plannedRiskPercent,
        openPlusPending: plan.openPlusPendingPercent,
        sameDirection: plan.sameDirectionPercent,
        drawdownPercent: plan.drawdownPercent,
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

    const intentId = plan.intentId || `fx-${randomUUID()}`;
    const clientOrderId = `fx-${randomUUID()}`;
    try {
      await store.commit((ledger) => {
        if (!reducing && (getEntryPause?.() === true || ledger.pauseEntries[plan.accountId])) {
          throw Object.assign(new Error("ENTRIES_PAUSED"), { reason: "ENTRIES_PAUSED" });
        }
        if (!reducing && getAutoEnabled?.() === false) throw Object.assign(new Error("FOREX_AUTOPILOT_OFF"), { reason: "FOREX_AUTOPILOT_OFF" });
        if (!reducing && ledger.incidentLocks[plan.accountId]) throw Object.assign(new Error("INCIDENT_LOCK"), { reason: "INCIDENT_LOCK" });
        if (!reducing && ledger.intents.some(row => row.accountId === plan.accountId && ["INTENT_SAVED", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"].includes(row.state))) {
          throw Object.assign(new Error("UNCERTAIN_ORDER"), { reason: "UNCERTAIN_ORDER" });
        }
        if (ledger.owner && ledger.owner.instanceId !== instanceId) {
          throw Object.assign(new Error("NOT_EXECUTION_OWNER"), { reason: "NOT_EXECUTION_OWNER" });
        }
        const duplicate = ledger.intents.some((row) => (
          row.clientRequestId && row.clientRequestId === plan.clientRequestId && row.state !== "REJECTED"
          && !(reducing && row.state === "CANCELLED")
        ));
        if (duplicate) throw Object.assign(new Error("DUPLICATE_INTENT"), { reason: "DUPLICATE_INTENT" });
        ledger.intents.push({
          intentId,
          accountId: plan.accountId,
          instrumentId: plan.instrumentId,
          brokerTradeId: plan.brokerTradeId,
          intent: plan.intent,
          exitReason: plan.exitReason,
          units: plan.units,
          state: "INTENT_SAVED",
          createdAt: new Date(nowFn()).toISOString(),
          clientRequestId: plan.clientRequestId,
          clientOrderId,
          strategyId: plan.strategyId,
          comparableBucket: plan.comparableBucket || null,
          predictedProbability: Number.isFinite(Number(plan.predictedProbability))
            ? Number(plan.predictedProbability) : null,
          candidateId: plan.candidateId,
          entryPermission: plan.entryPermission,
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
      // Recheck switches after the durable write too: an OFF received while fsync runs wins.
      if (!reducing && (getEntryPause?.() === true || getAutoEnabled?.() === false
        || (plan.quoteTimestamp && nowFn() - Date.parse(plan.quoteTimestamp) > 2000)
        || (plan.intent === "automatic" && getCalendar && !calendarForDecision(getCalendar(), { now: nowFn(), instrument: plan.instrumentId }).ok))) {
        await store.commit(ledger => {
          const row = ledger.intents.find(i => i.intentId === intentId);
          if (row) row.state = "REJECTED";
          for (const r of ledger.reservations.filter(r => r.intentId === intentId)) r.state = "RELEASED";
        });
        return blocked("AUTHORIZATION_CHANGED");
      }
      try {
        journal?.append?.({
          type: "ORDER_INTENT",
          occurredAt: new Date(nowFn()).toISOString(),
          entityId: plan.instrumentId,
          snapshotId: plan.evidenceSnapshotId || null,
          configHash: plan.configHash || null,
          payload: {
            intentId,
            clientOrderId,
            clientRequestId: plan.clientRequestId,
            strategyId: plan.strategyId,
            comparableBucket: plan.comparableBucket || null,
            predictedProbability: Number.isFinite(Number(plan.predictedProbability))
              ? Number(plan.predictedProbability) : null,
            side: Number(plan.units) < 0 ? "SELL" : "BUY",
            units: plan.units,
            priceBound: plan.priceBound,
            stop: plan.stopLossOnFill,
            target: plan.takeProfitOnFill || null,
            reducing,
          },
        });
      } catch {
        await store.commit(ledger => {
          const row = ledger.intents.find(item => item.intentId === intentId);
          if (row) row.state = "REJECTED";
          for (const reservation of ledger.reservations.filter(item => item.intentId === intentId)) {
            reservation.state = "RELEASED";
          }
        }).catch(() => {});
        return blocked("FOREX_JOURNAL_WRITE_FAILED", { intentId });
      }
      const response = reducing && Math.abs(Number(plan.units)) === Math.abs(Number(plan.currentUnits)) && plan.brokerTradeId && adapter.closeTrade
        ? await adapter.closeTrade(plan.brokerTradeId)
        : await adapter.createMarketOrder({
          instrument: plan.instrumentId,
          units: plan.units,
          priceBound: plan.priceBound,
          stopLossPrice: plan.stopLossOnFill,
          takeProfitPrice: plan.takeProfitOnFill,
          reduceOnly: reducing,
          clientOrderId,
        });
      const outcome = orderOutcome(response);
      await store.commit((ledger) => {
        const row = ledger.intents.find((item) => item.intentId === intentId);
        if (row) {
          row.state = outcome.state;
          row.brokerOrderId = String(response.orderCreateTransaction?.id || outcome.transaction?.orderID || "");
        }
        if (outcome.transaction) {
          ingestTransactions(ledger, plan.accountId, [outcome.transaction], { advanceCursor: false });
        }
        for (const reservation of ledger.reservations.filter((item) => item.intentId === intentId)) {
          reservation.state = outcome.state === "FILLED" ? "CONSUMED" : outcome.state === "OUTCOME_UNKNOWN" ? "RESERVED" : "RELEASED";
        }
      });
      const fillPrice = Number(outcome.transaction?.price ?? response?.orderFillTransaction?.price);
      const requestedPrice = Number(plan.worstEntryPrice ?? plan.priceBound);
      const slippage = Number.isFinite(fillPrice) && Number.isFinite(requestedPrice)
        ? (Number(plan.units) < 0 ? requestedPrice - fillPrice : fillPrice - requestedPrice)
        : null;
      let recordingError = null;
      if (outcome.state === "FILLED") {
        try {
          journal?.append?.({
            type: "FILL",
            occurredAt: outcome.transaction?.time || new Date(nowFn()).toISOString(),
            entityId: plan.instrumentId,
            snapshotId: plan.evidenceSnapshotId || null,
            configHash: plan.configHash || null,
            payload: {
              intentId,
              brokerOrderId: String(response.orderCreateTransaction?.id || outcome.transaction?.orderID || ""),
              brokerTradeId: outcome.transaction?.tradeOpened?.tradeID || plan.brokerTradeId || null,
              units: Number(outcome.transaction?.units ?? plan.units),
              fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
              requestedPrice: Number.isFinite(requestedPrice) ? requestedPrice : null,
              measuredSlippage: slippage,
              financing: Number.isFinite(Number(outcome.transaction?.financing))
                ? Number(outcome.transaction.financing) : null,
            },
          });
        } catch (error) {
          recordingError = String(error?.message || error);
        }
      }
      return { ok: outcome.state === "FILLED", state: outcome.state, reason: outcome.reason, effect, intentId, response,
        submittedUnits: plan.units, plannedRiskPercent: plan.plannedRiskPercent,
        fillPrice: Number.isFinite(fillPrice) ? fillPrice : null,
        measuredSlippage: slippage,
        recordingError,
        keepReservation: outcome.state === "OUTCOME_UNKNOWN" };
    } catch (error) {
      // Without an explicit broker rejection, a timeout/transport/storage failure is uncertain.
      const outcome = orderOutcome(error.data);
      const rejected = outcome.state === "REJECTED";
      await store.commit((ledger) => {
        const row = ledger.intents.find((item) => item.intentId === intentId);
        if (row) row.state = rejected ? "REJECTED" : "OUTCOME_UNKNOWN";
        if (rejected) {
          for (const reservation of ledger.reservations.filter((item) => item.intentId === intentId)) reservation.state = "RELEASED";
        }
      }).catch(() => {});
      return {
        ok: false,
        state: rejected ? "REJECTED" : "OUTCOME_UNKNOWN",
        reason: rejected ? outcome.reason : "ORDER_OUTCOME_UNKNOWN",
        effect,
        intentId,
        keepReservation: !rejected,
      };
    }
  }

  function oneOpenOnPair(plan) {
    return plan.openOnInstrument === true;
  }

  async function replaceProtection(plan = {}) {
    if (!store?.isDurable?.()) return blocked("DURABLE_STORAGE_UNAVAILABLE");
    if (adapter.liveHost || plan.environment === "LIVE") return blocked("LIVE_BLOCKED");
    if (!plan.brokerTradeId || !plan.instrumentId || !plan.clientRequestId) {
      return blocked("MANAGEMENT_EVIDENCE_MISSING");
    }
    if (typeof adapter.getOpenTrades !== "function" ||
        typeof adapter.replaceTradeDependentOrders !== "function") {
      return blocked("BROKER_MODIFY_UNAVAILABLE");
    }
    let trade;
    try {
      trade = (await adapter.getOpenTrades()).trades?.find(row =>
        String(row.id) === String(plan.brokerTradeId) && row.instrument === plan.instrumentId);
    } catch {
      return blocked("EXIT_POSITION_UNVERIFIED");
    }
    const units = Number(trade?.currentUnits);
    const currentStop = Number(trade?.stopLossOrder?.price ?? trade?.guaranteedStopLossOrder?.price);
    const nextStop = Number(plan.stopLossPrice);
    if (!trade || !Number.isFinite(units) || !units || !Number.isFinite(nextStop) || nextStop <= 0) {
      return blocked("MANAGEMENT_EVIDENCE_MISSING");
    }
    if (Number.isFinite(currentStop) &&
        ((units > 0 && nextStop < currentStop) || (units < 0 && nextStop > currentStop))) {
      return blocked("STOP_LOOSENING_FORBIDDEN");
    }
    const key = `${plan.accountId}:${plan.brokerTradeId}`;
    try {
      await store.commit(ledger => {
        if (ledger.owner && ledger.owner.instanceId !== instanceId) {
          throw Object.assign(new Error("NOT_EXECUTION_OWNER"), { reason: "NOT_EXECUTION_OWNER" });
        }
        ledger.management ||= {};
        const current = ledger.management[key] || {};
        if (current.lastRequestId === plan.clientRequestId ||
            current.pendingRequest?.clientRequestId === plan.clientRequestId) {
          throw Object.assign(new Error("DUPLICATE_MANAGEMENT"), { reason: "DUPLICATE_MANAGEMENT" });
        }
        ledger.management[key] = {
          ...current,
          pendingRequest: {
            clientRequestId: plan.clientRequestId,
            stopLossPrice: nextStop,
            takeProfitPrice: plan.takeProfitPrice ?? null,
            state: "SAVED",
            at: new Date(nowFn()).toISOString(),
          },
        };
      });
    } catch (error) {
      return blocked(error.reason || "DURABLE_STORAGE_UNAVAILABLE");
    }
    try {
      const response = await adapter.replaceTradeDependentOrders(plan.brokerTradeId, {
        stopLossPrice: nextStop,
        takeProfitPrice: plan.takeProfitPrice,
      });
      await store.commit(ledger => {
        const current = ledger.management?.[key] || {};
        ledger.management[key] = {
          ...current,
          stop: nextStop,
          takeProfit: plan.takeProfitPrice ?? current.takeProfit ?? null,
          lastRequestId: plan.clientRequestId,
          lastAction: plan.reason || "PROTECTION_UPDATED",
          updatedAt: new Date(nowFn()).toISOString(),
          pendingRequest: null,
        };
      });
      try {
        journal?.append?.({
          type: "MANAGEMENT_ACTION",
          occurredAt: new Date(nowFn()).toISOString(),
          entityId: plan.instrumentId,
          payload: {
            brokerTradeId: String(plan.brokerTradeId),
            action: "UPDATE_PROTECTION",
            reason: plan.reason || null,
            stopLossPrice: nextStop,
            takeProfitPrice: plan.takeProfitPrice ?? null,
            clientRequestId: plan.clientRequestId,
          },
        });
      } catch {}
      return { ok: true, state: "REPLACED", response };
    } catch (error) {
      await store.commit(ledger => {
        const request = ledger.management?.[key]?.pendingRequest;
        if (request) request.state = "OUTCOME_UNKNOWN";
      }).catch(() => {});
      return { ok: false, state: "OUTCOME_UNKNOWN", reason: "REPLACE_OUTCOME_UNKNOWN" };
    }
  }

  async function cancel(plan = {}) {
    if (!store?.isDurable?.()) return blocked("DURABLE_STORAGE_UNAVAILABLE");
    if (adapter.liveHost || plan.environment === "LIVE") return blocked("LIVE_BLOCKED");
    if (!plan.orderId || !plan.accountId || typeof adapter.getPendingOrders !== "function" ||
        typeof adapter.cancelOrder !== "function") return blocked("CANCEL_EVIDENCE_MISSING");
    let orders;
    try { orders = (await adapter.getPendingOrders()).orders; }
    catch { return blocked("PENDING_ORDERS_UNVERIFIED"); }
    if (!Array.isArray(orders) || !orders.some(row => String(row.id) === String(plan.orderId))) {
      return blocked("ORDER_NOT_PENDING");
    }
    const ledger = await store.load();
    const intent = ledger.intents.find(row => row.accountId === plan.accountId &&
      String(row.brokerOrderId) === String(plan.orderId));
    if (!intent) return blocked("ORDER_OWNERSHIP_UNVERIFIED");
    if (intent.state === "CANCELLED") return blocked("DUPLICATE_CANCEL");
    try {
      const response = await adapter.cancelOrder(plan.orderId);
      await store.commit(next => {
        const row = next.intents.find(item => item.intentId === intent.intentId);
        if (row) row.state = "CANCELLED";
        for (const reservation of next.reservations.filter(item => item.intentId === intent.intentId)) {
          reservation.state = "RELEASED";
        }
      });
      return { ok: true, state: "CANCELLED", response };
    } catch {
      return { ok: false, state: "OUTCOME_UNKNOWN", reason: "CANCEL_OUTCOME_UNKNOWN" };
    }
  }

  return { submit, replaceProtection, cancel };
}

export function referenceEquity(account) {
  return Number(account?.NAV) || 0;
}
