// Problem #40: V4 route labels used to imply several strategies. Qualification
// was one checklist. Each pattern is now evaluated on its own evidence.
// BTC, chase, spread, and the order book are not part of setup identity.
import { normalizeCryptoVolume } from '../market-data/normalizeCryptoVolume.js';
import { barSnapshot } from '../market-data/barSnapshot.js';
import { assessCryptoSetupModels } from './cryptoSetupModels.js';
import { buildBtcRegime, buildBtcRegimeOutcome } from './btcRegime.js';
export const CRYPTO_SETUP_MODEL = 'CRYPTO_SETUP_V1';
const finite = x => x !== null && x !== '' && Number.isFinite(Number(x));
const mean = rows => rows.reduce((s, n) => s + n, 0) / Math.max(1, rows.length);
function stamp(value) {
  if (value == null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n < 1e10 ? n * 1000 : n : Date.parse(value);
}
const normalizedHistory = new WeakMap();
function normalizeHistory(input) {
  if (normalizedHistory.has(input)) return normalizedHistory.get(input);
  const rows = [];
  for (let i = 0; i < input.length; i++) {
    const b = input[i], volume = normalizeCryptoVolume(b);
    if (!volume) return null;
    if (i < input.length - 240) continue;
    rows.push({ time: stamp(b.time ?? b.t), open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h), low: Number(b.low ?? b.l), close: Number(b.close ?? b.c),
      volume: volume.volume, intervalMs: Number(b.intervalMs),
      marketVolume: b.marketVolume == null ? null : Number(b.marketVolume),
      marketVolumeSource: b.marketVolumeSource });
  }
  // Only detached, deeply frozen histories have stable field values. Mutable
  // inputs must be re-read; freshness/completion checks below always run.
  const frozen = value => !value || typeof value !== 'object' ||
    Object.isFrozen(value) && Object.values(value).every(frozen);
  if (frozen(input)) normalizedHistory.set(input, rows);
  return rows;
}
export function completedCryptoBars(input, now = Date.now()) {
  if (!Array.isArray(input)) return [];
  const rows = normalizeHistory(input);
  if (!rows) return [];
  if (rows.length < 2 || rows.some((b, i) =>
    ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
    b.low <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) ||
    b.volume < 0 || b.time > now || (i && b.time <= rows[i - 1].time))) return [];
  const gaps = rows.slice(1).map((b, i) => b.time - rows[i].time).sort((a, b) => a - b);
  const interval = finite(rows.at(-1).intervalMs) && rows.at(-1).intervalMs > 0
    ? rows.at(-1).intervalMs : gaps[Math.floor(gaps.length / 2)];
  if (interval < 60000 || interval > 900000) return [];
  // Retain only the contiguous recent window. An old gap must not erase newer
  // evidence, but never bridge a gap or manufacture zero-volume candles.
  let start = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].time - rows[i - 1].time !== interval) start = i;
  }
  const done = rows.slice(start).filter(b => b.time + interval <= now).map(b => ({ ...b, intervalMs: interval }));
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
  if (rows.length < 20) return { available: false, block: false, reason: 'BTC_CONTEXT_UNAVAILABLE',
    oneHourReturn: null, below20BarAverage: null, bars: [] };
  const last = rows.at(-1), reference = rows.find(b => b.time >= last.time - 3600000) || rows[0];
  const changePercent = (last.close / reference.close - 1) * 100;
  const volatilityPercent = mean(rows.slice(-12).map(b => (b.high - b.low) / b.close * 100));
  const trend = ema(rows.map(b => b.close), 20);
  const below20BarAverage = last.close < trend;
  const block = changePercent <= -3 && below20BarAverage;
  return { available: true, block, reason: block ? 'BTC_SHARP_DECLINE' : 'BTC_CONTEXT_ACCEPTABLE',
    changePercent, oneHourReturn: changePercent, below20BarAverage,
    windowMinutes: (last.time - reference.time) / 60000, volatilityPercent,
    belowEma20: below20BarAverage, barUpdatedAt: new Date(last.time + last.intervalMs).toISOString(),
    // Keep enough source evidence to recheck freshness on the final order path.
    bars: rows.slice(-24) };
}
export function assessCryptoSetup(signal = {}, { now = Date.now() } = {}) {
  const rows = completedCryptoBars(signal.chartBars || [], now);
  const price = Number(signal.price ?? signal.current);
  const base = { model: CRYPTO_SETUP_MODEL, available: false, eligible: false, score: null,
    inputBarSnapshotId: barSnapshot(signal.chartBars).id,
    derivatives: { openInterest: { available: false, required: false }, funding: { available: false, required: false } } };
  if (!rows.length) return { ...base, reasons: ['CRYPTO_SETUP_HISTORY_UNAVAILABLE'] };
  if (!(price > 0)) return { ...base, reasons: ['CRYPTO_SETUP_PRICE_UNAVAILABLE'] };
  const assessment = assessCryptoSetupModels(rows, price);
  const selected = assessment.selectedSetup ? assessment.candidates[assessment.selectedSetup] : null;
  const last = rows.at(-1);
  const closes = rows.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const prior = rows.slice(-23, -3);
  const resistance = prior.length ? Math.max(...prior.map((bar) => bar.high)) : last.high;
  const range = prior.length ? resistance - Math.min(...prior.map((bar) => bar.low)) : 0;
  const targetPrice = resistance + range;
  const breakout = assessment.candidates.BREAKOUT;
  const retest = assessment.candidates.RETEST;
  const reasons = assessment.exhausted
    ? ["EXHAUSTION"]
    : selected
      ? selected.reasons.filter((reason) => reason === "TARGET_REASSESSMENT_REQUIRED")
      : ["NO_VALID_CRYPTO_SETUP"];
  return {
    ...base,
    available: Object.values(assessment.candidates).some((candidate) => candidate.state !== "DATA_UNAVAILABLE"),
    eligible: Boolean(selected) && !assessment.exhausted,
    score: selected?.score ?? null,
    reasons,
    route: selected ? assessment.selectedSetup : "DEVELOPING_EARLY",
    cryptoSetupAssessment: assessment,
    entryTiming: assessment.entryTiming,
    assessedAt: new Date(now).toISOString(),
    barUpdatedAt: new Date(last.time + last.intervalMs).toISOString(),
    timeframeMinutes: last.intervalMs / 60000,
    barsFound: rows.length,
    price,
    resistance,
    stopPrice: assessment.stopPrice,
    targetPrice,
    targetBasis: "MEASURED_RANGE_PROJECTION_NOT_GUARANTEED",
    targetReassessment: selected?.targetReassessment === true,
    volumeConfirmed: breakout?.requiredEvidence?.breakBarVolume === "PASS",
    volumeRatio: breakout?.volumeRatio ?? null,
    higherHighs: assessment.higherHighs,
    higherLows: assessment.higherLows,
    breakout: breakout?.state === "PASS",
    retest: retest?.state === "PASS",
    ema: {
      ema20,
      ema50,
      ema200,
      fullAlignment: ema200 !== null && price > ema20 && ema20 > ema50 && ema50 > ema200,
      required: false,
    },
  };
}

export function cryptoSetupGate(signal, { now = Date.now() } = {}) {
  const setup = assessCryptoSetup(signal, { now });
  const rawBtc = signal.btcMarketContext?.bars || (Array.isArray(signal.btcMarketContext) ? signal.btcMarketContext : []);
  const btc = assessBtcContext(rawBtc, { now });
  const btcRegime = buildBtcRegime(btc);
  const marketRegime = !btc.available
    ? { state: "DATA_UNAVAILABLE", reason: "BTC_CONTEXT_UNAVAILABLE", sizeMultiplier: null }
    : btc.block
      ? { state: "PASS_WITH_CONSTRAINT", reason: "BTC_SHARP_DECLINE", sizeMultiplier: null }
      : { state: "PASS", reason: btc.reason, sizeMultiplier: null };
  return {
    approved: setup.eligible === true,
    reasons: setup.eligible ? setup.reasons.filter((reason) => reason !== "TARGET_REASSESSMENT_REQUIRED") : setup.reasons,
    setup,
    btc,
    btcRegime,
    btcRegimeOutcome: buildBtcRegimeOutcome({
      symbol: signal.symbol,
      btcRegime,
      cryptoSetup: setup,
      cryptoDecisionScore: signal.cryptoDecisionScore,
      cryptoAnalyticalShadow: signal.cryptoAnalyticalShadow,
      legacyCryptoF: signal.cryptoAnalyticalShadow?.legacyCryptoF,
    }, { proposedSize: signal.finalApprovedTradeAmount ?? signal.intendedNotional ?? null, recordedAt: new Date(now).toISOString() }),
    marketRegime,
    entryTiming: setup.entryTiming,
  };
}
