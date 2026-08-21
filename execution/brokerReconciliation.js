const OPEN_ORDER_STATUSES = new Set([
  "new",
  "accepted",
  "pending_new",
  "partially_filled",
  "held",
  "open",
  "pending_replace",
]);

export function isExitOrder(order = {}) {
  return String(order.side || "").toLowerCase() === "sell" &&
    OPEN_ORDER_STATUSES.has(String(order.status || "").toLowerCase());
}

export function classifyExitOrder(order = {}) {
  const type = String(order.type || "").toLowerCase();
  const orderClass = String(order.order_class || "").toLowerCase();
  if (type === "trailing_stop") return "TRAILING_STOP_EXIT";
  if (type === "stop" || type === "stop_limit") return "STOP_EXIT";
  if (type === "limit") return "LIMIT_EXIT";
  if (["bracket", "oto", "oco"].includes(orderClass)) return "BRACKET_EXIT";
  return "OPEN_SELL_EXIT";
}

export function buildPendingExits({
  openOrders = [],
  enginePendingExits = [],
  normalizeSymbol,
}) {
  const brokerExits = (Array.isArray(openOrders) ? openOrders : [])
    .filter(isExitOrder)
    .map((order) => {
      const filledQty = Number(order.filled_qty || 0);
      const totalQty = Number(order.qty || order.notional || 0);
      return {
        source: "alpaca_open_order",
        symbol: normalizeSymbol(order.symbol),
        qty: Math.max(0, totalQty - filledQty) || totalQty,
        originalQty: totalQty,
        filledQty,
        reason: classifyExitOrder(order),
        orderId: order.id,
        clientOrderId: order.client_order_id || null,
        orderType: order.type || null,
        orderClass: order.order_class || null,
        status: order.status || null,
        limitPrice: order.limit_price || null,
        stopPrice: order.stop_price || null,
        trailPrice: order.trail_price || null,
        trailPercent: order.trail_percent || null,
        createdAt: order.created_at || null,
        updatedAt: order.updated_at || null,
        submittedAt: order.submitted_at || null,
      };
    })
    .filter((exit) => exit.symbol && Number(exit.qty || 0) > 0);

  const engineExits = (Array.isArray(enginePendingExits) ? enginePendingExits : [])
    .map((exit) => ({
      source: "engine_pdt_or_ai_pending",
      symbol: normalizeSymbol(exit.symbol),
      qty: Number(exit.qty || 0),
      reason: exit.reason || "ENGINE_PENDING_EXIT",
      at: exit.at || null,
      ...exit,
    }));

  const seen = new Set();
  return [...brokerExits, ...engineExits].filter((exit) => {
    const key = `${exit.source}_${exit.orderId || exit.symbol}_${exit.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function reconcileBrokerState({
  positions = [],
  openOrders = [],
  managedSymbols = [],
  enginePendingExits = [],
  normalizeSymbol,
}) {
  const brokerSymbols = new Set(
    positions
      .filter((position) => Number(position.qty || 0) !== 0)
      .map((position) => normalizeSymbol(position.symbol))
      .filter(Boolean)
  );
  const managed = new Set(
    Array.from(managedSymbols || []).map(normalizeSymbol).filter(Boolean)
  );
  const openBuyCounts = {};
  for (const order of openOrders) {
    if (String(order.side || "").toLowerCase() !== "buy") continue;
    if (!OPEN_ORDER_STATUSES.has(String(order.status || "").toLowerCase())) continue;
    const symbol = normalizeSymbol(order.symbol);
    if (symbol) openBuyCounts[symbol] = (openBuyCounts[symbol] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    pendingExits: buildPendingExits({
      openOrders,
      enginePendingExits,
      normalizeSymbol,
    }),
    unmanagedBrokerPositions: [...brokerSymbols].filter((symbol) => !managed.has(symbol)),
    missingManagedPositions: [...managed].filter((symbol) => !brokerSymbols.has(symbol)),
    duplicateOpenBuySymbols: Object.entries(openBuyCounts)
      .filter(([, count]) => count > 1)
      .map(([symbol, count]) => ({ symbol, count })),
  };
}
