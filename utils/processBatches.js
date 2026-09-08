const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function processBatches(
  items,
  batchSize,
  worker,
  { delayMs = 350, sleepFn = defaultSleep } = {}
) {
  const sourceItems = Array.isArray(items) ? items : [];
  const boundedBatchSize = Math.max(1, Math.floor(Number(batchSize || 1)));
  const boundedDelayMs = Math.max(0, Number(delayMs || 0));
  const results = [];
  for (let index = 0; index < sourceItems.length; index += boundedBatchSize) {
    const batch = sourceItems.slice(index, index + boundedBatchSize);
    const batchResults = await Promise.all(batch.map((item) => worker(item)));
    results.push(...batchResults.filter(Boolean));
    if (
      boundedDelayMs > 0 &&
      index + boundedBatchSize < sourceItems.length
    ) {
      await sleepFn(boundedDelayMs);
    }
  }
  return results;
}
