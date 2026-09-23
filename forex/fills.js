import { txKey } from "./durableStore.js";

export function ingestTransactions(ledger, accountId, transactions = [], { advanceCursor = true } = {}) {
  const accepted = [];
  ledger.seenTransactions[accountId] = ledger.seenTransactions[accountId] || {};
  for (const row of transactions) {
    const id = String(row.id || row.transactionID || "");
    if (!id) continue;
    const key = txKey(accountId, id);
    if (row.accountID && String(row.accountID) !== String(accountId)) throw new Error("TRANSACTION_ACCOUNT_MISMATCH");
    reconcileTransaction(ledger, accountId, row);
    if (ledger.seenTransactions[accountId][id]) continue;
    ledger.seenTransactions[accountId][id] = true;
    accepted.push({ ...row, accountId, dedupeKey: key });
    const numeric = Number(id);
    const last = Number(ledger.lastTransactionId[accountId] || 0);
    if (advanceCursor && Number.isFinite(numeric) && numeric > last) ledger.lastTransactionId[accountId] = numeric;
  }
  return accepted;
}

function reconcileTransaction(ledger, accountId, tx) {
  const intent = ledger.intents.find((row) => row.accountId === accountId && (
    (row.brokerOrderId && String(row.brokerOrderId) === String(tx.orderID))
    || (row.clientOrderId && row.clientOrderId === (tx.clientOrderID || tx.clientExtensions?.id))
  ));
  if (intent && tx.type === "MARKET_ORDER") intent.brokerOrderId = String(tx.id);
  const state = tx.type === "ORDER_FILL" ? "FILLED" : tx.type === "ORDER_CANCEL" ? "CANCELLED"
    : tx.type === "MARKET_ORDER_REJECT" ? "REJECTED" : null;
  if (intent && state) {
    intent.state = state;
    intent.brokerTransactionId = String(tx.id);
    if (tx.tradeOpened) intent.brokerTradeId = String(tx.tradeOpened.tradeID);
    for (const reservation of ledger.reservations.filter((row) => row.intentId === intent.intentId)) {
      reservation.state = state === "FILLED" ? "CONSUMED" : "RELEASED";
    }
  }
  if (tx.type !== "ORDER_FILL") return;
  const legs = [
    ...(tx.tradeOpened ? [{ leg: tx.tradeOpened, action: "OPENED" }] : []),
    ...(tx.tradeReduced ? [{ leg: tx.tradeReduced, action: "REDUCED" }] : []),
    ...(tx.tradesClosed || []).map((leg) => ({ leg, action: "CLOSED" })),
  ];
  for (const { leg, action } of legs) {
    const key = `${accountId}:${tx.id}:${action}:${leg.tradeID}`;
    const existing = ledger.fills.find((row) => row.dedupeKey === key);
    if (existing) { if (intent) existing.intentId = intent.intentId; continue; }
    ledger.fills.push({ dedupeKey: key, accountId, transactionId: String(tx.id), intentId: intent?.intentId || null,
      brokerTradeId: String(leg.tradeID), instrument: tx.instrument, units: leg.units,
      price: leg.price || tx.price, at: tx.time, state: "FILLED", action,
      realizedPL: leg.realizedPL, financing: leg.financing });
  }
}

export function applyFill(ledger, fill) {
  ledger.fills.push({
    intentId: fill.intentId,
    accountId: fill.accountId,
    brokerTradeId: fill.brokerTradeId,
    instrument: fill.instrument,
    units: fill.units,
    price: fill.price,
    at: fill.at || new Date().toISOString(),
    state: "FILLED",
  });
}
