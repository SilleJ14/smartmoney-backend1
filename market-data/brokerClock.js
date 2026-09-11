// Share one request across scans, timers and orders. Never manufacture provider
// time or infer execution permission from the local trading calendar.
export function clockSnapshot(clock, now = Date.now()) {
  const age = now - Date.parse(clock?.timestamp || '');
  const fresh = typeof clock?.is_open === 'boolean' && clock?.stale !== true &&
    Number.isFinite(age) && age >= -5000 && age <= 60000;
  return { ...(clock || {}), is_open: fresh && clock.is_open === true,
    available: fresh, stale: !fresh,
    ...(!fresh ? { staleReason: clock?.staleReason || 'Broker clock unavailable or older than 60 seconds' } : {}) };
}

export function createBrokerClock({ request, now = Date.now, onUpdate = () => {},
  retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  refreshMs = 15000, failureRetryMs = 5000 } = {}) {
  let cached = null, pending = null, lastAttempt = -Infinity;
  const snapshot = () => clockSnapshot(cached, now());
  function get() {
    if (pending) return pending;
    const current = snapshot();
    if (now() - lastAttempt < (current.available ? refreshMs : failureRetryMs)) return Promise.resolve(current);
    lastAttempt = now();
    pending = (async () => {
      let failure;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const value = await request('/v2/clock', { timeoutMs: 2500, maxResponseBytes: 16384 });
          if (!clockSnapshot(value, now()).available) throw new Error('Invalid or stale broker clock response');
          cached = { ...value, stale: false, available: true };
          onUpdate(snapshot(), null);
          return snapshot();
        } catch (error) {
          failure = error;
          if (error?.status >= 400 && error?.status < 500 && error.status !== 429) break;
          if (attempt === 0) await retryDelay(200);
        }
      }
      cached = { ...(cached || {}), is_open: false, stale: true, available: false,
        staleReason: String(failure?.message || 'Broker clock unavailable').slice(0, 200) };
      onUpdate(snapshot(), failure);
      return snapshot();
    })().finally(() => { pending = null; });
    return pending;
  }
  return { get, snapshot };
}
