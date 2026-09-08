// Independent single-flight jobs: a slow stock provider must not hold the
// crypto refresh cadence hostage. Results are published as each job finishes.
export function createAssetQuotePump() {
  const jobs = new Map();
  return (asset, fetchQuotes, publish) => {
    const state = jobs.get(asset) || { tail: Promise.resolve(), pending: 0 };
    if (state.pending >= 8) return Promise.reject(new Error(`Quote refresh queue full: ${asset}`));
    state.pending++;
    jobs.set(asset, state);
    const job = state.tail.then(fetchQuotes).then(async quotes => { await publish(quotes); return quotes; });
    state.tail = job.catch(() => {}).finally(() => {
      state.pending--;
      if (!state.pending) jobs.delete(asset);
    });
    return job;
  };
}
