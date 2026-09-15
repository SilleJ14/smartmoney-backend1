// Market-data only. Never submits orders and never replaces provider time.
export function createAlpacaCryptoStream({ WebSocket, key, secret, getSymbols, onQuote, onStatus = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let socket, timer, stopped = true, authenticated = false, lastMessage = 0, retryAt = 0;
  let subscribed = new Set(), symbolLimit = 120;
  const state = { connected: false, authenticated: false, quotes: 0, lastQuoteAt: null, errorCode: null };
  const allSymbols = () => [...new Set(getSymbols())].filter(s => /^[A-Z0-9]+\/USD$/.test(s));
  const desired = () => allSymbols().slice(0, symbolLimit);
  function subscribe() {
    if (!authenticated || !socket) return;
    const next = new Set(desired());
    const add = [...next].filter(s => !subscribed.has(s));
    const remove = [...subscribed].filter(s => !next.has(s));
    if (remove.length) socket.send(JSON.stringify({ action: 'unsubscribe', quotes: remove }));
    if (add.length) socket.send(JSON.stringify({ action: 'subscribe', quotes: add }));
    subscribed = next;
  }
  function disconnect() {
    const old = socket; socket = null; authenticated = false; subscribed.clear();
    state.connected = false; state.authenticated = false;
    try { old?.close(); } catch { /* already closed */ }
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
            // Never reconnect with the same rejected batch forever. REST polling
            // remains responsible for symbols outside the learned stream budget.
            if (Number(q.code) === 405 && subscribed.size > 1) {
              symbolLimit = Math.max(1, Math.floor(subscribed.size / 2));
              retryAt = now() + 5000;
            } else retryAt = now() + 60000;
            disconnect(); return;
          }
          if (!authenticated || q.T !== 'q' || !subscribed.has(q.S)) continue;
          const at = Date.parse(q.t), bid = Number(q.bp), ask = Number(q.ap);
          if (!Number.isFinite(at) || at > now() + 5000 || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) continue;
          const stamp = new Date(at).toISOString();
          onQuote(q.S, { symbol: q.S, price: (bid + ask) / 2, bid, ask,
            spreadAvailable: true, source: 'alpaca_crypto_ws', liveQuoteSource: 'alpaca_crypto_ws',
            spreadSource: 'alpaca_crypto_ws', liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp,
            bidAskUpdatedAt: stamp, assetClass: 'crypto', priceIsLive: now() - at <= 5000 });
          state.quotes++; state.lastQuoteAt = stamp;
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
    timer = setTimer(tick, 5000); timer?.unref?.();
  }
  function status() {
    return { ...state, subscribedCount: subscribed.size, symbolLimit,
      restOnlySymbolCount: Math.max(0, allSymbols().length - subscribed.size) };
  }
  return {
    start() { if (!stopped || !key || !secret) return; stopped = false; tick(); },
    stop() { stopped = true; clearTimer(timer); disconnect(); },
    getStatus: status,
  };
}
