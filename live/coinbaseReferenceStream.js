// Market data only. Never submits orders and never touches Alpaca quotes.
// Coinbase Exchange public feed (no auth): "matches" supplies executed trades
// with provider time; "heartbeat" proves the socket is alive between trades.
// The trades are an independent reference used only to verify that a quiet,
// unchanged Alpaca crypto quote is still current.
export const COINBASE_REFERENCE_WS_URL = "wss://ws-feed.exchange.coinbase.com";
export const COINBASE_REFERENCE_SOURCE = "coinbase_exchange_matches";
const SYMBOL_PATTERN = /^[A-Z0-9]+\/USD$/;
const PRODUCT_PATTERN = /^[A-Z0-9]+-USD$/;

export function toCoinbaseProduct(symbol = "") {
  let clean = String(symbol || "").trim().toUpperCase();
  if (!clean.includes("/") && !clean.includes("-") && /^[A-Z0-9]{2,}USD$/.test(clean)) {
    clean = `${clean.slice(0, -3)}/USD`;
  }
  clean = clean.replace("-", "/");
  return SYMBOL_PATTERN.test(clean) ? clean.replace("/", "-") : null;
}

export function fromCoinbaseProduct(product = "") {
  const clean = String(product || "").trim().toUpperCase();
  return PRODUCT_PATTERN.test(clean) ? clean.replace("-", "/") : null;
}

export function createCoinbaseReferenceStream({
  WebSocket,
  getSymbols = () => [],
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onStatus = () => {},
  url = COINBASE_REFERENCE_WS_URL,
  maxProducts = 40,
  watchdogMs = 15000,
  tickMs = 1000,
  minBackoffMs = 1000,
  maxBackoffMs = 60000,
  maxFutureMs = 1000,
  rejectionMs = 15 * 60000,
} = {}) {
  let socket = null;
  let timer = null;
  let stopped = true;
  let lastMessageAt = 0;
  let connectedAt = 0;
  let retryAt = 0;
  let backoffMs = minBackoffMs;
  let requested = new Set();
  let confirmed = new Set();
  // product -> excluded until (ms). A product named by a subscribe failure is
  // retried after `rejectionMs`; until then it simply has no reference.
  const rejected = new Map();
  const isRejected = (product) => {
    const until = rejected.get(product);
    if (until === undefined) return false;
    if (now() < until) return true;
    rejected.delete(product);
    return false;
  };
  const references = new Map();
  const counters = { messages: 0, matches: 0, heartbeats: 0, rejectedMatches: 0, reconnects: 0, watchdogReconnects: 0 };
  let lastError = null;
  let open = false;

  function desiredProducts() {
    const products = [];
    const seen = new Set();
    let raw;
    try { raw = getSymbols(); } catch { raw = []; }
    for (const symbol of Array.isArray(raw) ? raw : []) {
      const product = toCoinbaseProduct(symbol);
      if (!product || seen.has(product) || isRejected(product)) continue;
      seen.add(product);
      products.push(product);
      if (products.length >= Math.max(1, Number(maxProducts) || 40)) break;
    }
    return products;
  }

  function send(message) {
    if (!socket || !open) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function subscribe() {
    if (!socket || !open) return;
    const next = desiredProducts();
    const nextSet = new Set(next);
    const remove = [...requested].filter((product) => !nextSet.has(product));
    const add = next.filter((product) => !requested.has(product));
    if (remove.length) {
      send({ type: "unsubscribe", product_ids: remove, channels: ["matches", "heartbeat"] });
      for (const product of remove) {
        requested.delete(product);
        confirmed.delete(product);
        references.delete(product);
      }
    }
    if (add.length) {
      send({ type: "subscribe", product_ids: add, channels: ["matches", "heartbeat"] });
      for (const product of add) requested.add(product);
    }
  }

  function disconnect(reason = null, { retryInMs = backoffMs } = {}) {
    const old = socket;
    socket = null;
    open = false;
    requested = new Set();
    confirmed = new Set();
    references.clear();
    if (reason) lastError = reason;
    retryAt = now() + Math.max(0, retryInMs);
    try { old?.close?.(); } catch { /* already closed */ }
  }

  function failAndBackOff(reason) {
    const wait = backoffMs;
    backoffMs = Math.min(Math.max(minBackoffMs, Number(maxBackoffMs) || 60000), Math.max(minBackoffMs, backoffMs * 2));
    disconnect(reason, { retryInMs: wait });
  }

  function confirmedProducts(message) {
    const products = new Set();
    for (const channel of Array.isArray(message.channels) ? message.channels : []) {
      const name = typeof channel === "string" ? channel : channel?.name;
      if (name !== "matches") continue;
      const ids = typeof channel === "string" ? message.product_ids : channel?.product_ids;
      for (const id of Array.isArray(ids) ? ids : []) {
        const product = String(id || "").toUpperCase();
        if (PRODUCT_PATTERN.test(product)) products.add(product);
      }
    }
    return products;
  }

  function ingestMatch(message, receivedAt) {
    const product = String(message.product_id || "").toUpperCase();
    const symbol = fromCoinbaseProduct(product);
    if (!symbol || !requested.has(product)) return;
    const price = Number(message.price);
    const tradeAt = Date.parse(String(message.time || ""));
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tradeAt) || tradeAt > receivedAt + maxFutureMs) {
      counters.rejectedMatches += 1;
      return;
    }
    const tradeId = Number(message.trade_id);
    const previous = references.get(product);
    if (previous && (tradeAt < previous.tradeAt ||
      (tradeAt === previous.tradeAt && Number.isFinite(tradeId) && Number.isFinite(previous.tradeId) && tradeId < previous.tradeId))) {
      return; // never let an older trade replace a newer reference
    }
    references.set(product, {
      symbol,
      product,
      price,
      tradeAt,
      receivedAt,
      tradeId: Number.isFinite(tradeId) ? tradeId : null,
      source: COINBASE_REFERENCE_SOURCE,
    });
    counters.matches += 1;
  }

  function handleMessage(ws, raw) {
    if (socket !== ws) return;
    let message;
    try { message = JSON.parse(String(raw)); } catch { lastError = "INVALID_MESSAGE"; return; }
    if (!message || typeof message !== "object") return;
    const receivedAt = now();
    lastMessageAt = receivedAt;
    counters.messages += 1;
    const type = String(message.type || "");
    if (type === "error") {
      const detail = String(message.reason || message.message || "COINBASE_ERROR").slice(0, 160);
      const text = `${String(message.message || "")} ${String(message.reason || "")}`;
      // A subscribe failure rejects that whole request. Exclude exactly the
      // requested, not yet confirmed products its reason names (for a while)
      // and re-request the remainder on the next tick; keep the socket. Only
      // a failure naming none of them reconnects the whole set.
      const subscribeFailure = /subscri/i.test(String(message.message || "")) || /not a valid product/i.test(text);
      const named = subscribeFailure
        ? [...new Set(text.toUpperCase().match(/\b[A-Z0-9]+-USD\b/g) || [])]
          .filter((product) => requested.has(product) && !confirmed.has(product))
        : [];
      if (named.length) {
        for (const product of named) rejected.set(product, receivedAt + Math.max(0, Number(rejectionMs) || 0));
        requested = new Set(confirmed);
        lastError = detail;
        return;
      }
      failAndBackOff(detail);
      return;
    }
    backoffMs = minBackoffMs;
    if (type === "subscriptions") {
      confirmed = confirmedProducts(message);
      for (const product of [...references.keys()]) if (!confirmed.has(product)) references.delete(product);
      return;
    }
    if (type === "heartbeat") { counters.heartbeats += 1; return; }
    if (type === "match" || type === "last_match") ingestMatch(message, receivedAt);
  }

  function connect() {
    const ws = new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 10000 });
    socket = ws;
    open = false;
    connectedAt = now();
    lastMessageAt = connectedAt;
    counters.reconnects += 1;
    ws.on("open", () => {
      if (socket !== ws) return;
      open = true;
      lastMessageAt = now();
      subscribe();
    });
    ws.on("message", (raw) => handleMessage(ws, raw));
    ws.on("error", (error) => { if (socket === ws) failAndBackOff(String(error?.message || "SOCKET_ERROR").slice(0, 160)); });
    ws.on("close", () => { if (socket === ws) failAndBackOff("SOCKET_CLOSED"); });
  }

  function tick() {
    if (stopped) return;
    try {
      const wanted = desiredProducts();
      if (socket && now() - lastMessageAt > watchdogMs) {
        counters.watchdogReconnects += 1;
        failAndBackOff("WATCHDOG_NO_MESSAGES");
      } else if (socket && !wanted.length) {
        disconnect(null, { retryInMs: 0 });
      } else if (!socket && wanted.length && now() >= retryAt) {
        connect();
      } else if (socket) {
        subscribe();
      }
    } catch (error) {
      failAndBackOff(String(error?.message || "TICK_FAILED").slice(0, 160));
    }
    try { onStatus(status()); } catch { /* telemetry cannot stop the feed */ }
    timer = setTimer(tick, tickMs);
    timer?.unref?.();
  }

  function getReference(symbol) {
    const product = toCoinbaseProduct(symbol);
    if (!product || !socket || !open) return null;
    const reference = references.get(product);
    return reference ? { ...reference } : null;
  }

  function status() {
    const at = now();
    const symbols = {};
    let freshReferenceCount = 0;
    for (const reference of references.values()) {
      const tradeAgeMs = at - reference.tradeAt;
      const receivedAgeMs = at - reference.receivedAt;
      if (tradeAgeMs <= 5000 && receivedAgeMs <= 5000) freshReferenceCount += 1;
      symbols[reference.symbol] = { price: reference.price, tradeAgeMs, receivedAgeMs };
    }
    return {
      enabled: true,
      source: COINBASE_REFERENCE_SOURCE,
      connected: Boolean(socket && open),
      connecting: Boolean(socket && !open),
      subscribedCount: confirmed.size,
      requestedCount: requested.size,
      subscribedProducts: [...confirmed].sort(),
      rejectedProducts: [...rejected.keys()].filter((product) => rejected.get(product) > at).sort(),
      lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
      lastMessageAgeMs: lastMessageAt ? at - lastMessageAt : null,
      connectedAt: connectedAt ? new Date(connectedAt).toISOString() : null,
      retryInMs: socket ? 0 : Math.max(0, retryAt - at),
      backoffMs,
      lastError,
      ...counters,
      referenceCount: references.size,
      freshReferenceCount,
      symbols,
    };
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      tick();
    },
    stop() {
      stopped = true;
      clearTimer(timer);
      disconnect(null, { retryInMs: 0 });
    },
    getReference,
    getStatus: status,
    status,
  };
}
