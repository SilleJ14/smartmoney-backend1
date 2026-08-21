const ACTIVE_STATUSES = new Set([
  "new",
  "accepted",
  "pending_new",
  "partially_filled",
  "held",
  "open",
  "pending_replace",
]);

export function createDuplicateOrderGuard({
  getOpenOrders,
  normalizeSymbol,
  reservationTtlMs = 30_000,
  now = () => Date.now(),
}) {
  const reservations = new Map();

  function keyFor({ symbol, side }) {
    return `${String(side || "").toLowerCase()}:${normalizeSymbol(symbol)}`;
  }

  function cleanup() {
    const timestamp = now();
    for (const [key, expiresAt] of reservations) {
      if (expiresAt <= timestamp) reservations.delete(key);
    }
  }

  async function reserve(order, { allowExistingOpenOrder = false } = {}) {
    if (allowExistingOpenOrder) return () => {};
    cleanup();

    const symbol = normalizeSymbol(order?.symbol);
    const side = String(order?.side || "").toLowerCase();
    if (!symbol || !["buy", "sell"].includes(side)) {
      throw new Error("Cannot deduplicate an order without a valid symbol and side.");
    }

    const key = keyFor({ symbol, side });
    if (reservations.has(key)) {
      throw new Error(`Duplicate ${side} blocked for ${symbol}; submission already reserved.`);
    }

    reservations.set(key, now() + reservationTtlMs);
    try {
      const openOrders = await getOpenOrders();
      if (!Array.isArray(openOrders)) {
        throw new Error("Broker returned an invalid open-order response.");
      }
      const duplicate = openOrders.find((candidate) =>
        normalizeSymbol(candidate?.symbol) === symbol &&
        String(candidate?.side || "").toLowerCase() === side &&
        ACTIVE_STATUSES.has(String(candidate?.status || "").toLowerCase())
      );
      if (duplicate) {
        throw new Error(
          `Duplicate ${side} blocked for ${symbol}; broker order ${duplicate.id || "unknown"} is still open.`
        );
      }
    } catch (error) {
      reservations.delete(key);
      throw error;
    }

    let submitted = false;
    return ({ success = false } = {}) => {
      submitted = success;
      if (!submitted) reservations.delete(key);
    };
  }

  return { reserve, cleanup };
}
