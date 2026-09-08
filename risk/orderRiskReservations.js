// Kept independently of the large, deferred analytics snapshot. Unknown order
// outcomes remain reserved until the broker confirms their terminal state.
export function outstandingOrderNotional(entry, positions = [], normalizeSymbol = value => String(value).replace('/', '').toUpperCase()) {
  if (entry.released === true || entry.reflectedInPositions === true) return 0;
  return entry.notional;
}
export function createOrderRiskReservations({ state, persist, lookupOrder, getOpenOrders, getPositions, normalizeSymbol, now = Date.now }) {
  const entries = () => state.orderRiskReservations ||= {};
  function releaseEntry(entry) {
    if (entry.released) return;
    entry.released = true;
    if (entry.countedIntraday && entry.dateKey === state.liveTradeLimitState?.dateKey) {
      state.liveTradeLimitState.intradayStockEntriesToday = Math.max(0, Number(state.liveTradeLimitState.intradayStockEntriesToday || 0) - 1);
    }
  }
  function outstanding(entry, positions = []) {
    return outstandingOrderNotional(entry, positions, normalizeSymbol);
  }
  async function reconcile(positions) {
    if (positions?.stale === true) throw new Error('Fresh broker positions required for reconciliation');
    if (getOpenOrders) {
      const orders = await getOpenOrders();
      if (!Array.isArray(orders) || orders.stale || orders.length >= 100) throw new Error('Complete fresh broker open orders required');
      for (const order of orders.filter(o => o.side === 'buy')) {
        const id = order.client_order_id;
        if (!id || !order.symbol) throw new Error('Malformed broker open buy');
        if (entries()[id]) continue;
        const symbol = normalizeSymbol(order.symbol);
        const crypto = order.asset_class === 'crypto' || /[/]USD$/.test(order.symbol) || /USD$/.test(symbol);
        const known = state.liveTradeLimitState?.positionIntents?.[symbol];
        const referencePrice = Number(order.limit_price || positions.find(p => normalizeSymbol(p.symbol) === symbol)?.current_price || 0);
        const notional = Number(order.notional || Number(order.qty) * referencePrice);
        if (!Number.isFinite(notional) || notional <= 0) throw new Error(`Pending order value unavailable: ${symbol}`);
        if (Object.keys(entries()).length >= 2500) throw new Error('Order safety journal full');
        const category = crypto ? 'crypto' : known?.holdCategory || 'intraday';
        entries()[id] = { id, symbol, notional, referencePrice, baseQty: 0, version: null,
          category, dateKey: state.liveTradeLimitState?.dateKey, countedIntraday: false,
          createdAt: Date.parse(order.created_at) || now(), status: order.status || 'new', filledQty: Number(order.filled_qty || 0), imported: true };
        if (category === 'intraday' && !positions.some(p => normalizeSymbol(p.symbol) === symbol)) {
          entries()[id].countedIntraday = true;
          state.liveTradeLimitState.intradayStockEntriesToday = Number(state.liveTradeLimitState.intradayStockEntriesToday || 0) + 1;
        }
        state.liveTradeLimitState.positionIntents ||= {};
        state.liveTradeLimitState.positionIntents[symbol] = { ...known, holdCategory: category,
          unknownHoldCategory: !crypto && !known?.holdCategory, enteredAt: order.created_at || new Date(now()).toISOString(), pending: true };
      }
    }
    const unresolved = Object.values(entries()).filter((entry) => outstanding(entry, positions) > 0);
    if (unresolved.length > 100) throw new Error('Too many unresolved orders; reconciliation required');
    // Bounded parallel reads; this function never submits an order.
    for (let offset = 0; offset < unresolved.length; offset += 5) {
      await Promise.all(unresolved.slice(offset, offset + 5).map(async (entry) => {
        try {
          const order = await lookupOrder(entry.id);
          if (!order?.status || normalizeSymbol(order.symbol) !== entry.symbol) return;
          entry.status = order.status;
          entry.filledQty = Number(order.filled_qty || 0);
          entry.filledAt = Date.parse(order.filled_at) || entry.filledAt || null;
          if (['canceled', 'expired', 'rejected'].includes(order.status) && entry.filledQty === 0) releaseEntry(entry);
          if (['canceled', 'expired'].includes(order.status) && entry.filledQty > 0) {
            entry.status = 'filled';
            entry.filledAt ||= Date.parse(order.updated_at) || null;
            entry.notional = entry.filledQty * Number(order.filled_avg_price || entry.referencePrice);
          }
        } catch { /* ambiguity is not permission to reuse capital */ }
      }));
    }
    // Read positions AFTER terminal-order confirmation. This captures a fill
    // followed by an exit between earlier snapshots without releasing on an
    // ambiguous lookup or a stale pre-fill snapshot.
    if (getPositions && Object.values(entries()).some(e => e.status === 'filled' && outstanding(e) > 0)) {
      const refreshed = await getPositions();
      if (!Array.isArray(refreshed) || refreshed.stale) throw new Error('Post-fill positions unavailable');
      positions.splice(0, positions.length, ...refreshed);
      Object.assign(positions, { snapshotAt: refreshed.snapshotAt, stale: false });
    }
    const symbols = new Set(Object.values(entries()).map(entry => entry.symbol));
    for (const symbol of symbols) {
      const group = Object.values(entries()).filter(entry => entry.symbol === symbol && outstanding(entry, positions) > 0);
      if (!group.length || !group.every(entry => entry.status === 'filled' && entry.filledQty > 0)) continue;
      const held = positions.find(position => normalizeSymbol(position.symbol) === symbol);
      const requiredQty = Math.min(...group.map(entry => entry.baseQty)) + group.reduce((sum, entry) => sum + entry.filledQty, 0);
      if (Number(held?.qty || 0) + 1e-8 >= requiredQty ||
        (getPositions && group.every(e => e.filledAt > 0 && e.filledAt <= positions.snapshotAt))) {
        for (const entry of group) entry.reflectedInPositions = true;
      }
    }
    for (const [symbol, intent] of Object.entries(state.liveTradeLimitState?.positionIntents || {})) {
      intent.pending = Object.values(entries()).some((entry) => entry.symbol === symbol && outstanding(entry, positions) > 0);
    }
    for (const [id, entry] of Object.entries(entries())) {
      if (!outstanding(entry, positions) && now() - entry.createdAt > 86400000) delete entries()[id];
    }
    persist();
    return Object.values(entries()).reduce((sum, entry) => sum + outstanding(entry, positions), 0);
  }
  function consumed(symbol, version) {
    return Object.values(entries()).filter((entry) => !entry.released && entry.symbol === normalizeSymbol(symbol) && entry.version === version)
      .reduce((sum, entry) => sum + entry.notional, 0);
  }
  function reserve(order, options) {
    if (Object.keys(entries()).length >= 2500) throw new Error('Order safety journal full; reconcile before buying');
    const id = order.client_order_id;
    if (!id || entries()[id]) throw new Error('Duplicate or missing order identity');
    const entry = { id, symbol: normalizeSymbol(order.symbol), notional: options.riskNotional,
      referencePrice: options.riskReferencePrice, baseQty: options.riskBaseQty || 0,
      version: options.riskDecisionVersion || null, category: options.holdCategory,
      dateKey: state.liveTradeLimitState?.dateKey,
      countedIntraday: !options.liveTradeLimitDecision?.isExistingPosition && options.holdCategory === 'intraday',
      createdAt: now(), status: 'pending', filledQty: 0 };
    if (!(entry.notional > 0)) throw new Error('Missing verified reservation value');
    entries()[id] = entry;
    const limits = state.liveTradeLimitState;
    if (!options.liveTradeLimitDecision?.isExistingPosition && entry.category === 'intraday') limits.intradayStockEntriesToday = Number(limits.intradayStockEntriesToday || 0) + 1;
    limits.positionIntents ||= {};
    limits.positionIntents[entry.symbol] = { ...limits.positionIntents[entry.symbol], holdCategory: entry.category,
      enteredAt: new Date(now()).toISOString(), pending: true };
    persist(); // must succeed BEFORE the POST
    return { settle({ result, error, notSubmitted = false }) {
      entry.status = result?.status || (error ? 'uncertain' : 'accepted');
      entry.filledQty = Number(result?.filled_qty || 0);
      entry.filledAt = Date.parse(result?.filled_at) || null;
      // HTTP rejection is definitive. Timeouts, duplicate-id errors and network
      // failures are ambiguous and must be looked up at the broker.
      if (notSubmitted || [400, 401, 403].includes(error?.status)) releaseEntry(entry);
      persist();
    } };
  }
  return { reconcile, consumed, reserve };
}
