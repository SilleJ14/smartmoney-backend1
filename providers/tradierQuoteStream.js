import { normalizeTradierQuote } from './tradierMarketData.js';
import { readBoundedResponseJson, cancelResponseBody } from '../utils/boundedResponse.js';

// One market-data session per server. Never submits orders or logs credentials.
export function createTradierQuoteStream({ apiKey, WebSocketImpl, onQuote,
  fetchImpl = fetch, now = Date.now, sandbox = false, enabled = true } = {}) {
  let socket = null, connecting = null, session = null, symbols = [], stopped = false;
  let retryAt = 0, failures = 0, lastFrameAt = 0, generation = 0;
  let status = { connected: false, subscribedCount: 0, lastQuoteAt: null, error: null };
  const fail = reason => {
    const old = socket;
    socket = null; session = null; generation++;
    old?.terminate?.();
    retryAt = now() + Math.min(60000, 1000 * 2 ** Math.min(++failures, 6));
    status = { ...status, connected: false, error: reason, retryAt };
  };
  const subscribe = () => socket?.send(JSON.stringify({ symbols, sessionid: session,
    filter: ['quote'], linebreak: true, validOnly: true }));
  async function refresh(requested = []) {
    const next = [...new Set(requested.map(s => String(s).trim().toUpperCase()))]
      .filter(s => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)).slice(0, 120).sort();
    const changed = next.join(',') !== symbols.join(',');
    symbols = next;
    status.subscribedCount = symbols.length;
    if (!symbols.length) {
      generation++; const old = socket; socket = null; session = null;
      old?.terminate?.(); status.connected = false;
    }
    if (!enabled || !apiKey || sandbox || stopped || !symbols.length) return getStatus();
    if (socket?.readyState === 1) {
      if (now() - lastFrameAt > 60000) fail('STREAM_HEARTBEAT_TIMEOUT');
      else {
        try { if (changed) subscribe(); socket.ping?.(); }
        catch { fail('STREAM_SEND_FAILED'); }
        return getStatus();
      }
    }
    if (connecting) return connecting;
    if (socket || now() < retryAt) return getStatus();
    const epoch = ++generation;
    connecting = (async () => {
      try {
        const response = await fetchImpl('https://api.tradier.com/v1/markets/events/session', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) { cancelResponseBody(response); throw new Error('SESSION_FAILED'); }
        const body = await readBoundedResponseJson(response, { maxBytes: 16384, timeoutMs: 4000 });
        if (stopped || epoch !== generation) return getStatus();
        session = body?.stream?.sessionid;
        if (typeof session !== 'string' || !session || session.length > 512) throw new Error('SESSION_INVALID');
        const current = new WebSocketImpl('wss://ws.tradier.com/v1/markets/events', {
          maxPayload: 65536, perMessageDeflate: false, handshakeTimeout: 5000,
        });
        socket = current;
        current.on('open', () => {
          if (socket !== current || stopped) return;
          lastFrameAt = now();
          status = { ...status, connected: true, error: null, connectedAt: new Date(now()).toISOString() };
          try { subscribe(); } catch { fail('STREAM_SUBSCRIBE_FAILED'); }
        });
        current.on('pong', () => { if (socket === current) lastFrameAt = now(); });
        current.on('message', data => {
          if (socket !== current || stopped) return;
          if (Buffer.byteLength(data) > 65536) return fail('STREAM_MESSAGE_TOO_LARGE');
          lastFrameAt = now();
          for (const line of String(data).split('\n').filter(Boolean).slice(0, 200)) {
            try {
              const event = JSON.parse(line);
              if (event.error) { fail('STREAM_PROVIDER_ERROR'); return; }
              if (event.type !== 'quote' || !symbols.includes(event.symbol)) continue;
              const quote = normalizeTradierQuote({ ...event, type: 'stock',
                bid_date: event.biddate, ask_date: event.askdate }, { now: now() });
              if (!quote) continue;
              // Preserve the independent provider times, not the packet arrival time.
              onQuote(quote);
              failures = 0;
              status.lastQuoteAt = new Date(now()).toISOString();
              status.lastProviderQuoteAt = quote.liveQuoteUpdatedAt;
            } catch { status.error = 'STREAM_MESSAGE_INVALID'; }
          }
        });
        current.on('error', () => { if (socket === current) fail('STREAM_CONNECTION_ERROR'); });
        current.on('close', () => { if (socket === current) fail('STREAM_DISCONNECTED'); });
      } catch { if (!stopped && epoch === generation) fail('STREAM_SESSION_FAILED'); }
      return getStatus();
    })().finally(() => { connecting = null; });
    return connecting;
  }
  function getStatus() { return { ...status, enabled, configured: Boolean(apiKey), sandbox }; }
  function stop() { stopped = true; generation++; const old = socket; socket = null; old?.terminate?.(); status.connected = false; }
  return { refresh, getStatus, stop };
}
