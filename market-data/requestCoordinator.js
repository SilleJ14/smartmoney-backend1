// Per-provider bounded admission. No market timestamps are refreshed here and
// no successful market data is cached. Trading/order requests never use this queue.
export function createRequestCoordinator(request, { concurrency = 4, maxPending = 64,
  now = Date.now, cooldownMs = 30000 } = {}) {
  const pending = new Map(), queue = [];
  let active = 0, blockedUntil = 0;
  const rateError = () => Object.assign(new Error('Provider rate-limit cooldown active'),
    { status: 429, retryAfterMs: Math.max(0, blockedUntil - now()) });
  function drain() {
    if (blockedUntil > now()) {
      for (const job of queue.splice(0)) { pending.delete(job.key); job.reject(rateError()); }
      return;
    }
    queue.sort((a, b) => b.priority - a.priority);
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (now() - job.enqueuedAt >= job.deadlineMs) {
        pending.delete(job.key); job.reject(new Error('Provider request queue deadline exceeded')); continue;
      }
      active++;
      Promise.resolve().then(() => request(job.path, job.options)).then(job.resolve, error => {
        if (Number(error.status) === 429) {
          const retry = Number(error.retryAfterMs);
          blockedUntil = Math.max(blockedUntil, now() + (Number.isFinite(retry) && retry > 0 ? retry : cooldownMs));
        }
        job.reject(error);
      }).finally(() => { active--; pending.delete(job.key); setImmediate(drain); });
    }
  }
  return function coordinated(path, options = {}) {
    if (blockedUntil > now()) return Promise.reject(rateError());
    const key = `${path}:${options.timeoutMs ?? ''}:${options.maxResponseBytes ?? ''}`;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= maxPending) return Promise.reject(new Error('Provider request queue capacity reached'));
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    pending.set(key, promise);
    queue.push({ key, path, options, resolve, reject, enqueuedAt: now(),
      priority: path.includes('/orderbooks') ? 2 : path.includes('/latest/') ? 1 : 0,
      deadlineMs: options.timeoutMs ?? 12000 });
    drain();
    return promise;
  };
}
