export function confirmedBotOwnedSymbols({ orders = [], positions = [], isBotOrder, normalizeSymbol }) {
  const open = new Set(positions.filter(p => Number(p.qty) > 0).map(p => normalizeSymbol(p.symbol)));
  const quantities = new Map();
  const latest = new Map();
  for (const [index, order] of orders.entries()) {
    const key = order.id || order.client_order_id || `row:${index}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(order.updated_at || '') >= Date.parse(prior.updated_at || '') ||
      Number(order.filled_qty) > Number(prior.filled_qty)) latest.set(key, order);
  }
  for (const order of latest.values()) {
    if (!isBotOrder(order)) continue;
    const symbol = normalizeSymbol(order.symbol), filled = Number(order.filled_qty);
    const side = String(order.side || '').toLowerCase();
    if (!symbol || !Number.isFinite(filled) || filled <= 0 || !['buy', 'sell'].includes(side)) continue;
    quantities.set(symbol, (quantities.get(symbol) || 0) + (side === 'buy' ? filled : -filled));
  }
  return new Set([...quantities].filter(([symbol, qty]) => open.has(symbol) && qty > 0).map(([symbol]) => symbol));
}
