import { FOREX_SPEC } from "./forexSpec.js";

const PRACTICE_STREAM_URL = "https://stream-fxpractice.oanda.com";
const LIVE_STREAM_HOST = "stream-fxtrade.oanda.com";

export function createChunkedLineParser({ maxLineBytes = 1024 * 1024 } = {}) {
  let pending = "";
  const decoder = new TextDecoder();
  const parse = (line) => {
    const value = line.trim();
    if (!value) return [];
    if (Buffer.byteLength(value) > maxLineBytes) throw new Error("OANDA_STREAM_LINE_TOO_LARGE");
    try { return [JSON.parse(value)]; }
    catch { throw new Error("OANDA_STREAM_MALFORMED_JSON"); }
  };
  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (Buffer.byteLength(pending) > maxLineBytes && !pending.includes("\n")) throw new Error("OANDA_STREAM_LINE_TOO_LARGE");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      return lines.flatMap(parse);
    },
    finish() {
      pending += decoder.decode();
      const rows = parse(pending);
      pending = "";
      return rows;
    },
  };
}

export function oandaReconnectDelay(attempt, { baseMs = 250, maxMs = 30000 } = {}) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, Number(attempt) || 0)));
}

async function httpFetch(url, options) {
  if (typeof fetch === "function") return fetch(url, options);
  const module = await import("node-fetch");
  const nodeFetch = module.default || module;
  return nodeFetch(url, options);
}

function isLiveHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname === FOREX_SPEC.liveApiHostForbidden;
  } catch {
    return String(baseUrl || "").includes(FOREX_SPEC.liveApiHostForbidden);
  }
}

export function pickOandaAccount(accounts = []) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const withId = rows.map((row) => row?.id || row).filter(Boolean);
  return String(withId[0] || "");
}

export function createOandaClient({
  accountId,
  token,
  baseUrl = FOREX_SPEC.practiceApiUrl,
  streamBaseUrl = PRACTICE_STREAM_URL,
  fetchImpl,
} = {}) {
  const host = String(baseUrl || FOREX_SPEC.practiceApiUrl).replace(/\/$/, "");
  const liveHost = isLiveHost(host);
  let resolvedAccountId = String(accountId || "");

  function assertPracticeStreamHost() {
    let hostname;
    try { hostname = new URL(streamBaseUrl).hostname; } catch {}
    if (hostname !== new URL(PRACTICE_STREAM_URL).hostname || hostname === LIVE_STREAM_HOST) {
      const error = new Error("LIVE_FOREX_STREAM_NOT_AUTHORIZED");
      error.halt = "LIVE_BLOCKED";
      throw error;
    }
  }

  async function* stream(path, {
    signal,
    maxLineBytes,
    heartbeatTimeoutMs = 15000,
    now = () => Date.now(),
  } = {}) {
    assertPracticeStreamHost();
    if (!token) throw Object.assign(new Error("MISSING_OANDA_TOKEN"), { halt: "MISSING_CREDENTIALS" });
    const response = await (fetchImpl || httpFetch)(`${String(streamBaseUrl).replace(/\/$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok || !response.body) {
      throw Object.assign(new Error(`OANDA STREAM ${response.status}`), { status: response.status });
    }
    const parser = createChunkedLineParser({ maxLineBytes });
    let lastMessageAt = now();
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("OANDA_STREAM_HEARTBEAT_TIMEOUT")), heartbeatTimeoutMs);
        timer.unref?.();
      });
      let result;
      try { result = await Promise.race([iterator.next(), timeout]); }
      finally { clearTimeout(timer); }
      if (result.done) break;
      const chunk = result.value;
      if (now() - lastMessageAt > heartbeatTimeoutMs) throw new Error("OANDA_STREAM_HEARTBEAT_TIMEOUT");
      for (const row of parser.push(chunk)) {
        lastMessageAt = now();
        yield row;
      }
    }
    for (const row of parser.finish()) yield row;
  }

  async function request(method, path, body) {
    if (liveHost) {
      const error = new Error("LIVE_FOREX_HOST_NOT_AUTHORIZED");
      error.halt = "LIVE_BLOCKED";
      throw error;
    }
    if (!token) {
      const error = new Error("MISSING_OANDA_TOKEN");
      error.halt = "MISSING_CREDENTIALS";
      throw error;
    }
    const response = await (fetchImpl || httpFetch)(`${host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Datetime-Format": "RFC3339",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(data?.errorMessage || data?.message || `OANDA ${response.status}`);
      error.status = response.status;
      error.halt = response.status === 401 || response.status === 403 ? "MISSING_CREDENTIALS" : "UNCERTAIN_ORDER";
      error.data = data;
      throw error;
    }
    return data;
  }

  async function resolveAccountId() {
    if (resolvedAccountId) return resolvedAccountId;
    const data = await request("GET", "/v3/accounts");
    resolvedAccountId = pickOandaAccount(data?.accounts);
    if (!resolvedAccountId) {
      const error = new Error("MISSING_OANDA_ACCOUNT");
      error.halt = "MISSING_CREDENTIALS";
      throw error;
    }
    return resolvedAccountId;
  }

  return {
    get accountId() {
      return resolvedAccountId;
    },
    token: String(token || ""),
    baseUrl: host,
    liveHost,
    streamBaseUrl,
    resolveAccountId,
    async getAccounts() {
      return request("GET", "/v3/accounts");
    },
    async getAccount() {
      const id = await resolveAccountId();
      return request("GET", `/v3/accounts/${encodeURIComponent(id)}`);
    },
    async getPrices(instruments = []) {
      const id = await resolveAccountId();
      const names = instruments.join(",");
      return request(
        "GET",
        `/v3/accounts/${encodeURIComponent(id)}/pricing?instruments=${encodeURIComponent(names)}&includeHomeConversions=true`
      );
    },
    async getCandles(instrument, { granularity = "M15", count = FOREX_SPEC.m15Count, price = "M" } = {}) {
      return request(
        "GET",
        `/v3/instruments/${encodeURIComponent(instrument)}/candles?granularity=${encodeURIComponent(granularity)}&count=${encodeURIComponent(count)}&price=${encodeURIComponent(price)}${granularity === "D" ? "&dailyAlignment=17&alignmentTimezone=America%2FNew_York" : ""}`
      );
    },
    async getInstruments() {
      const id = await resolveAccountId();
      return request("GET", `/v3/accounts/${encodeURIComponent(id)}/instruments`);
    },
    async getTransactionsSince(sinceId) {
      const id = await resolveAccountId();
      return request(
        "GET",
        `/v3/accounts/${encodeURIComponent(id)}/transactions/sinceid?id=${encodeURIComponent(sinceId || 0)}`
      );
    },
    async *streamPrices(instruments = [], options = {}) {
      const id = await resolveAccountId();
      const names = Array.isArray(instruments) ? instruments.join(",") : String(instruments || "");
      yield* stream(`/v3/accounts/${encodeURIComponent(id)}/pricing/stream?instruments=${encodeURIComponent(names)}`, options);
    },
    async *streamTransactions(options = {}) {
      const id = await resolveAccountId();
      yield* stream(`/v3/accounts/${encodeURIComponent(id)}/transactions/stream`, options);
    },
    async *streamPricing(instruments = [], options = {}) {
      const id = await resolveAccountId();
      const names = Array.isArray(instruments) ? instruments.join(",") : String(instruments || "");
      yield* stream(`/v3/accounts/${encodeURIComponent(id)}/pricing/stream?instruments=${encodeURIComponent(names)}`, options);
    },
    async *transactionStream(options = {}) {
      const id = await resolveAccountId();
      yield* stream(`/v3/accounts/${encodeURIComponent(id)}/transactions/stream`, options);
    },
    async createMarketOrder({
      instrument,
      units,
      priceBound,
      stopLossPrice,
      takeProfitPrice,
      reduceOnly = false,
      clientOrderId,
    }) {
      if (liveHost) {
        const error = new Error("LIVE_FOREX_ORDERS_NOT_AUTHORIZED");
        error.halt = "LIVE_BLOCKED";
        throw error;
      }
      const id = await resolveAccountId();
      return request("POST", `/v3/accounts/${encodeURIComponent(id)}/orders`, {
        order: {
          type: "MARKET",
          instrument,
          units: String(units),
          timeInForce: "FOK",
          positionFill: reduceOnly ? "REDUCE_ONLY" : "DEFAULT",
          ...(clientOrderId ? { clientExtensions: { id: clientOrderId } } : {}),
          ...(priceBound ? { priceBound: String(priceBound) } : {}),
          ...(stopLossPrice ? {
            stopLossOnFill: {
              price: String(stopLossPrice),
              timeInForce: "GTC",
            },
          } : {}),
          ...(takeProfitPrice ? { takeProfitOnFill: { price: String(takeProfitPrice), timeInForce: "GTC" } } : {}),
        },
      });
    },
    async closeTrade(tradeId) {
      if (liveHost) {
        const error = new Error("LIVE_FOREX_ORDERS_NOT_AUTHORIZED");
        error.halt = "LIVE_BLOCKED";
        throw error;
      }
      const id = await resolveAccountId();
      return request("PUT", `/v3/accounts/${encodeURIComponent(id)}/trades/${encodeURIComponent(tradeId)}/close`);
    },
    async replaceOrder(orderId, order) {
      if (liveHost) throw Object.assign(new Error("LIVE_FOREX_ORDERS_NOT_AUTHORIZED"), { halt: "LIVE_BLOCKED" });
      const id = await resolveAccountId();
      return request("PUT", `/v3/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`, { order });
    },
    async cancelOrder(orderId) {
      if (liveHost) throw Object.assign(new Error("LIVE_FOREX_ORDERS_NOT_AUTHORIZED"), { halt: "LIVE_BLOCKED" });
      const id = await resolveAccountId();
      return request("PUT", `/v3/accounts/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/cancel`);
    },
    async replaceTradeDependentOrders(tradeId, { stopLossPrice, takeProfitPrice } = {}) {
      if (liveHost) throw Object.assign(new Error("LIVE_FOREX_ORDERS_NOT_AUTHORIZED"), { halt: "LIVE_BLOCKED" });
      const id = await resolveAccountId();
      const dependent = (price) => price == null
        ? null
        : { price: String(price), timeInForce: "GTC" };
      return request(
        "PUT",
        `/v3/accounts/${encodeURIComponent(id)}/trades/${encodeURIComponent(tradeId)}/orders`,
        {
          stopLoss: dependent(stopLossPrice),
          takeProfit: dependent(takeProfitPrice),
        }
      );
    },
    async getOpenTrades() {
      const id = await resolveAccountId();
      return request("GET", `/v3/accounts/${encodeURIComponent(id)}/openTrades`);
    },
    async getPendingOrders() {
      const id = await resolveAccountId();
      return request("GET", `/v3/accounts/${encodeURIComponent(id)}/pendingOrders`);
    },
  };
}
