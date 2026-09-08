// Coalesce repeated updates for the same symbol, never across symbols or
// between quote events and decision snapshots. Polling reconciles overflow.
export function createLiveSignalPushQueue(maxEntries = 256) {
  const pending = new Map();
  return {
    enqueue(payload = {}) {
      const type = String(payload.type || "LIVE_SIGNAL_UPDATE");
      const symbol = String(payload.symbol || payload.quote?.symbol || "")
        .toUpperCase().replace(/^X:/, "").replace(/[\/-]/g, "");
      const key = type === "LIVE_QUOTE_DELTA" ? `${type}:${symbol}` : type;
      const previous = pending.get(key);
      if (previous && Number(previous.stateVersion) > Number(payload.stateVersion)) return;
      pending.delete(key);
      pending.set(key, payload);
      while (pending.size > maxEntries) pending.delete(pending.keys().next().value);
    },
    drain() {
      const payloads = [...pending.values()];
      pending.clear();
      return payloads;
    },
  };
}
