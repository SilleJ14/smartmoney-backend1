import { assertOrderAllowed } from "./orderGate.js";

async function parseResponse(response) {
  const text = await response.text();
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
}) {
  function headers() {
    const { key, secret } = getKeys();
    return {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    };
  }

  async function tradingRequest(path, options = {}) {
    assertOrderAllowed({
      path,
      options,
      emergencyStopActive: isEmergencyStopActive(),
    });

    const response = await fetchWithTimeout(`${getTradingBaseUrl()}${path}`, {
      ...options,
      headers: {
        ...headers(),
        ...(options.headers || {}),
      },
    });
    const data = await parseResponse(response);

    if (!response.ok) {
      const message = errorMessage(data, `HTTP ${response.status}`);
      onTradingFailure(message);
      onApiHealth("alpacaTrading", false, message);
      throw new Error(
        errorMessage(
          data,
          `Alpaca trading error ${response.status}: ${JSON.stringify(data)}`
        )
      );
    }

    onApiHealth("alpacaTrading", true);
    return data;
  }

  async function dataRequest(path, options = {}) {
    const response = await fetchWithTimeout(`${dataBaseUrl}${path}`, {
      ...options,
      headers: {
        ...headers(),
        ...(options.headers || {}),
      },
    });
    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(
        errorMessage(
          data,
          `Alpaca data error ${response.status}: ${JSON.stringify(data)}`
        )
      );
    }

    return data;
  }

  return { tradingRequest, dataRequest };
}
