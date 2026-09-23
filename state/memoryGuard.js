import fs from 'node:fs';
import v8 from 'node:v8';

const mb = (bytes) => Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Read once: health checks and quote ticks must not perform filesystem I/O.
export function detectMemoryBudget({ configured = process.env.RENDER_MEMORY_LIMIT_MB,
  constrained = process.constrainedMemory?.(), read = path => fs.readFileSync(path, 'utf8') } = {}) {
  const limits = [];
  const configuredMb = positive(configured);
  if (configuredMb) limits.push({ limitMb: configuredMb, limitSource: 'configured' });
  if (positive(constrained)) limits.push({ limitMb: Number(constrained) / 1048576, limitSource: 'process-constrained' });
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const bytes = positive(read(path).trim());
      // cgroup v1 uses a huge integer to mean unlimited; v2 uses "max".
      if (bytes && bytes < Number.MAX_SAFE_INTEGER) limits.push({ limitMb: bytes / 1048576, limitSource: 'cgroup' });
    } catch { /* Non-Linux hosts and containers without a readable cgroup. */ }
  }
  return limits.sort((a, b) => a.limitMb - b.limitMb)[0]
    ?? { limitMb: 512, limitSource: 'conservative-fallback' };
}
const detectedBudget = detectMemoryBudget();

export function buildMemoryGuardSnapshot(
  memory = process.memoryUsage(),
  {
    limitMb = detectedBudget.limitMb,
    softRatio = Number(process.env.MEMORY_GUARD_SOFT_RATIO || 0.60),
    hardRatio = Number(process.env.MEMORY_GUARD_HARD_RATIO || 0.75),
    // Exit 134 comes from the V8 heap, not the 2 GB container RSS budget.
    // Pause discovery while heap is still recoverable (~50% of heap_size_limit).
    heapSoftRatio = Number(process.env.MEMORY_GUARD_HEAP_SOFT_RATIO || 0.5),
    heapHardRatio = Number(process.env.MEMORY_GUARD_HEAP_HARD_RATIO || 0.65),
    heapLimitMb,
  } = {}
) {
  const safeLimitMb = positive(limitMb) ?? detectedBudget.limitMb;
  softRatio = positive(softRatio) && softRatio < 1 ? softRatio : 0.60;
  hardRatio = positive(hardRatio) && hardRatio > softRatio && hardRatio < 1
    ? hardRatio
    : Math.max(0.75, (softRatio + 1) / 2);
  heapSoftRatio = positive(heapSoftRatio) && heapSoftRatio < 1 ? heapSoftRatio : 0.5;
  heapHardRatio = positive(heapHardRatio) && heapHardRatio > heapSoftRatio && heapHardRatio < 1
    ? heapHardRatio
    : Math.max(0.65, (heapSoftRatio + 1) / 2);

  const rssMb = mb(memory.rss);
  const heapUsedMb = mb(memory.heapUsed);
  const heapTotalMb = mb(memory.heapTotal);
  const externalMb = mb(memory.external);
  const usageRatio = rssMb / safeLimitMb;
  const heapLimitBytes = positive(heapLimitMb)
    ? heapLimitMb * 1048576
    : v8.getHeapStatistics().heap_size_limit;
  const heapLimit = mb(heapLimitBytes);
  const heapRatio = heapLimit > 0 ? heapUsedMb / heapLimit : 0;
  const rssPressure = usageRatio >= hardRatio ? 'critical' : usageRatio >= softRatio ? 'elevated' : 'normal';
  const heapPressure = heapRatio >= heapHardRatio ? 'critical' : heapRatio >= heapSoftRatio ? 'elevated' : 'normal';
  const rank = { normal: 0, elevated: 1, critical: 2 };
  const pressure = rank[heapPressure] > rank[rssPressure] ? heapPressure : rssPressure;

  return {
    rssMb,
    heapUsedMb,
    heapTotalMb,
    externalMb,
    limitMb: safeLimitMb,
    limitSource: limitMb === detectedBudget.limitMb ? detectedBudget.limitSource : 'explicit',
    heapLimitMb: heapLimit,
    heapUsagePercent: Number((heapRatio * 100).toFixed(1)),
    usagePercent: Number((usageRatio * 100).toFixed(1)),
    softLimitMb: Number((safeLimitMb * softRatio).toFixed(2)),
    hardLimitMb: Number((safeLimitMb * hardRatio).toFixed(2)),
    pressure,
    shouldPauseHeavyWork: usageRatio >= softRatio || heapRatio >= heapSoftRatio,
  };
}
