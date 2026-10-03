// Order books are execution evidence that must be under 5 s old (provider time)
// at decision, sizing and display. Streaming prices stay fresh on their own, so
// books need their own refresh: the top setup-eligible candidates, one batch.
// Books still fresh by provider time are skipped, and failures back off, so this
// cannot burn the shared Alpaca data budget that orders and prices also need.
export function createCryptoOrderbookRefresher({
  getLatestOrderbooks,
  normalizeSymbol,
  isCrypto,
  getCanonicalFinalScore,
  attachShadow,
  onError = () => {},
  now = Date.now,
  limit = 20,
  minRefreshAgeMs = 1000,
  backoffMs = 5000,
  maxBackoffMs = 60000,
} = {}) {
  let blockedUntil = 0;
  let failures = 0;
  const bookAgeMs = (signal) => now() - Date.parse(signal?.cryptoOrderbook?.updatedAt || "");

  function selectSymbols(rankFrom = []) {
    const freshest = new Map();
    for (const signal of Array.isArray(rankFrom) ? rankFrom : []) {
      if (!signal || !isCrypto(signal.symbol) || signal.cryptoSetup?.eligible !== true) continue;
      const symbol = normalizeSymbol(signal.symbol);
      const age = bookAgeMs(signal);
      const known = freshest.get(symbol);
      if (!known || (Number.isFinite(age) && !(known.age <= age))) freshest.set(symbol, { signal, age });
    }
    return [...freshest.entries()]
      .sort(([, a], [, b]) => (getCanonicalFinalScore(b.signal) ?? 0) - (getCanonicalFinalScore(a.signal) ?? 0))
      .slice(0, limit)
      .filter(([, { age }]) => !(Number.isFinite(age) && age >= 0 && age < minRefreshAgeMs))
      .map(([symbol]) => symbol);
  }

  async function fetchBooks(rankFrom = []) {
    if (now() < blockedUntil) return new Map();
    const symbols = selectSymbols(rankFrom);
    if (!symbols.length) return new Map();
    try {
      const books = await getLatestOrderbooks(symbols);
      failures = 0;
      blockedUntil = 0;
      return new Map((Array.isArray(books) ? books : [])
        .filter((book) => book && symbols.includes(book.symbol))
        .map((book) => [book.symbol, book]));
    } catch (error) {
      failures += 1;
      const wait = Math.min(maxBackoffMs, Math.max(Number(error?.retryAfterMs) || 0, backoffMs * 2 ** (failures - 1)));
      blockedUntil = now() + wait;
      if (failures === 1 || failures % 10 === 0) onError(error, { failures, retryInMs: wait });
      return new Map();
    }
  }

  function attachBooks(bookBySymbol, attachTo = [], afterAttach = attachShadow) {
    let attached = 0;
    for (const collection of attachTo) {
      for (const signal of Array.isArray(collection) ? collection : []) {
        const book = bookBySymbol.get(normalizeSymbol(signal?.symbol));
        if (!book) continue;
        signal.cryptoOrderbook = book;
        afterAttach(signal);
        attached += 1;
      }
    }
    return attached;
  }

  async function refreshTopCryptoOrderbooks(rankFrom = [], attachTo = [rankFrom]) {
    return attachBooks(await fetchBooks(rankFrom), attachTo);
  }
  return Object.assign(refreshTopCryptoOrderbooks, { fetchBooks, attachBooks });
}
