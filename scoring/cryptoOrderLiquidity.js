// Simulate crossing a bounded execution-venue book, on both sides. Depth is a
// snapshot, not a fill promise; all checks run again immediately before submit.
export function assessCryptoOrderLiquidity(book, { symbol, notional, now = Date.now(), maxAgeMs = 5000,
  feePercentPerSide = .25, maxSlippagePercent = .5, depthParticipation = .1 } = {}) {
  const fail = reason => ({ available: false, approved: false, reasons: [reason], maxNotional: 0 });
  if (!book || book.source !== 'alpaca_crypto_orderbook' || book.location !== 'us' || book.symbol !== symbol) return fail('EXECUTION_VENUE_ORDERBOOK_UNAVAILABLE');
  const age = now - Date.parse(book.updatedAt || '');
  if (!Number.isFinite(age) || age < 0 || age > Math.min(5000, maxAgeMs)) return fail('CRYPTO_ORDERBOOK_STALE');
  if (![notional, feePercentPerSide, maxSlippagePercent, depthParticipation].every(Number.isFinite) || notional <= 0 ||
    feePercentPerSide < 0 || feePercentPerSide > 2 || maxSlippagePercent <= 0 || maxSlippagePercent > 1 || depthParticipation <= 0 || depthParticipation > .25) return fail('INVALID_CRYPTO_LIQUIDITY_POLICY');
  const parse = (rows, side) => {
    if (!Array.isArray(rows) || !rows.length || rows.length > 50) return null;
    if (rows.some(r => !Number.isFinite(r.p) || !Number.isFinite(r.s) || r.p <= 0 || r.s <= 0)) return null;
    if (new Set(rows.map(r => r.p)).size !== rows.length) return null;
    return [...rows].sort((a, b) => side === 'ask' ? a.p - b.p : b.p - a.p);
  };
  const asks = parse(book.asks, 'ask'), bids = parse(book.bids, 'bid');
  if (!asks || !bids || bids[0].p > asks[0].p) return fail('CRYPTO_ORDERBOOK_INVALID');
  const ask = asks[0].p, bid = bids[0].p;
  const eligibleAsks = asks.filter(r => r.p <= ask * (1 + maxSlippagePercent / 100));
  const eligibleBids = bids.filter(r => r.p >= bid * (1 - maxSlippagePercent / 100));
  const buyDepth = eligibleAsks.reduce((s, r) => s + r.p * r.s, 0);
  const sellDepth = eligibleBids.reduce((s, r) => s + r.p * r.s, 0);
  const maxNotional = Math.floor(Math.min(buyDepth, sellDepth) * depthParticipation * 100) / 100;
  let left = notional, qty = 0;
  for (const r of asks) { const dollars = Math.min(left, r.p * r.s); qty += dollars / r.p; left -= dollars; if (left < 1e-8) break; }
  let sellLeft = qty, proceeds = 0;
  for (const r of bids) { const amount = Math.min(sellLeft, r.s); proceeds += amount * r.p; sellLeft -= amount; if (sellLeft < 1e-8) break; }
  const buyPrice = qty > 0 ? notional / qty : Infinity;
  const sellPrice = qty > 0 ? proceeds / qty : 0;
  const buySlippagePercent = (buyPrice / ask - 1) * 100;
  const sellSlippagePercent = (1 - sellPrice / bid) * 100;
  const roundTripCostPercent = (1 - sellPrice / buyPrice) * 100 + feePercentPerSide * 2;
  const reasons = [
    ...(left > 1e-6 || sellLeft > 1e-8 ? ['CRYPTO_INSUFFICIENT_BOOK_DEPTH'] : []),
    ...(notional > maxNotional ? ['CRYPTO_ORDER_EXCEEDS_DEPTH_PARTICIPATION'] : []),
    ...(buySlippagePercent > maxSlippagePercent || sellSlippagePercent > maxSlippagePercent ? ['CRYPTO_SLIPPAGE_LIMIT'] : []),
  ];
  return { available: true, approved: !reasons.length, reasons, maxNotional, notional, buyDepth, sellDepth,
    buyPrice, sellPrice, buySlippagePercent, sellSlippagePercent, roundTripCostPercent, feePercentPerSide,
    feeBasis: 'CONFIGURED_CONSERVATIVE_ESTIMATE', updatedAt: book.updatedAt, source: book.source };
}
export function assessCryptoTradeEconomics(setup, liquidity) {
  if (!setup?.eligible || !liquidity?.approved) return { approved: false, reasons: ['CRYPTO_SETUP_OR_DEPTH_NOT_APPROVED'] };
  const price = liquidity.buyPrice, cost = liquidity.roundTripCostPercent / 100 * price;
  const risk = price - setup.stopPrice + cost, reward = setup.targetPrice - price - cost;
  const rewardRisk = risk > 0 ? reward / risk : 0;
  return { approved: reward > 0 && rewardRisk >= 1.5, rewardRisk, estimatedCostPerUnit: cost,
    stopPrice: setup.stopPrice, targetPrice: setup.targetPrice, targetBasis: setup.targetBasis,
    reasons: reward > 0 && rewardRisk >= 1.5 ? [] : ['CRYPTO_NET_REWARD_RISK_BELOW_1_5'] };
}
