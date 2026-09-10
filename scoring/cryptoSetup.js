// Versioned research rules, not calibrated probabilities. Price/volume trend
// families are scored once; EMAs and derivatives are supporting telemetry only.
export const CRYPTO_SETUP_MODEL = 'CRYPTO_SETUP_V1';
const finite = x => x !== null && x !== '' && Number.isFinite(Number(x));
const clamp = x => Math.max(0, Math.min(100, x));
const mean = rows => rows.reduce((s, n) => s + n, 0) / Math.max(1, rows.length);
function stamp(value) {
  if (value == null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n < 1e10 ? n * 1000 : n : Date.parse(value);
}
export function completedCryptoBars(input, now = Date.now()) {
  if (!Array.isArray(input)) return [];
  const rows = input.slice(-240).map(b => ({
    time: stamp(b?.time ?? b?.t), open: Number(b?.open ?? b?.o),
    high: Number(b?.high ?? b?.h), low: Number(b?.low ?? b?.l),
    close: Number(b?.close ?? b?.c), volume: Number(b?.volume ?? b?.v),
    intervalMs: Number(b?.intervalMs),
  }));
  if (rows.length < 2 || rows.some((b, i) =>
    ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
    b.low <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) ||
    b.volume < 0 || b.time > now || (i && b.time <= rows[i - 1].time))) return [];
  const gaps = rows.slice(1).map((b, i) => b.time - rows[i].time).sort((a, b) => a - b);
  const interval = finite(rows.at(-1).intervalMs) && rows.at(-1).intervalMs > 0
    ? rows.at(-1).intervalMs : gaps[Math.floor(gaps.length / 2)];
  if (interval < 60000 || interval > 900000 || gaps.some(g => g !== interval)) return [];
  const done = rows.filter(b => b.time + interval <= now).map(b => ({ ...b, intervalMs: interval }));
  return !done.length || now - (done.at(-1).time + interval) > interval * 2 ? [] : done;
}
function ema(values, period) {
  if (values.length < period) return null;
  let value = mean(values.slice(0, period));
  for (const close of values.slice(period)) value += (close - value) * 2 / (period + 1);
  return value;
}
export function assessBtcContext(bars, { now = Date.now() } = {}) {
  const rows = completedCryptoBars(bars, now);
  if (rows.length < 20) return { available: false, block: false, reason: 'BTC_CONTEXT_UNAVAILABLE', bars: [] };
  const last = rows.at(-1), reference = rows.find(b => b.time >= last.time - 3600000) || rows[0];
  const changePercent = (last.close / reference.close - 1) * 100;
  const volatilityPercent = mean(rows.slice(-12).map(b => (b.high - b.low) / b.close * 100));
  const trend = ema(rows.map(b => b.close), 20);
  const block = changePercent <= -3 && last.close < trend;
  return { available: true, block, reason: block ? 'BTC_SHARP_DECLINE' : 'BTC_CONTEXT_ACCEPTABLE',
    changePercent, windowMinutes: (last.time - reference.time) / 60000, volatilityPercent,
    belowEma20: last.close < trend, barUpdatedAt: new Date(last.time + last.intervalMs).toISOString(),
    // Keep enough source evidence to recheck freshness on the final order path.
    bars: rows.slice(-24) };
}
export function assessCryptoSetup(signal = {}, { now = Date.now() } = {}) {
  const rows = completedCryptoBars(signal.chartBars || [], now);
  const base = { model: CRYPTO_SETUP_MODEL, available: false, eligible: false, score: null,
    derivatives: { openInterest: { available: false, required: false }, funding: { available: false, required: false } } };
  if (rows.length < 24) return { ...base, reasons: ['CRYPTO_SETUP_HISTORY_UNAVAILABLE'] };
  const last = rows.at(-1), price = Number(signal.price ?? signal.current);
  if (!(price > 0) || !Number.isFinite(price)) return { ...base, reasons: ['CRYPTO_SETUP_PRICE_UNAVAILABLE'] };
  const recent = rows.slice(-3), prior = rows.slice(-23, -3);
  const resistance = Math.max(...prior.map(b => b.high));
  const atr = mean(rows.slice(-14).map((b, i) => {
    const prev = rows[rows.length - 15 + i]?.close ?? b.open;
    return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  }));
  const tolerance = Math.max(atr * .25, resistance * .001);
  const breakout = last.close > Math.max(...rows.slice(-21, -1).map(b => b.high));
  const priorBreak = recent.slice(0, -1).some(b => b.close > resistance);
  const retest = priorBreak && recent.slice(1).some(b => b.low <= resistance + tolerance && b.low >= resistance - tolerance) &&
    last.close > resistance && last.close > recent.at(-2).close;
  // Local swing pivots, not a requirement that every candle is higher.
  const highs = [], lows = [];
  for (let i = Math.max(1, rows.length - 24); i < rows.length - 1; i++) {
    if (rows[i].high > rows[i - 1].high && rows[i].high >= rows[i + 1].high) highs.push(rows[i].high);
    if (rows[i].low < rows[i - 1].low && rows[i].low <= rows[i + 1].low) lows.push(rows[i].low);
  }
  const higherHighs = highs.length >= 2 && highs.at(-1) > highs.at(-2);
  const higherLows = lows.length >= 2 && lows.at(-1) > lows.at(-2);
  const baselineDollars = mean(prior.map(b => b.volume * b.close));
  const volumeRatio = baselineDollars > 0 ? mean(recent.map(b => b.volume * b.close)) / baselineDollars : 0;
  const volumeConfirmed = volumeRatio >= 1.3 && last.volume > 0;
  const roc = (last.close / rows.at(-4).close - 1) * 100;
  const priorRoc = (rows.at(-4).close / rows.at(-7).close - 1) * 100;
  const stopPrice = Math.min(...rows.slice(-5).map(b => b.low)) - atr * .1;
  const riskPercent = (price - stopPrice) / price * 100;
  const extensionAtr = atr > 0 ? (price - resistance) / atr : Infinity;
  const overheated = riskPercent > 4 || extensionAtr > 3 || price > last.close + atr;
  const closes = rows.map(b => b.close), ema20 = ema(closes, 20), ema50 = ema(closes, 50), ema200 = ema(closes, 200);
  const route = retest ? 'RETEST_CONTINUATION' : breakout ? 'BREAKOUT' : 'DEVELOPING_EARLY';
  // Measured-range projection is an explicit estimate, never an observed future price.
  const range = resistance - Math.min(...prior.map(b => b.low));
  const targetPrice = resistance + range;
  const reasons = [
    ...(!(breakout || retest) ? ['CRYPTO_ENTRY_TRIGGER_NOT_CONFIRMED'] : []),
    ...(!(higherLows || retest) ? ['CRYPTO_SUPPORT_STRUCTURE_NOT_CONFIRMED'] : []),
    ...(!volumeConfirmed ? ['CRYPTO_TRADED_VOLUME_NOT_CONFIRMED'] : []),
    ...(roc <= 0 || price < last.close - tolerance ? ['CRYPTO_MOMENTUM_NOT_CONFIRMED'] : []),
    ...(overheated ? ['CRYPTO_SETUP_OVEREXTENDED'] : []),
    ...(!(stopPrice > 0 && riskPercent > 0 && targetPrice > price) ? ['CRYPTO_STOP_TARGET_INVALID'] : []),
  ];
  const score = clamp(((higherHighs ? 1 : 0) + (higherLows ? 1 : 0) + (breakout || retest ? 1 : 0)) / 3 * 50 +
    Math.min(25, volumeRatio / 2 * 25) + (roc > 0 && !overheated ? 25 : 0));
  return { ...base, available: true, eligible: reasons.length === 0, score, reasons, route,
    assessedAt: new Date(now).toISOString(), barUpdatedAt: new Date(last.time + last.intervalMs).toISOString(),
    timeframeMinutes: last.intervalMs / 60000, barsFound: rows.length, price, resistance, stopPrice, targetPrice,
    targetBasis: 'MEASURED_RANGE_PROJECTION_NOT_GUARANTEED', riskPercent, volumeRatio, volumeConfirmed,
    higherHighs, higherLows, breakout, retest, momentum: { roc, priorRoc, accelerating: roc > priorRoc, extensionAtr, overheated },
    ema: { ema20, ema50, ema200, fullAlignment: ema200 !== null && price > ema20 && ema20 > ema50 && ema50 > ema200, required: false } };
}

export function cryptoSetupGate(signal, { now = Date.now() } = {}) {
  const setup = assessCryptoSetup(signal, { now });
  const btc = assessBtcContext(signal.btcMarketContext?.bars || [], { now });
  const reasons = [...setup.reasons, ...(!btc.available ? ['BTC_CONTEXT_UNAVAILABLE'] : btc.block ? [btc.reason] : [])];
  return { approved: reasons.length === 0, reasons, setup, btc };
}
