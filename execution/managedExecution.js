import { randomUUID } from 'node:crypto';

const terminal = new Set(['filled', 'canceled', 'expired', 'rejected']);
const accepted = new Set(['new', 'accepted', 'partially_filled', 'held', 'open', 'accepted_for_bidding']);
const positive = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const key = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// One bounded, durable coordinator for broker stops, submitted exits and fill accounting.
// It never calls an order filled merely because POST returned successfully.
export function createManagedExecution({ state, persist, request, getManagedSymbols, getConfig,
  isCrypto, onFill = () => {}, onFlat = () => {}, now = Date.now }) {
  const ledger = state.managedExecution ||= { version: 1, orders: {}, realized: {}, completed: [] };
  let queue = Promise.resolve();
  let queued = 0;
  let lastChecked = 0;
  let ready = false;
  const increments = new Map();
  const prefix = 'SM_PROTECT_';
  function exclusive(fn) {
    if (queued >= 32) return Promise.reject(new Error('Execution reconciliation busy; retry later'));
    queued++;
    const work = queue.then(fn);
    queue = work.catch(() => {}).finally(() => { queued--; });
    return work;
  }
  function save() { persist(); }
  function activeRows(symbol) {
    return Object.values(ledger.orders).filter(row => !row.done && (!symbol || key(row.symbol) === key(symbol)));
  }
  async function positions() {
    const rows = await request('/v2/positions');
    if (!Array.isArray(rows) || rows.some(p => !p.symbol || !positive(p.qty) || !positive(p.avg_entry_price))) {
      throw new Error('Invalid long-position evidence for protection');
    }
    return rows;
  }
  async function openOrders() {
    const rows = await request('/v2/orders?status=open&limit=500&nested=false');
    if (!Array.isArray(rows) || rows.length >= 500) throw new Error('Open-order coverage incomplete');
    return rows;
  }
  async function lookup(row) {
    return request(row.orderId ? `/v2/orders/${encodeURIComponent(row.orderId)}`
      : `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(row.clientId)}`);
  }
  function validateOrder(order, row) {
    if (!order?.id || key(order.symbol) !== key(row.symbol) || order.side !== 'sell' ||
      order.filled_qty == null || order.filled_qty === '' || !Number.isFinite(Number(order.filled_qty)) || Number(order.filled_qty) < 0) {
      throw new Error('Invalid broker sell reconciliation');
    }
    row.orderId = order.id;
    row.status = order.status;
  }
  function recordFill(row, order) {
    validateOrder(order, row);
    const qty = Number(order.filled_qty);
    if (qty < row.filledQty || qty > row.qty + 1e-8) throw new Error('Non-monotonic broker fill quantity');
    if (qty > row.filledQty) {
      if (!positive(order.filled_avg_price)) throw new Error('Filled order lacks actual fill price');
      const proceeds = qty * Number(order.filled_avg_price);
      const deltaQty = qty - row.filledQty;
      const deltaProceeds = proceeds - row.proceeds;
      if (!(deltaProceeds > 0)) throw new Error('Invalid cumulative fill proceeds');
      const symbol = key(row.symbol);
      const total = ledger.realized[symbol] ||= { id: randomUUID(), qty: 0, proceeds: 0, cost: 0, symbol: row.symbol, crypto: isCrypto(row.symbol) };
      total.qty += deltaQty;
      total.proceeds += deltaProceeds;
      total.cost += deltaQty * row.entryPrice;
      total.reason = row.reason;
      total.lastOrderId = order.id;
      row.filledQty = qty;
      row.proceeds = proceeds;
      onFill({ symbol: row.symbol, reason: row.reason, filledQty: qty, deltaQty,
        fillPrice: deltaProceeds / deltaQty, orderId: order.id });
      save();
    }
    row.done = terminal.has(order.status);
    save();
  }
  async function cancel(row) {
    const before = await lookup(row);
    recordFill(row, before);
    if (row.done) return;
    await request(`/v2/orders/${encodeURIComponent(before.id)}`, { method: 'DELETE' });
    const after = await lookup(row);
    recordFill(row, after);
    if (!row.done) throw new Error('Protective order cancellation not confirmed; exit deferred');
  }
  function track(payload, position, reason) {
    if (activeRows().length >= 64) throw new Error('Pending execution ledger full');
    const row = { clientId: payload.client_order_id, symbol: payload.symbol, qty: Number(payload.qty),
      entryPrice: Number(position.avg_entry_price), reason, protective: payload.client_order_id.startsWith(prefix),
      createdAt: now(), filledQty: 0, proceeds: 0, done: false, status: 'submitting' };
    ledger.orders[row.clientId] = row;
    save(); // Write intent before sending. A timeout must never trigger a blind duplicate.
    return row;
  }
  async function prepareSell(payload) {
    for (const row of activeRows(payload.symbol)) {
      if (row.protective) await cancel(row);
      else {
        recordFill(row, await lookup(row));
        if (!row.done) throw new Error('Previous sell is still pending');
      }
    }
    const current = (await positions()).find(p => key(p.symbol) === key(payload.symbol));
    if (!current) throw new Error('Position already closed; no further sell submitted');
    // A protective fill can race cancellation: never sell more than the remainder.
    payload.qty = String(Math.min(Number(payload.qty), Number(current.qty)));
    if (!positive(payload.qty)) throw new Error('No confirmed quantity available to sell');
    return current;
  }
  async function beforeSubmit(payload) {
    if (payload.side === 'sell') return prepareSell(payload);
    await reconcileNow();
    if (!ready) throw new Error('Position protection not reconciled; new buys paused');
  }
  function submitting(payload, options, position) {
    if (payload.side === 'sell') track(payload, position, options.reason || 'MANUAL_OR_AI_EXIT');
  }
  async function submitted({ payload, result }) {
    if (payload.side === 'sell') {
      const row = ledger.orders[payload.client_order_id];
      row.orderId = result?.id || null;
      save();
      if (result?.id) recordFill(row, result);
    }
    ready = false;
    state.positionProtection = { ok: false, checkedAt: new Date(now()).toISOString(), reason: 'Order submitted; awaiting updated fills and protection' };
    // The next independent cycle refreshes positions and protects actual fills.
  }
  function failed({ payload, error, submitted: sent }) {
    const row = ledger.orders[payload.client_order_id];
    if (!row) return;
    const status = Number(error?.statusCode || error?.status || 0);
    if (!sent || (status >= 400 && status < 500 && ![408, 429].includes(status))) {
      row.status = 'rejected'; row.done = true;
    } else row.status = 'uncertain';
    ready = false;
    save();
  }
  async function protect(position, orders) {
    const symbol = position.symbol;
    const rows = activeRows(symbol);
    const pendingSellQty = rows.filter(r => !r.protective).reduce((sum, r) => sum + r.qty - r.filledQty, 0);
    const crypto = isCrypto(symbol);
    const qty = Number((Number(position.qty) - pendingSellQty).toFixed(8));
    if (qty <= 0) return; // The working market exit covers the entire remaining position.
    const config = getConfig();
    const distance = Math.max(6, Math.abs(Number(config.stopLossPercent) || 2), Math.abs(Number(config.liveHardStopPercent) || 3.5));
    if (!(distance < 100)) throw new Error('Invalid protective stop distance');
    const oldStop = Math.max(0, ...rows.map(r => Number(r.stopPrice) || 0));
    const rawStop = Math.max(oldStop, Number(position.avg_entry_price) * (1 - distance / 100));
    if (crypto && (!increments.has(symbol) || now() - increments.get(symbol).at > 3600000)) {
      const asset = await request(`/v2/assets/${encodeURIComponent(symbol)}`);
      if (increments.size >= 64) increments.delete(increments.keys().next().value);
      increments.set(symbol, { value: Number(asset.price_increment), at: now() });
    }
    const increment = crypto ? increments.get(symbol).value : rawStop >= 1 ? .01 : .0001;
    if (!positive(increment)) throw new Error('Crypto price increment unavailable for protective order');
    const roundPrice = price => Number((Math.ceil(price / increment - 1e-8) * increment).toFixed(9));
    const stop = roundPrice(rawStop);
    const tif = crypto || Number.isInteger(qty) ? 'gtc' : 'day';
    const own = rows.find(r => r.protective && accepted.has(r.status) &&
      Math.abs(r.qty - r.filledQty - qty) < 1e-8 && r.stopPrice >= stop && r.tif === tif);
    if (own && rows.filter(r => r.protective).length === 1) return;
    // Never cancel or coexist with a user/external sell whose intent is unknown.
    if (orders.some(o => key(o.symbol) === key(symbol) && o.side === 'sell' && !rows.some(r => r.orderId === o.id))) {
      throw new Error(`Unmanaged sell order prevents safe stop reconciliation for ${symbol}`);
    }
    for (const row of rows.filter(r => r.protective)) await cancel(row);
    const fresh = (await positions()).find(p => key(p.symbol) === key(symbol));
    if (!fresh) return;
    if (Number(fresh.qty) !== Number(position.qty)) throw new Error('Position changed during stop replacement; retry reconciliation');
    const payload = { symbol, side: 'sell', qty: String(qty), type: crypto ? 'stop_limit' : 'stop',
      time_in_force: tif, stop_price: String(stop), client_order_id: `${prefix}${randomUUID().replaceAll('-', '')}` };
    if (crypto) payload.limit_price = String(roundPrice(stop * .98));
    const row = track(payload, fresh, 'BROKER_PROTECTIVE_STOP');
    Object.assign(row, { stopPrice: stop, tif });
    save();
    try {
      const order = await request('/v2/orders', { method: 'POST', body: JSON.stringify(payload) });
      recordFill(row, order);
      if (!accepted.has(order.status) && order.status !== 'filled') throw new Error(`Protective order not active: ${order.status}`);
    } catch (error) { failed({ payload, error, submitted: true }); throw error; }
  }
  async function reconcileNow() {
    ready = false;
    try {
      const errors = [];
      const uncertainSymbols = new Set();
      const open = await openOrders();
      for (const row of activeRows()) {
        try { recordFill(row, open.find(o => o.id === row.orderId || o.client_order_id === row.clientId) || await lookup(row)); }
        catch (error) { uncertainSymbols.add(key(row.symbol)); errors.push(error); }
      }
      const current = await positions();
      const managed = new Set(Array.from(await getManagedSymbols(current)).map(key));
      // Broker-side fills survive process outages through the durable order IDs above.
      for (const [symbol, total] of Object.entries(ledger.realized)) {
        if (uncertainSymbols.has(symbol)) continue;
        if (current.some(p => key(p.symbol) === symbol) || activeRows(symbol).some(r => !r.protective)) continue;
        for (const row of activeRows(symbol)) await cancel(row);
        onFlat({ ...total, profitPercent: (total.proceeds / total.cost - 1) * 100,
          exitPrice: total.proceeds / total.qty, entryPrice: total.cost / total.qty, fillConfirmed: true });
        delete ledger.realized[symbol];
        save();
      }
      for (const position of current) if (managed.has(key(position.symbol)) && !uncertainSymbols.has(key(position.symbol))) {
        try { await protect(position, open); } catch (error) { errors.push(error); }
      }
      const completed = Object.values(ledger.orders).filter(r => r.done).sort((a, b) => b.createdAt - a.createdAt);
      for (const row of completed.slice(200)) delete ledger.orders[row.clientId];
      if (errors.length) throw new Error(errors.map(error => error.message).slice(0, 3).join('; '));
      lastChecked = now();
      ready = true;
      state.positionProtection = { ok: true, checkedAt: new Date(lastChecked).toISOString(),
        trackedOrders: activeRows().length, reason: 'Broker orders and actual fills reconciled' };
      save();
    } catch (error) {
      state.positionProtection = { ok: false, checkedAt: new Date(now()).toISOString(), reason: String(error.message).slice(0, 240) };
      throw error;
    }
  }
  return { exclusive, beforeSubmit, submitting, submitted, failed,
    reconcile: () => exclusive(reconcileNow),
    assertReady: () => { if (!ready || now() - lastChecked > 15000) throw new Error('Broker protection reconciliation required'); } };
}
