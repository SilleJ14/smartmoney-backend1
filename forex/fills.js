import { txKey } from "./durableStore.js";

export function ingestTransactions(ledger, accountId, transactions = []) {
  const accepted = [];
  ledger.seenTransactions[accountId] = ledger.seenTransactions[accountId] || {};
  for (const row of transactions) {
    const id = String(row.id || row.transactionID || "");
    if (!id) continue;
    const key = txKey(accountId, id);
    if (ledger.seenTransactions[accountId][id]) continue;
    ledger.seenTransactions[accountId][id] = true;
    accepted.push({ ...row, accountId, dedupeKey: key });
    const numeric = Number(id);
    const last = Number(ledger.lastTransactionId[accountId] || 0);
    if (Number.isFinite(numeric) && numeric > last) ledger.lastTransactionId[accountId] = numeric;
  }
  return accepted;
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
