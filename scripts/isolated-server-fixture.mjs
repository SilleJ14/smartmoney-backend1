// Test-only process: parent supplies an empty temporary cwd and fake credentials.
// Never contact a provider or submit an order from this fixture.
import http from 'node:http';
import { Session } from 'node:inspector';
if (process.env.SMARTMONEY_FIXTURE_PROFILE === 'true') {
  const session = new Session(); session.connect();
  const post = (method) => new Promise((resolve, reject) => session.post(method, (error, result) => error ? reject(error) : resolve(result)));
  await post('Profiler.enable'); await post('Profiler.start');
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const { profile } = await post('Profiler.stop');
      const nodes = new Map(profile.nodes.map(node => [node.id, node]));
      const totals = new Map();
      (profile.samples || []).forEach((id, index) => totals.set(id, (totals.get(id) || 0) + (profile.timeDeltas?.[index] || 0)));
      process.send?.({ type: 'profile', top: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, micros]) => ({
        ms: Math.round(micros / 1000), name: nodes.get(id)?.callFrame?.functionName,
        file: nodes.get(id)?.callFrame?.url?.split('/').at(-1), line: nodes.get(id)?.callFrame?.lineNumber,
      })) });
      await post('Profiler.start');
    } finally { busy = false; }
  }, 1000).unref();
}
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send?.({ type: 'listening', port: this.address().port }));
  return originalListen.apply(this, args);
};
// Exercise the real production message handlers without opening a socket. A
// parent-controlled burst catches failures hidden by disabling all streams.
const fixtureSockets = [];
globalThis.WebSocket = class {
  constructor(address) {
    if (process.env.SMARTMONEY_FIXTURE_STREAM !== 'finnhub' || new URL(address).hostname !== 'ws.finnhub.io') {
      throw new Error('Fixture blocks external sockets');
    }
    this.readyState = 0;
    this.subscriptions = new Set();
    fixtureSockets.push(this);
    setImmediate(() => { this.readyState = 1; this.onopen?.({}); });
  }
  send(data) {
    const message = JSON.parse(data);
    if (message.type === 'subscribe') this.subscriptions.add(message.symbol);
    else if (message.type === 'unsubscribe') this.subscriptions.delete(message.symbol);
    else throw new Error('Fixture only permits simulated stream subscriptions');
  }
  close() { this.readyState = 3; this.onclose?.({}); }
};
process.on('message', message => {
  if (message?.type !== 'finnhub-burst') return;
  const socket = fixtureSockets.find(item => item.readyState === 1);
  if (!socket) { process.send?.({ type: 'burst-missing-socket' }); return; }
  const count = Math.max(1, Math.min(10000, Number(message.count) || 200));
  const providerSymbols = [...socket.subscriptions];
  const stock = providerSymbols.find(symbol => !symbol.includes(':')) || 'AAPL';
  const crypto = providerSymbols.find(symbol => symbol.includes(':')) || 'BINANCE:BTCUSDT';
  const data = Array.from({ length: count }, (_, i) => ({
    s: i % 2 ? crypto : stock, p: 100 + (i % 10) / 100, v: 10, t: Date.now(),
  }));
  if (message.separateFrames === true) {
    for (const trade of data) socket.onmessage?.({ data: JSON.stringify({ type: 'trade', data: [trade] }) });
  } else socket.onmessage?.({ data: JSON.stringify({ type: 'trade', data }) });
  process.send?.({ type: 'burst-delivered', count, stock, crypto, subscriptions: providerSymbols.length });
});
let reads = 0, writes = 0, polygonReads = 0;
const stocks = ['AAPL', 'MSFT', 'NVDA'];
const crypto = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
if (process.env.SMARTMONEY_FIXTURE_LOAD === 'full') {
  for (let i = stocks.length; i < 60; i++) stocks.push(`S${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`);
  for (let i = crypto.length; i < 73; i++) crypto.push(`C${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}/USD`);
}
const marketSymbols = [...stocks];
const marketPopulation = Math.max(stocks.length, Math.min(12000, Number(process.env.SMARTMONEY_FIXTURE_POPULATION) || stocks.length));
for (let i = marketSymbols.length; i < marketPopulation; i++) {
  marketSymbols.push(`M${String.fromCharCode(65 + Math.floor(i / 676) % 26)}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + i % 26)}`);
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, options = {}) => {
  if ((options.method || 'GET').toUpperCase() !== 'GET') {
    writes++;
    process.send?.({ type: 'unsafe-write', method: options.method });
    throw new Error('Fixture forbids provider mutations');
  }
  reads++;
  const url = new URL(String(input));
  const p = url.pathname;
  const now = Date.now(), stamp = new Date(now).toISOString();
  if (url.hostname === 'api.polygon.io' && p.endsWith('/markets/stocks/tickers')) {
    polygonReads++;
    const fault = process.env.SMARTMONEY_FIXTURE_POLYGON;
    if (fault === 'oversized') return new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 17; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); },
    }));
    if (fault === 'stalled') return new Response(new ReadableStream({ start() {} }));
    if (fault === 'unavailable') return json({ error: 'fixture provider outage' }, 503);
    if (fault === 'malformed') return new Response('{invalid');
    return json({ tickers: marketSymbols.map(ticker => ({ ticker, todaysChangePerc: 2,
      day: { c: 100, v: 3000000 }, prevDay: { c: 98 }, lastTrade: { p: 100, t: now * 1000000 },
      lastQuote: { bp: 100, ap: 100.02, t: now * 1000000 } })) });
  }
  const asset = symbol => ({ symbol, tradable: true, fractionable: true, status: 'active',
    class: symbol.includes('/') ? 'crypto' : 'us_equity', exchange: 'NASDAQ', marginable: true });
  if (p === '/v2/clock') return json({ is_open: false, timestamp: stamp,
    next_open: '2026-09-09T09:30:00-04:00', next_close: '2026-09-09T16:00:00-04:00' });
  if (p === '/v2/account') return json({ equity: '10000', cash: '10000', buying_power: '10000', last_equity: '10000', status: 'ACTIVE' });
  if (p === '/v2/positions' || p === '/v2/orders') return json([]);
  if (p === '/v2/assets') return json((url.searchParams.get('asset_class') === 'crypto' ? crypto : stocks).map(asset));
  if (p.startsWith('/v2/assets/')) return json(asset(decodeURIComponent(p.split('/').at(-1))));
  const symbols = (url.searchParams.get('symbols') || p.match(/stocks\/([^/]+)\//)?.[1] || 'AAPL').split(',');
  const quote = () => ({ bp: 100, ap: 100.02, bs: 100, as: 100, t: stamp });
  if (p.includes('/quotes/latest')) return json(p.includes('/stocks/') && !url.searchParams.has('symbols')
    ? { quote: quote() } : { quotes: Object.fromEntries(symbols.map(s => [s, quote()])) });
  if (p.endsWith('/latest/quotes')) return json({ quotes: Object.fromEntries(symbols.map(s => [s, quote()])) });
  if (p.endsWith('/bars')) {
    const daily = (url.searchParams.get('timeframe') || '').includes('Day');
    const bars = Array.from({ length: 80 }, (_, i) => ({ t: new Date(now - (80 - i) * (daily ? 86400000 : 60000)).toISOString(),
      o: 98 + i * .02, h: 99 + i * .02, l: 97.9 + i * .02, c: 98.1 + i * .02, v: 300000 + i * 1000, vw: 99 }));
    return json({ bars: p.match(/\/stocks\/[^/]+\/bars/) ? bars.reverse() : Object.fromEntries(symbols.map(s => [s, bars])), next_page_token: null });
  }
  if (p.includes('snapshots')) return json({ snapshots: Object.fromEntries(symbols.map(s => [s, {
    latestQuote: quote(), latestTrade: { p: 100, t: stamp }, dailyBar: { o: 98, c: 100, v: 3000000, t: stamp },
    prevDailyBar: { c: 98, t: new Date(now - 86400000).toISOString() },
  }])) });
  if (p.includes('/screener/stocks/movers')) return json({ gainers: stocks.map(symbol => ({ symbol, price: 100, percent_change: 2 })), losers: [] });
  if (p.includes('news')) return json([]);
  if (p.endsWith('/quote')) return json({ c: 100, pc: 98, o: 98, h: 101, l: 97, t: Math.floor(now / 1000) });
  return json({ error: `No fixture for ${p}` }, 404);
};
let metricAt = performance.now(), maxEventLoopDelayMs = 0;
setInterval(() => {
  const now = performance.now();
  maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - metricAt - 1000);
  metricAt = now;
  process.send?.({ type: 'metrics', reads, writes, polygonReads, rss: process.memoryUsage().rss,
    maxEventLoopDelayMs: Math.round(maxEventLoopDelayMs) });
}, 1000).unref();
await import('../server.js');
