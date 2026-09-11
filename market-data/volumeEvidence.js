// Completed-bar participation, NOT session-relative volume. Missing is not zero.
export function recentBarVolumeEvidence(bars = [], { minBaselineBars = 5, maxBaselineBars = 20 } = {}) {
  const volume = bar => {
    const value = bar?.v ?? bar?.volume;
    return value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  };
  const latest = bars.at(-1);
  const timestamp = bar => {
    const raw = bar?.t ?? bar?.timestamp ?? bar?.time;
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value < 100000000000 ? value * 1000 : value : Date.parse(raw);
  };
  const sample = bars.slice(-maxBaselineBars - 1);
  const times = sample.map(timestamp);
  const deltas = times.slice(1).map((t, i) => t !== null && times[i] !== null ? t - times[i] : NaN)
    .filter(delta => Number.isFinite(delta) && delta > 0).sort((a, b) => a - b);
  const intervalMs = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  // Do not compare an intraday candle across a missing interval/overnight gap
  // or splice differently sourced observations into one baseline.
  let start = 0;
  for (let i = 1; i < sample.length; i += 1) {
    if (intervalMs && intervalMs <= 3600000 && Math.abs(times[i] - times[i - 1] - intervalMs) > 1000 ||
      sample[i].source && sample[i - 1].source && sample[i].source !== sample[i - 1].source) start = i;
  }
  const prior = sample.slice(start, -1);
  const volumes = prior.map(volume);
  const latestVolume = volume(latest);
  const complete = volumes.length >= minBaselineBars && volumes.every(v => v !== null);
  const baseline = complete ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : null;
  const available = latestVolume !== null && baseline > 0;
  return { available, ratio: available ? latestVolume / baseline : null,
    latestVolume, baselineVolume: baseline, baselineBars: prior.length, intervalMs,
    basis: 'LATEST_COMPLETED_BAR_VS_PRIOR_COMPLETED_BARS',
    latestBarAt: latest?.t ?? latest?.timestamp ?? latest?.time ?? null,
    missingReason: available ? null : latestVolume === null ? 'LATEST_BAR_VOLUME_UNAVAILABLE'
      : !complete ? 'VOLUME_BASELINE_INCOMPLETE' : 'VOLUME_BASELINE_ZERO',
  };
}

export function resolveRecentVolumeRatio(signal = {}) {
  const evidence = signal.confirmations?.recentVolume || signal.recentVolume;
  const raw = evidence ? evidence.ratio : signal.confirmations?.volumeSpikeRatio ?? signal.volumeRatio ?? signal.volumeSpikeRatio;
  return raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
}
