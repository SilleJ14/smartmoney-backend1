import { cryptoSetupGate } from './cryptoSetup.js';
import { assessCryptoOrderLiquidity, assessCryptoTradeEconomics } from './cryptoOrderLiquidity.js';

export function evaluateCryptoTradePlan(signal, { now = Date.now(), notional, feePercentPerSide = .25, manual = false } = {}) {
  const liquidity = assessCryptoOrderLiquidity(signal.cryptoOrderbook, {
    symbol: signal.symbol, notional, now, feePercentPerSide,
  });
  const referencePrice = Number(signal.price ?? signal.current);
  const matchingPrice = liquidity.available && referencePrice > 0 &&
    Math.abs(liquidity.buyPrice / referencePrice - 1) * 100 <= .5;
  // Manual entries bypass strategy signals, not execution liquidity or freshness.
  if (manual) return { approved: liquidity.approved && matchingPrice,
    reasons: [...liquidity.reasons, ...(liquidity.available && !matchingPrice ? ['CRYPTO_QUOTE_BOOK_PRICE_MISMATCH'] : [])],
    liquidity, economics: null };
  const gate = cryptoSetupGate(signal, { now });
  const economics = assessCryptoTradeEconomics(gate.setup, liquidity);
  return { approved: gate.approved && liquidity.approved && economics.approved && matchingPrice,
    reasons: [...new Set([...gate.reasons, ...liquidity.reasons, ...economics.reasons,
      ...(liquidity.available && !matchingPrice ? ['CRYPTO_QUOTE_BOOK_PRICE_MISMATCH'] : [])])],
    setup: gate.setup, btc: gate.btc, liquidity, economics };
}
