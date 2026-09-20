// Bounded rolling observations, not a process-lifetime archive or score input.
export function createPipelineLatency(capacity = 256) {
  const samples = new Map();
  const limit = Math.min(1024, Math.max(16, capacity));
  function observe(assetClass, metric, value) {
    if (!['stock','crypto'].includes(assetClass) || !['queueWaitMs','calculationMs','totalDecisionLatencyMs','providerLatencyMs'].includes(metric) ||
        !Number.isFinite(value) || value < 0) return;
    const key = `${assetClass}:${metric}`;
    const values = samples.get(key) || [];
    values.push(value);
    if (values.length > limit) values.shift();
    samples.set(key,values);
  }
  function summary() {
    return Object.fromEntries([...samples].map(([key,values]) => {
      const sorted = [...values].sort((a,b) => a-b);
      const q = fraction => sorted[Math.max(0, Math.ceil(sorted.length*fraction)-1)];
      return [key,{sampleCount:sorted.length,p50:q(.5),p90:q(.9),p95:q(.95),p99:q(.99),max:q(1),window:'rolling_bounded'}];
    }));
  }
  return { observe, summary };
}
