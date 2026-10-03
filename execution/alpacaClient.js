import { assertOrderAllowed } from "./orderGate.js";
import { readBoundedResponseText } from "../utils/boundedResponse.js";

async function parseResponse(response, options) {
  const text = await readBoundedResponseText(response, options);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function errorMessage(data, fallback) {
  return data?.message || data?.error || fallback;
}

export function createAlpacaClient({
  getKeys,
  getTradingBaseUrl,
  dataBaseUrl,
  fetchWithTimeout,
  isEmergencyStopActive = () => false,
  onTradingFailure = () => {},
  onApiHealth = () => {},
  now = Date.now,
}) {
  // Alpaca's request limit is per account. After a 429, read-only calls wait out
  // the window instead of retrying into it (which keeps the account limited).
  // Orders and cancels are never held here; the broker clock keeps its cadence.
  let readBlockedUntil = 0;
  let consecutiveRateLimits = 0;
  function headers() {
    const { key, secret } = getKeys();
    return {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    };
  }

  async function tradingRequest(path, options = {}) {
    const healthName = path === '/v2/clock' ? 'alpacaClock' : 'alpacaTrading';
    assertOrderAllowed({
      path,
      options,
      emergencyStopActive: isEmergencyStopActive(),
    });

    const readOnly = String(options.method || "GET").toUpperCase() === "GET" && path !== "/v2/clock";
    if (readOnly && now() < readBlockedUntil) {
      const error = new Error("Alpaca rate limit backoff: read request skipped");
      error.status = 429;
      error.code = "ALPACA_RATE_LIMIT_BACKOFF";
      error.retryAfterMs = readBlockedUntil - now();
      throw error;
    }
    const { maxResponseBytes = 4 * 1024 * 1024, timeoutMs = 12000, ...requestOptions } = options;
    const response = await fetchWithTimeout(`${getTradingBaseUrl()}${path}`, {
      ...requestOptions,
      headers: {
        ...headers(),
        ...(options.headers || {}),
      },
    }, timeoutMs);
    const data = await parseResponse(response, { maxBytes: maxResponseBytes, timeoutMs });

    if (!response.ok) {
      const message = errorMessage(data, `HTTP ${response.status}`);
      // Clock failure must not cool down working account/order endpoints.
      if (healthName === 'alpacaTrading') onTradingFailure(message);
      onApiHealth(healthName, false, message);
      const error = new Error(
        errorMessage(
          data,
          `Alpaca trading error ${response.status}: ${JSON.stringify(data)}`
        )
      );
      error.status = response.status;
      const retryAfter = response.headers?.get?.('retry-after');
      if (retryAfter) error.retryAfterMs = /^\d+(\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      if (response.status === 429) {
        consecutiveRateLimits += 1;
        const backoffMs = Math.min(60000, 15000 * 2 ** (consecutiveRateLimits - 1));
        readBlockedUntil = Math.max(readBlockedUntil, now() + Math.max(Number(error.retryAfterMs) || 0, backoffMs));
      }
      throw error;
    }

    consecutiveRateLimits = 0;
    onApiHealth(healthName, true);
    return data;
  }

  async function dataRequest(path, options = {}) {
    const { maxResponseBytes = 4 * 1024 * 1024, timeoutMs = 12000, onBytesRead, ...requestOptions } = options;
    const response = await fetchWithTimeout(`${dataBaseUrl}${path}`, {
      ...requestOptions,
      headers: {
        ...headers(),
        ...(options.headers || {}),
      },
    }, timeoutMs);
    const text = await readBoundedResponseText(response, { maxBytes: maxResponseBytes, timeoutMs, onBytesRead });
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = new Error(
        errorMessage(
          data,
          `Alpaca data error ${response.status}: ${JSON.stringify(data)}`
        )
      );
      error.status = response.status;
      const retryAfter = response.headers?.get?.('retry-after');
      if (retryAfter) error.retryAfterMs = /^\d+(\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
      throw error;
    }

    return data;
  }

  return { tradingRequest, dataRequest };
}
