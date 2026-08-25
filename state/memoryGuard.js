const mb = (bytes) => Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));

export function buildMemoryGuardSnapshot(
  memory = process.memoryUsage(),
  {
    limitMb = Number(process.env.RENDER_MEMORY_LIMIT_MB || 2048),
    softRatio = Number(process.env.MEMORY_GUARD_SOFT_RATIO || 0.72),
    hardRatio = Number(process.env.MEMORY_GUARD_HARD_RATIO || 0.85),
  } = {}
) {
  const safeLimitMb = Math.max(256, Number(limitMb) || 2048);
  const rssMb = mb(memory.rss);
  const heapUsedMb = mb(memory.heapUsed);
  const heapTotalMb = mb(memory.heapTotal);
  const externalMb = mb(memory.external);
  const usageRatio = rssMb / safeLimitMb;
  return {
    rssMb,
    heapUsedMb,
    heapTotalMb,
    externalMb,
    limitMb: safeLimitMb,
    usagePercent: Number((usageRatio * 100).toFixed(1)),
    softLimitMb: Number((safeLimitMb * softRatio).toFixed(2)),
    hardLimitMb: Number((safeLimitMb * hardRatio).toFixed(2)),
    pressure: usageRatio >= hardRatio
      ? "critical"
      : usageRatio >= softRatio
        ? "elevated"
        : "normal",
    shouldPauseHeavyWork: usageRatio >= softRatio,
  };
}
