import { FOREX_SPEC } from "./forexSpec.js";

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
  fetchImpl,
} = {}) {
  const host = String(baseUrl || FOREX_SPEC.practiceApiUrl).replace(/\/$/, "");
  const liveHost = isLiveHost(host);
  let resolvedAccountId = String(accountId || "");

  async function request(method, path, body) {
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
