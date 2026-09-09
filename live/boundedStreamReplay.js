// Retain serialized wire events, not references to mutable, deeply nested
// engine snapshots. Reconnection replay is best effort; polling reconciles
// older events beyond this count/byte window, as before.
export function createBoundedStreamReplay({ maxEntries = 100, maxBytes = 4 * 1024 * 1024 } = {}) {
  const rows = [];
  const limit = Math.max(1, Math.min(100, Math.floor(Number(maxEntries) || 100)));
  const byteLimit = Math.max(1, Math.min(4 * 1024 * 1024, Math.floor(Number(maxBytes) || 4 * 1024 * 1024)));
  let bytes = 0;
  return {
    add(event, message) {
      const size = Buffer.byteLength(message, 'utf8');
      if (size > byteLimit) return false;
      rows.push({ id: event.id, generatedAt: event.generatedAt, message, size });
      bytes += size;
      while (rows.length > limit || bytes > byteLimit) bytes -= rows.shift().size;
      return true;
    },
    since(since = '') {
      const index = since ? rows.findIndex(row => row.id === since) : -1;
      const timestamp = Date.parse(since);
      return rows.filter((row, position) => !since || (index >= 0
        ? position > index : Number.isFinite(timestamp) && Date.parse(row.generatedAt) > timestamp)).slice(-25);
    },
    getStatus: () => ({ count: rows.length, bytes, maxEntries: limit, maxBytes: byteLimit }),
  };
}
