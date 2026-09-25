// Market-data only. Never submits orders and never replaces provider time.
function firstBookPrice(rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const price = Number(row?.p ?? row?.[0]);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return 0;
}

export function createAlpacaCryptoStream({ WebSocket, key, secret, getSymbols, onQuote, onStatus = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let socket, timer, stopped = true, authenticated = false, lastMessage = 0, retryAt = 0, last405At = 0;
  let subscribed = new Set(), symbolLimit = 120;
  const state = { connected: false, authenticated: false, quotes: 0, lastQuoteAt: null, errorCode: null };
  const allSymbols = () => [...new Set(getSymbols())].filter(s => /^[A-Z0-9]+\/USD$/.test(s));
  const desired = () => allSymbols().slice(0, symbolLimit);
  function sendChannel(action, symbols) {
    if (!socket || !symbols.length) return;
    socket.send(JSON.stringify({ action, quotes: symbols, orderbooks: symbols }));
  }
  function subscribe() {
    if (!authenticated || !socket) return;
    const next = new Set(desired());
    const add = [...next].filter(s => !subscribed.has(s));
    const remove = [...subscribed].filter(s => !next.has(s));
    sendChannel('unsubscribe', remove);
    sendChannel('subscribe', add);
    subscribed = next;
  }
  function shrinkToLimit() {
    const keep = desired();
    const remove = [...subscribed].filter(s => !keep.includes(s));
    sendChannel('unsubscribe', remove);
    subscribed = new Set(keep);
  }
  function disconnect() {
    const old = socket; socket = null; authenticated = false; subscribed.clear();
    state.connected = false; state.authenticated = false;
    try { old?.close(); } catch { /* already closed */ }
  }
  function ingestQuote(symbol, bid, ask, at, source, book = {}) {
    if (!Number.isFinite(at) || at > now() + 5000 || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return;
    const stamp = new Date(at).toISOString();
    onQuote(symbol, { symbol, price: (bid + ask) / 2, bid, ask,
      spreadAvailable: true, source, liveQuoteSource: source,
      spreadSource: source, liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp,
      bidAskUpdatedAt: stamp, assetClass: 'crypto', priceIsLive: now() - at <= 5000,
      bidPrice: bid, askPrice: ask,
      bidSizeRaw: Number.isFinite(Number(book.bidSize)) ? Number(book.bidSize) : null,
      askSizeRaw: Number.isFinite(Number(book.askSize)) ? Number(book.askSize) : null,
      bidSizeShares: Number.isFinite(Number(book.bidSize)) ? Number(book.bidSize) : null,
      askSizeShares: Number.isFinite(Number(book.askSize)) ? Number(book.askSize) : null,
      sizeUnit: book.bidSize == null && book.askSize == null ? null : 'base_units',
      provider: 'alpaca', feed: source, quoteTimestamp: stamp });
    state.quotes++; state.lastQuoteAt = stamp;
  }
  function connect() {
    const ws = new WebSocket('wss://stream.data.alpaca.markets/v1beta3/crypto/us');
    socket = ws; lastMessage = now();
    ws.on('open', () => { if (socket === ws) { state.connected = true; ws.send(JSON.stringify({ action: 'auth', key, secret })); } });
    ws.on('message', raw => {
      if (socket !== ws) return;
      try {
        const rows = JSON.parse(String(raw));
        if (!Array.isArray(rows)) return;
        lastMessage = now();
        for (const q of rows) {
          if (q.T === 'success' && q.msg === 'authenticated') {
            authenticated = true; state.authenticated = true; state.errorCode = null; subscribe();
          }
          if (q.T === 'error') {
            state.errorCode = q.code;
            // 405 is a symbol entitlement limit, not an authentication failure.
            // Stay on the socket and drop symbols in place so the remaining
            // books do not go dark for a reconnect. REST covers overflow.
            if (Number(q.code) === 405 && subscribed.size > 1) {
              const rapid = last405At && now() - last405At < 2000;
              symbolLimit = Math.max(1, rapid
                ? Math.floor(subscribed.size / 2)
                : subscribed.size - 1);
              last405At = now();
              shrinkToLimit();
              state.errorCode = null;
              continue;
            }
            retryAt = now() + 60000;
            disconnect(); return;
          }
          const wanted = subscribed.has(q.S) || desired().includes(q.S);
          if (!authenticated || !wanted) continue;
          if (q.T === 'q') ingestQuote(q.S, Number(q.bp), Number(q.ap), Date.parse(q.t), 'alpaca_crypto_ws', { bidSize: q.bs, askSize: q.as });
          if (q.T === 'o') ingestQuote(q.S, firstBookPrice(q.b), firstBookPrice(q.a), Date.parse(q.t), 'alpaca_crypto_orderbook', {
            bidSize: Array.isArray(q.b) ? q.b[0]?.s : null,
            askSize: Array.isArray(q.a) ? q.a[0]?.s : null,
          });
        }
      } catch { state.errorCode = 'INVALID_MESSAGE_OR_CALLBACK'; }
    });
    ws.on('error', () => { if (socket === ws) { retryAt = now() + 15000; disconnect(); } });
    ws.on('close', () => { if (socket === ws) { retryAt = now() + 15000; disconnect(); } });
  }
  function tick() {
    if (stopped) return;
    try {
      if (socket && now() - lastMessage > (authenticated ? 60000 : 10000)) disconnect();
      if (!socket && now() >= retryAt) connect();
      else subscribe();
    } catch { retryAt = now() + 15000; disconnect(); }
    try { onStatus(status()); } catch { /* telemetry cannot stop feed */ }
    timer = setTimer(tick, 1000); timer?.unref?.();
  }
  function status() {
    return { ...state, subscribedCount: subscribed.size, symbolLimit,
      subscribedSymbols: [...subscribed],
      restOnlySymbolCount: Math.max(0, allSymbols().length - subscribed.size) };
  }
  return {
    start() { if (!stopped || !key || !secret) return; stopped = false; tick(); },
    stop() { stopped = true; clearTimer(timer); disconnect(); },
    getStatus: status,
  };
}
