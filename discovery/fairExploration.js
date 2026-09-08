export function takeExplorationWindow(universe = [], priority = [], { cursor = 0, limit = 300 } = {}) {
  const pool = [...new Set(universe.filter(Boolean))];
  const selected = new Set(priority.filter(Boolean).slice(0, Math.max(0, limit - 1)));
  let visited = 0;
  while (visited < pool.length && selected.size < limit) {
    selected.add(pool[(cursor + visited) % pool.length]);
    visited += 1;
  }
  return { symbols: [...selected], cursor: pool.length ? (cursor + visited) % pool.length : 0 };
}

export function createFairReviewQueue(maxSymbols = 5000) {
  const pending = new Set();
  return (symbols, limit) => {
    for (const symbol of symbols) {
      if (pending.size >= maxSymbols) break;
      pending.add(symbol);
    }
    // A cache hit admits new seeds without consuming their review slots.
    const next = [...pending].slice(0, Math.max(0, limit));
    for (const symbol of next) pending.delete(symbol);
    return next;
  };
}
