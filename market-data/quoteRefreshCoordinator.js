// Independent, coalesced asset requests. Pending is not a provider failure.
export function createQuoteRefreshCoordinator({ fetchers, publish, isFresh, onState = () => {},
  now = Date.now, intervalMs = 2000, maxSymbols = 120 }) {
  const assets = new Map();
  function snapshot() {
    const states = [...assets.values()];
    const requested = [...new Set(states.flatMap(s => s.symbols))];
    const pending = states.some(s => s.pending);
    const failedSymbols = [...new Set(states.filter(s => !s.pending)
      .flatMap(s => s.symbols.filter(symbol => !isFresh(symbol))))];
    return { ok: !states.some(s => s.error), pending, requestedCount: requested.length,
      refreshedCount: states.reduce((sum, s) => sum + s.accepted, 0),
      freshCount: requested.filter(isFresh).length, failedSymbols,
      errors: states.flatMap(s => s.error ? [s.error] : []),
      refreshedAt: new Date(now()).toISOString(),
      assets: Object.fromEntries([...assets].map(([asset, s]) => [asset, {
        pending: s.pending, requestedCount: s.symbols.length, startedAt: s.startedAt,
        completedAt: s.completedAt, error: s.error,
      }])),
      reason: pending ? 'Quote refresh in progress; unfinished requests are not failures.'
        : failedSymbols.length ? 'Some symbols still lack fresh price and bid/ask evidence.' : 'Quote refresh completed.',
    };
  }
  function emit() { const state = snapshot(); onState(state); return state; }
  function refresh(groups = {}) {
    for (const [asset, fetchQuotes] of Object.entries(fetchers)) {
      const symbols = [...new Set(groups[asset] || [])].slice(0, maxSymbols);
      const previous = assets.get(asset);
      if (!symbols.length || previous?.pending || (previous && now() - previous.startedAt < intervalMs)) continue;
      const state = { symbols, pending: true, accepted: 0, error: null, startedAt: now(), completedAt: null };
      assets.set(asset, state);
      state.job = Promise.resolve().then(() => fetchQuotes(symbols))
        .then(async rows => { state.accepted = Number(await publish(rows || [])) || 0; })
        .catch(() => { state.error = `${asset.toUpperCase()}_QUOTE_REFRESH_FAILED`; })
        .finally(() => { state.pending = false; state.completedAt = now(); emit(); });
    }
    return emit();
  }
  return { refresh, getStatus: snapshot, whenIdle: () => Promise.all([...assets.values()].map(s => s.job)) };
}
