// Independent single-flight lanes: slow discovery cannot starve position protection.
export function createForexScheduler({ scan, protect, onError = () => {} }) {
  let scanning = false;
  let protecting = false;
  return {
    async scan() {
      if (scanning) return { skipped: "SCAN_RUNNING" };
      scanning = true;
      try { return await scan(); } catch (e) { onError("scan", e); }
      finally { scanning = false; }
    },
    async protect() {
      if (protecting) return { skipped: "PROTECTION_RUNNING" };
      protecting = true;
      try { return await protect(); } catch (e) { onError("protection", e); }
      finally { protecting = false; }
    },
  };
}
