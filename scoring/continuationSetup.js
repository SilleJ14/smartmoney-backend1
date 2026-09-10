// Price structure, not the size of today's percentage gain, establishes a
// continuation research setup. All prices/targets below are actually observed.
export function assessContinuationSetup(signal = {}, { now = Date.now() } = {}) {
  const raw = signal.stockChartBars || signal.chartBars || [];
  const rows = raw.slice(-30).map(bar => {
    const value = bar.time ?? bar.t;
    const numeric = Number(value);
    const time = value == null ? NaN : Number.isFinite(numeric)
      ? numeric < 1e10 ? numeric * 1000 : numeric : Date.parse(value);
    return { time, open: Number(bar.open ?? bar.o), high: Number(bar.high ?? bar.h),
      low: Number(bar.low ?? bar.l), close: Number(bar.close ?? bar.c), volume: Number(bar.volume ?? bar.v) };
  });
  if (rows.length < 20 || rows.some((bar, i) => !Object.values(bar).every(Number.isFinite) ||
    bar.low <= 0 || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close) ||
    bar.volume < 0 || bar.time > now || i > 0 && bar.time <= rows[i - 1].time) ||
    now - rows.at(-1)?.time > 10 * 60000 || rows.at(-1)?.time - rows[0]?.time > 180 * 60000) {
    return { available: false, eligible: false, score: null, reasons: ['CONTINUATION_BAR_HISTORY_UNAVAILABLE'] };
  }
  const price = Number(signal.price ?? signal.current);
  const recent = rows.slice(-3), base = rows.slice(0, -3);
  const target = Math.max(...base.map(bar => bar.high));
  const stop = Math.min(...recent.map(bar => bar.low));
  const risk = price - stop, reward = target - price;
  const riskPercent = price > 0 ? risk / price * 100 : Infinity;
  const rewardRisk = risk > 0 ? reward / risk : 0;
  const baseVolume = base.reduce((sum, bar) => sum + bar.volume, 0) / base.length;
  const volumeAcceleration = baseVolume > 0 ? recent.reduce((sum, bar) => sum + bar.volume, 0) / recent.length / baseVolume : 0;
  const higherLow = stop > Math.min(...base.slice(-5).map(bar => bar.low));
  const reclaim = recent.at(-1).close > recent.at(-2).high && price >= recent.at(-1).close;
  const pullbackPercent = target > 0 ? (target - stop) / target * 100 : 0;
  const reasons = [
    ...(!Number.isFinite(price) || price <= 0 ? ['CONTINUATION_PRICE_UNAVAILABLE'] : []),
    ...(!higherLow ? ['CONTINUATION_HIGHER_LOW_NOT_CONFIRMED'] : []),
    ...(!reclaim ? ['CONTINUATION_RECLAIM_NOT_CONFIRMED'] : []),
    ...(volumeAcceleration < 1.3 ? ['CONTINUATION_VOLUME_NOT_CONFIRMED'] : []),
    ...(pullbackPercent < 0.5 || pullbackPercent > 6 ? ['CONTINUATION_PULLBACK_NOT_CONTROLLED'] : []),
    ...(riskPercent <= 0 || riskPercent > 3 || rewardRisk < 1.5 ? ['CONTINUATION_REWARD_RISK_INSUFFICIENT'] : []),
  ];
  const score = Math.min(95, (higherLow ? 20 : 0) + (reclaim ? 25 : 0) +
    Math.min(25, volumeAcceleration * 12.5) + Math.max(0, Math.min(25, rewardRisk * 10)));
  return { available: true, eligible: reasons.length === 0, score: Number(score.toFixed(2)), reasons,
    assessedAt: new Date(now).toISOString(), barUpdatedAt: new Date(rows.at(-1).time).toISOString(),
    price, observedTarget: target, structuralStop: stop, rewardRisk, riskPercent, volumeAcceleration, pullbackPercent };
}
