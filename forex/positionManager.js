import { createExecutionCoordinator } from "./executionCoordinator.js";
import { protectionVerified } from "./protection.js";
import { holdExpired } from "./strategyExits.js";
import { forexMarketState } from "./sessionHours.js";
import { calendarForDecision } from "./calendarFeed.js";
import { ingestTransactions } from "./fills.js";
import { wilderAtr } from "./indicators.js";
import { evaluateForexTradeLifecycle } from "./tradeLifecycle.js";

const lifecycleCandleCache = new Map();
const LIFECYCLE_CANDLE_TTL_MS = 60000;

async function lifecycleAtr(client, instrument, now) {
  const cached = lifecycleCandleCache.get(instrument);
  if (cached && now - cached.at <= LIFECYCLE_CANDLE_TTL_MS) return cached.atr;
  if (typeof client.getCandles !== "function") return null;
  try {
    const payload = await client.getCandles(instrument, { granularity: "M15", count: 40, price: "M" });
    const rows = (payload?.candles || []).map(row => ({
      t: row.time,
      o: Number(row.mid?.o),
      h: Number(row.mid?.h),
      l: Number(row.mid?.l),
      c: Number(row.mid?.c),
      complete: row.complete,
    }));
    const atr = wilderAtr(rows, 14)?.atr ?? null;
    lifecycleCandleCache.set(instrument, { at: now, atr });
    return atr;
  } catch {
    return null;
  }
}

// Deliberately has no stock/crypto or Forex Autopilot dependency. OFF stops entries, not protection.
export async function manageForexPositions({ client, store, journal, now = Date.now(), calendar, getCalendar, instanceId = "local" }) {
  if (!client?.token || client.liveHost) return { actions: [], halt: "NO_PRACTICE_CONNECTION" };
  const payload = await client.getOpenTrades();
  if (!Array.isArray(payload?.trades)) throw new Error("POSITIONS_UNVERIFIED");
  if (!store.isDurable()) return { actions: [], halt: "DURABLE_STORAGE_UNAVAILABLE" };
  let ledger = await store.load();
  const accountId = client.accountId || await client.resolveAccountId();
  const tx = await client.getTransactionsSince(ledger.lastTransactionId[accountId] || 0);
  if (!Array.isArray(tx?.transactions)) throw new Error("TRANSACTIONS_UNVERIFIED");
  // Reconcile uncertain closes without advancing the NAV/account reconciliation cursor.
  await store.commit(l => ingestTransactions(l, accountId, tx.transactions, { advanceCursor: false }));
  ledger = await store.load();
  const coordinator = createExecutionCoordinator({ adapter: client, store, journal, instanceId });
  const actions = [];
  const recordManagement = (instrument, payload) => {
    try {
      journal?.append?.({
        type: "MANAGEMENT_ACTION",
        occurredAt: new Date(now).toISOString(),
        entityId: instrument,
        payload,
      });
    } catch (error) {
      actions.push({
        action: "JOURNAL_ERROR",
        reason: "MANAGEMENT_JOURNAL_FAILED",
        error: String(error?.message || error),
      });
    }
  };
  const instruments = [...new Set(payload.trades.map(trade => trade.instrument).filter(Boolean))];
  let quotes = [];
  try {
    quotes = (await client.getPrices(instruments))?.prices || [];
  } catch {
    quotes = [];
  }
  for (const trade of payload.trades) {
    if (!Number(trade.currentUnits)) continue;
    const openingFill = ledger.fills.find(f =>
      f.accountId === accountId && String(f.brokerTradeId) === String(trade.id) && f.intentId);
    const openingIntent = ledger.intents.find(intent => intent.intentId === openingFill?.intentId);
    const known = Boolean(openingFill);
    const protection = protectionVerified(trade);
    const session = forexMarketState(now);
    const event = calendarForDecision(getCalendar?.() || calendar, { now, instrument: trade.instrument });
    const hardReason = !protection.ok ? "MISSING_PROTECTION"
      : known && holdExpired({ openedAt: trade.openTime, now }) ? "MAX_HOLD_EXCEEDED"
      : known && session.tooCloseToWeeklyClose ? "WEEKLY_CLOSE"
      : known && event.reason === "EVENT_WINDOW" ? "EVENT_WINDOW" : null;
    const price = quotes.find(row => row.instrument === trade.instrument) || {};
    const atr = await lifecycleAtr(client, trade.instrument, now);
    const lifecycle = hardReason === "MISSING_PROTECTION"
      ? { action: "CLOSE_FULL", reason: hardReason, units: -Number(trade.currentUnits), rMultiple: null }
      : evaluateForexTradeLifecycle({
      trade,
      quote: {
        bid: Number(price.bids?.[0]?.price ?? price.closeoutBid),
        ask: Number(price.asks?.[0]?.price ?? price.closeoutAsk),
      },
      atr,
      eventGate: hardReason === "EVENT_WINDOW" ? { reason: "EVENT_WINDOW" } : event,
      session: hardReason === "WEEKLY_CLOSE" ? { ...session, tooCloseToWeeklyClose: true } : session,
      now,
      managementState: {
        ...(ledger.management?.[`${accountId}:${trade.id}`] || {}),
        holdExpired: hardReason === "MAX_HOLD_EXCEEDED",
      },
      });
    const reason = hardReason || lifecycle.reason;
    if (lifecycle.action === "HOLD" || lifecycle.action === "WAIT") {
      actions.push({ tradeId: trade.id, action: lifecycle.action, reason, rMultiple: lifecycle.rMultiple });
      continue;
    }
    const uncertain = ledger.intents.some(i => i.accountId === accountId && String(i.brokerTradeId) === String(trade.id)
      && ["INTENT_SAVED", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"].includes(i.state));
    if (uncertain) { actions.push({ tradeId: trade.id, reason: "UNRESOLVED_EXIT" }); continue; }
    if (lifecycle.action === "UPDATE_PROTECTION") {
      if (typeof client.replaceTradeDependentOrders !== "function") {
        actions.push({ tradeId: trade.id, action: lifecycle.action, reason: "BROKER_MODIFY_UNAVAILABLE" });
        continue;
      }
      try {
        const result = await coordinator.replaceProtection({
          accountId,
          environment: "FORWARD_PRACTICE",
          brokerTradeId: trade.id,
          instrumentId: trade.instrument,
          stopLossPrice: lifecycle.stop,
          takeProfitPrice: lifecycle.takeProfit,
          reason: lifecycle.reason,
          clientRequestId: `protect:${accountId}:${trade.id}:${lifecycle.stop}:${lifecycle.takeProfit ?? ""}`,
        });
        if (!result.ok) throw Object.assign(new Error(result.reason), { reason: result.reason });
        await store.commit(next => {
          next.management ||= {};
          next.management[`${accountId}:${trade.id}`] = {
            ...(next.management[`${accountId}:${trade.id}`] || {}),
            initialStop: next.management[`${accountId}:${trade.id}`]?.initialStop ??
              Number(trade.stopLossOrder?.price),
            stop: lifecycle.stop,
            lastAction: lifecycle.reason,
            updatedAt: new Date(now).toISOString(),
          };
          next.audits.push({ type: "FOREX_PROTECTION_UPDATED", accountId, tradeId: trade.id,
            stop: lifecycle.stop, reason: lifecycle.reason, at: new Date(now).toISOString() });
        });
        actions.push({ tradeId: trade.id, action: lifecycle.action, reason: lifecycle.reason,
          stop: lifecycle.stop, responseReceived: Boolean(result.response) });
      } catch (error) {
        actions.push({ tradeId: trade.id, action: lifecycle.action, reason: "PROTECTION_UPDATE_FAILED",
          error: String(error?.message || error) });
      }
      continue;
    }
    const result = await coordinator.submit({ intent: "close", environment: "FORWARD_PRACTICE", accountId,
      instrumentId: trade.instrument, brokerTradeId: trade.id, units: lifecycle.units,
      worstEntryPrice: Number(lifecycle.units) < 0
        ? Number(price.bids?.[0]?.price ?? price.closeoutBid)
        : Number(price.asks?.[0]?.price ?? price.closeoutAsk),
      clientRequestId: `close:${accountId}:${trade.id}:${reason}:${lifecycle.action}`, exitReason: reason });
    if (result.ok && lifecycle.action === "CLOSE_PARTIAL") {
      await store.commit(next => {
        next.management ||= {};
        next.management[`${accountId}:${trade.id}`] = {
          ...(next.management[`${accountId}:${trade.id}`] || {}),
          initialStop: next.management[`${accountId}:${trade.id}`]?.initialStop ??
            Number(trade.stopLossOrder?.price),
          partialTaken: true,
          lastAction: lifecycle.reason,
          updatedAt: new Date(now).toISOString(),
        };
      });
    }
    recordManagement(trade.instrument, {
        brokerTradeId: String(trade.id),
        action: lifecycle.action,
        reason,
        state: result.state,
        units: lifecycle.units,
    });
    if (result.ok && lifecycle.action === "CLOSE_FULL") {
      const initialRisk = Math.abs(
        Number(openingFill?.price ?? trade.price) -
        Number(ledger.management?.[`${accountId}:${trade.id}`]?.initialStop ?? trade.stopLossOrder?.price)
      );
      const costR = Number.isFinite(result.measuredSlippage) && initialRisk > 0
        ? Math.abs(result.measuredSlippage) / initialRisk : null;
      try {
        journal?.append?.({
          type: "OUTCOME",
          occurredAt: new Date(now).toISOString(),
          entityId: trade.instrument,
          payload: {
            brokerTradeId: String(trade.id),
            strategyId: openingIntent?.strategyId || null,
            bucket: openingIntent?.comparableBucket || null,
            rMultiple: lifecycle.rMultiple,
            success: Number(lifecycle.rMultiple) > 0,
            costR,
            predictedProbability: openingIntent?.predictedProbability ?? null,
            exitReason: reason,
            resolvedAt: new Date(now).toISOString(),
          },
        });
      } catch (error) {
        actions.push({
          action: "JOURNAL_ERROR",
          reason: "OUTCOME_JOURNAL_FAILED",
          error: String(error?.message || error),
        });
      }
    }
    actions.push({ tradeId: trade.id, action: lifecycle.action, reason, state: result.state, error: result.reason });
  }
  return { actions, checkedAt: new Date(now).toISOString(), positionsChecked: payload.trades.length };
}
