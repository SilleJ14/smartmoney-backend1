// Both asset classes need execution evidence at the same decision boundary.
// Provider adapters own deadlines/error handling; no timestamps or approvals
// are created here. Do not serialize independent stock/crypto requests.
export function refreshCandidateQuotes(stockSignals, cryptoSignals, refreshStocks, refreshCrypto) {
  const refresh = (rows, fn) => rows.length && typeof fn === 'function'
    ? Promise.resolve().then(() => fn(rows)) : Promise.resolve(rows);
  return Promise.all([refresh(stockSignals, refreshStocks), refresh(cryptoSignals, refreshCrypto)]);
}
