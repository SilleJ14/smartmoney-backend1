export function cryptoSetupEvidence(price = 100, now = Date.now()) {
  const intervalMs = 300000, end = Math.floor(now / intervalMs) * intervalMs;
  const scale = price / 100.2;
  const chartBars = Array.from({ length: 220 }, (_, i) => {
    let b = { open: 98.5, high: 99.8, low: 95 + (i % 20) * .18, close: 98.8, volume: 100 };
    if (i >= 215 && i <= 216) b = { open: 99.4, high: 99.8, low: 98.8, close: 99.5, volume: 100 };
    if (i === 217) b = { open: 99.7, high: 100.3, low: 99.2, close: 100.1, volume: 350 };
    if (i === 218) b = { open: 100, high: 100.15, low: 99.65, close: 99.95, volume: 300 };
    if (i === 219) b = { open: 99.95, high: 100.3, low: 99.8, close: 100.2, volume: 400 };
    return { ...b, open: b.open * scale, high: b.high * scale, low: b.low * scale, close: b.close * scale,
      time: end - (220 - i) * intervalMs, intervalMs };
  });
  return { chartBars, btcMarketContext: { bars: chartBars.slice(-24) },
    cryptoOrderbook: { symbol: 'BTC/USD', source: 'alpaca_crypto_orderbook', location: 'us', updatedAt: new Date(now).toISOString(),
      asks: [{ p: price * 1.0005, s: 10000 }], bids: [{ p: price * .9995, s: 10000 }] } };
}
