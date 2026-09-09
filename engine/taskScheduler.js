export function createTaskScheduler({ now = () => Date.now(), onError = () => {} } = {}) {
  const locks = new Set();
  const lastRuns = new Map();
  async function run(taskName, intervalMs, worker) {
    const timestamp = now();
    if (locks.has(taskName)) return { ran: false, reason: "locked" };
    if (timestamp - Number(lastRuns.get(taskName) || 0) < intervalMs) {
      return { ran: false, reason: "interval" };
    }
    locks.add(taskName);
    lastRuns.set(taskName, timestamp);
    try {
      await worker();
      return { ran: true, reason: "completed" };
    } catch (error) {
      // These jobs are also launched from timers/feed callbacks. A failure in
      // error reporting (for example a full disk) must not create a second,
      // unobserved rejection and terminate the process.
      let reportingError;
      try { await onError(taskName, intervalMs, error); }
      catch (failure) { reportingError = failure; }
      return { ran: true, reason: "failed", error, ...(reportingError ? { reportingError } : {}) };
    } finally {
      locks.delete(taskName);
    }
  }
  return { run, isLocked: (name) => locks.has(name), lastRunAt: (name) => lastRuns.get(name) || 0 };
}
