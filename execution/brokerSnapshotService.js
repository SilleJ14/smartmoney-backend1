const ACCOUNT_FALLBACK = {
  equity: 0,
  cash: 0,
  buying_power: 0,
  status: "alpaca_account_unavailable",
};

export function createBrokerSnapshotService({
  tradingRequest,
  getCache,
  setCache,
  onApiHealth = () => {},
}) {
  async function cachedRequest({ path, cacheKey, healthKey, fallback }) {
    try {
      const result = await tradingRequest(path);
      const value = Array.isArray(fallback)
        ? (Array.isArray(result) ? result : [])
        : result;
      setCache(cacheKey, value);
      onApiHealth(healthKey, true);
      return value;
    } catch (error) {
      const message = error?.message || String(error);
      onApiHealth(healthKey, false, message);
      const cached = getCache(cacheKey);
      if (Array.isArray(fallback)) return Array.isArray(cached) ? cached : [];
      if (cached) return { ...cached, stale: true, staleReason: message };
      return { ...fallback, stale: true, staleReason: message };
    }
  }

  const getAccount = () => cachedRequest({
    path: "/v2/account",
    cacheKey: "cachedAccount",
    healthKey: "alpacaAccount",
    fallback: ACCOUNT_FALLBACK,
  });

  const getPositions = () => cachedRequest({
    path: "/v2/positions",
    cacheKey: "cachedPositions",
    healthKey: "alpacaPositions",
    fallback: [],
  });

  const getOrders = () => cachedRequest({
    path: "/v2/orders?status=all&limit=100&direction=desc",
    cacheKey: "cachedOrders",
    healthKey: "alpacaOrders",
    fallback: [],
  });

  const getOpenOrders = () => cachedRequest({
    path: "/v2/orders?status=open&limit=100&direction=desc",
    cacheKey: "cachedOpenOrders",
    healthKey: "alpacaOpenOrders",
    fallback: [],
  });

  return { getAccount, getPositions, getOrders, getOpenOrders };
}
