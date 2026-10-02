// Independent single-flight lanes: slow discovery cannot starve position protection.
export function createForexScheduler({ scan, protect, onError = () => {}, onQueueWait = () => {}, now = Date.now }) {
  let scanning = false;
  let protecting = false;
  let queuedScan = null;
  const api = {
    async scan() {
      if (scanning) {
        if (!queuedScan) queuedScan = { requestedAt: now(), waiters: [] };
        return new Promise(resolve => queuedScan.waiters.push(resolve));
      }
      scanning = true;
      try { return await scan(); } catch (e) { onError("scan", e); }
      finally {
        scanning = false;
        if (queuedScan) {
          const queued = queuedScan;
          queuedScan = null;
          queueMicrotask(async () => {
            onQueueWait(Math.max(0, now() - queued.requestedAt));
            const result = await api.scan();
            queued.waiters.forEach(resolve => resolve(result));
          });
        }
      }
    },
    async protect() {
      if (protecting) return { skipped: "PROTECTION_RUNNING" };
      protecting = true;
      try { return await protect(); } catch (e) { onError("protection", e); }
      finally { protecting = false; }
    },
  };
  return api;
}
