import { createExecutionCoordinator } from "./executionCoordinator.js";
import { protectionVerified } from "./protection.js";
import { holdExpired } from "./strategyExits.js";
import { forexMarketState } from "./sessionHours.js";
import { calendarForDecision } from "./calendarFeed.js";
import { ingestTransactions } from "./fills.js";

// Deliberately has no stock/crypto or Forex Autopilot dependency. OFF stops entries, not protection.
export async function manageForexPositions({ client, store, now = Date.now(), calendar, getCalendar, instanceId = "local" }) {
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
  const coordinator = createExecutionCoordinator({ adapter: client, store, instanceId });
  const actions = [];
  for (const trade of payload.trades) {
    if (!Number(trade.currentUnits)) continue;
    const known = ledger.fills.some(f => f.accountId === accountId && String(f.brokerTradeId) === String(trade.id) && f.intentId);
    const protection = protectionVerified(trade);
    const session = forexMarketState(now);
    const event = calendarForDecision(getCalendar?.() || calendar, { now, instrument: trade.instrument });
    const reason = !protection.ok ? "MISSING_PROTECTION"
      : known && holdExpired({ openedAt: trade.openTime, now }) ? "MAX_HOLD_EXCEEDED"
      : known && session.tooCloseToWeeklyClose ? "WEEKLY_CLOSE"
      : known && event.reason === "EVENT_WINDOW" ? "EVENT_WINDOW" : null;
    if (!reason) continue;
    const uncertain = ledger.intents.some(i => i.accountId === accountId && String(i.brokerTradeId) === String(trade.id)
      && ["INTENT_SAVED", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"].includes(i.state));
    if (uncertain) { actions.push({ tradeId: trade.id, reason: "UNRESOLVED_EXIT" }); continue; }
    // Without a trustworthy stored stop, inventing a repair price is unsafe. Close the verified exposure.
    const result = await coordinator.submit({ intent: "close", environment: "FORWARD_PRACTICE", accountId,
      instrumentId: trade.instrument, brokerTradeId: trade.id, units: -Number(trade.currentUnits),
      clientRequestId: `close:${accountId}:${trade.id}:${reason}`, exitReason: reason });
    actions.push({ tradeId: trade.id, reason, state: result.state, error: result.reason });
  }
  return { actions, checkedAt: new Date(now).toISOString(), positionsChecked: payload.trades.length };
}
