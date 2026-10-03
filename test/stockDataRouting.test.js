import test from "node:test";
import assert from "node:assert/strict";
import { createStockHistory } from "../market-data/stockHistory.js";
import { createStockQuoteBatch } from "../market-data/stockQuoteBatch.js";
import { createStockHistoryRouting, createStockQuoteRouting, STOCK_BAR_ROUTE, STOCK_QUOTE_ROUTE } from "../market-data/stockDataRouting.js";
import { createTradierMarketData } from "../providers/tradierMarketData.js";
import { selectStockExecutionQuote } from "../market-data/stockQuoteSelection.js";
import { feedEvidenceFinding, spreadQuoteClass, stockFeedProvenance } from "../market-data/feedContract.js";
import { normalizeTradierQuote } from "../providers/tradierMarketData.js";
import { normalizePolygonSnapshotQuote } from "../providers/polygonProvider.js";
import { executionQuoteDecision, rankTradierSweep } from "../discovery/stockRealtimePipeline.js";
import { stockDataHealth } from "../market-data/providerHealth.js";

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const bars = (n, step = 300000, close = 10) => barsEnding(n, 2, step, close);
// n completed bars whose newest bar starts `stepsAgo` intervals before the
// current interval, so windows from different providers need not overlap.
const barsEnding = (n, stepsAgo, step = 300000, close = 10) => Array.from({ length: n }, (_, i) => ({
  t: Math.floor(now / step) * step - (n - 1 - i + stepsAgo) * step, o: close, h: close + 1, l: close - 1, c: close, v: 100,
}));
const tradierQuote = (symbol, at = now - 500) => normalizeTradierQuote({ symbol, type: "stock", last: 10.01, prevclose: 9.5,
  bid: 10, ask: 10.02, bid_date: at, ask_date: at, trade_date: at - 100 }, { now });
const polygonQuote = (symbol, at = now - 500, options = {}) => normalizePolygonSnapshotQuote({ ticker: symbol,
  prevDay: { c: 9.5 }, day: { o: 9.8, h: 10.2, l: 9.7, v: 5000 },
  lastQuote: { p: 20, P: 20.02, t: at * 1e6 }, lastTrade: { p: 20.01, t: (at - 100) * 1e6 } }, { now, ...options });
const alpacaQuote = (symbol, at = now - 200) => ({
  symbol, price: 30.01, current: 30.01, bid: 30, ask: 30.02, spreadAvailable: true, spreadPercent: 0.07, priceIsLive: true,
  liveQuoteSource: "alpaca_latest_stock_quote", spreadSource: "alpaca_latest_stock_quote",
  liveQuoteUpdatedAt: iso(at), spreadUpdatedAt: iso(at), provider: "ALPACA", feed: "iex",
  provenance: stockFeedProvenance({ provider: "ALPACA", feed: "IEX" }),
});

test("bars: a full Tradier history is used and later providers are never asked", async () => {
  let polygonCalls = 0, alpacaCalls = 0;
  const evidence = [];
  const history = createStockHistory({ now: () => now, onEvidence: (row) => evidence.push(row),
    tradier: async (_symbol, timeframe, spec) => { assert.equal(timeframe, "5Min"); assert.equal(spec.limit, 20); return bars(25); },
    polygon: async () => { polygonCalls++; return bars(25); },
    alpaca: async () => { alpacaCalls++; return bars(25); } });
  const result = await history.get("AAPL", "5Min", 20);
  assert.equal(result.length, 20);
  assert.equal(polygonCalls + alpacaCalls, 0);
  assert.ok(result.every((bar) => bar.provenance.provider === "TRADIER" && bar.provenance.feed === "CONSOLIDATED"));
  assert.equal(result[0].provenance.isConsolidated, true);
  assert.equal(evidence[0].source, "TRADIER");
  assert.equal(evidence[0].feed, "CONSOLIDATED");
  assert.equal(evidence[0].delayed, false);
  assert.deepEqual(history.getStatus().order, ["TRADIER", "MASSIVE", "ALPACA"]);
  assert.equal(history.getStatus().servedBy.tradier, 1);
  // Consolidated quote + consolidated Tradier bars pass the feed contract.
  const quote = tradierQuote("AAPL");
  assert.equal(feedEvidenceFinding({ quote: quote.provenance, intradayBars: result[0].provenance, dailyBars: result[0].provenance }).state, "PASS");
});

test("bars: an empty or failed Tradier history falls back to Polygon", async () => {
  for (const tradier of [async () => [], async () => { throw Object.assign(new Error("down"), { status: 502 }); },
    async () => { throw Object.assign(new Error("budget"), { code: "LOCAL_RATE_BUDGET" }); }]) {
    const evidence = [];
    const history = createStockHistory({ now: () => now, onEvidence: (row) => evidence.push(row), tradier,
      polygon: async () => bars(25, 86400000), alpaca: async () => { throw new Error("must not be needed"); } });
    const result = await history.get("AAPL", "1Day", 20);
    assert.equal(result.length, 20);
    assert.ok(result.every((bar) => bar.provenance.provider === "MASSIVE"));
    assert.equal(evidence[0].source, "MASSIVE");
  }
});

test("bars: when Tradier and Polygon both fail Alpaca IEX serves with IEX provenance", async () => {
  const evidence = [];
  const history = createStockHistory({ now: () => now, onEvidence: (row) => evidence.push(row),
    tradier: async () => { throw Object.assign(new Error("x"), { code: "TIMEOUT" }); },
    polygon: async () => { throw Object.assign(new Error("y"), { status: 500 }); },
    alpaca: async () => bars(25) });
  const result = await history.get("AAPL", "5Min", 20);
  assert.equal(result.length, 20);
  assert.ok(result.every((bar) => bar.provenance.provider === "ALPACA" && bar.provenance.feed === "IEX"));
  assert.equal(result[0].provenance.isConsolidated, false);
  assert.deepEqual(evidence[0].errors, ["tradier:TIMEOUT", "polygon:500"]);
  assert.equal(evidence[0].source, "ALPACA");
  const finding = feedEvidenceFinding({ quote: tradierQuote("AAPL").provenance, intradayBars: result[0].provenance });
  assert.equal(finding.state, "WAIT");
  assert.equal(finding.reason, "CONSOLIDATED_BAR_HISTORY_REQUIRED");
});

test("bars: partial histories are never spliced and the best single provider is kept", async () => {
  const tradierBars = bars(5, 300000, 10);
  const polygonBars = bars(25, 300000, 20);
  const fullPolygon = await createStockHistory({ now: () => now, tradier: async () => tradierBars,
    polygon: async () => polygonBars, alpaca: async () => bars(25, 300000, 30) }).get("AAPL", "5Min", 20);
  assert.equal(fullPolygon.length, 20);
  assert.ok(fullPolygon.every((bar) => bar.c === 20 && bar.provenance.provider === "MASSIVE"), "Polygon only, not spliced");
  const partial = await createStockHistory({ now: () => now, tradier: async () => tradierBars,
    polygon: async () => bars(3, 300000, 20), alpaca: async () => bars(2, 300000, 30) }).get("AAPL", "5Min", 20);
  assert.equal(partial.length, 5);
  assert.ok(partial.every((bar) => bar.c === 10 && bar.provenance.provider === "TRADIER"));
  // A tie keeps the higher-priority provider.
  const tie = await createStockHistory({ now: () => now, tradier: async () => bars(5, 300000, 10),
    polygon: async () => bars(5, 300000, 20) }).get("AAPL", "5Min", 20);
  assert.ok(tie.every((bar) => bar.provenance.provider === "TRADIER"));
});

test("bars: a lower-priority provider never fills gaps in a partial history", async () => {
  // Older Tradier bars and newer, non-overlapping fallback bars: merging them
  // would give a longer series stamped with one provider's provenance.
  const tradierBars = barsEnding(5, 10, 300000, 10);
  const newer = (close) => barsEnding(3, 2, 300000, close);
  const tradierTimes = new Set(tradierBars.map((bar) => bar.t));
  assert.ok(newer(20).every((bar) => !tradierTimes.has(bar.t)), "fixture windows must not overlap");
  const cases = [
    { name: "Polygon newer bars", polygon: async () => newer(20), alpaca: async () => [] },
    { name: "Alpaca IEX newer bars", polygon: async () => { throw Object.assign(new Error("down"), { status: 500 }); },
      alpaca: async () => newer(30) },
    { name: "Polygon and Alpaca IEX newer bars", polygon: async () => newer(20), alpaca: async () => barsEnding(4, 1, 300000, 30) },
  ];
  for (const providers of cases) {
    const evidence = [];
    const result = await createStockHistory({ now: () => now, onEvidence: (row) => evidence.push(row),
      tradier: async () => tradierBars, ...providers }).get("AAPL", "5Min", 20);
    assert.equal(result.length, 5, providers.name);
    assert.ok(result.every((bar) => tradierTimes.has(bar.t)), `${providers.name}: only Tradier timestamps`);
    assert.ok(result.every((bar) => bar.c === 10 && bar.provenance.provider === "TRADIER"), providers.name);
    assert.equal(evidence[0].source, "TRADIER");
    assert.equal(evidence[0].completed, 5);
  }
  // Same rule one level down: Polygon's partial history is not topped up with IEX.
  const polygonBars = barsEnding(5, 10, 300000, 20);
  const polygonTimes = new Set(polygonBars.map((bar) => bar.t));
  const fallback = await createStockHistory({ now: () => now, tradier: async () => [],
    polygon: async () => polygonBars, alpaca: async () => newer(30) }).get("AAPL", "5Min", 20);
  assert.equal(fallback.length, 5);
  assert.ok(fallback.every((bar) => polygonTimes.has(bar.t) && bar.c === 20 && bar.provenance.provider === "MASSIVE"));
  assert.ok(fallback.every((bar) => bar.provenance.feed === "CONSOLIDATED"), "no IEX bar inside a consolidated series");
});

test("bars: Tradier auth or rate failures cool down; delayed sandbox history is labelled", async () => {
  let time = now, tradierCalls = 0;
  const evidence = [];
  const history = createStockHistory({ now: () => time, onEvidence: (row) => evidence.push(row),
    tradier: async () => { tradierCalls++; throw Object.assign(new Error("limited"), { status: 429 }); },
    polygon: async () => bars(25) });
  await history.get("AAPL", "5Min", 20);
  time += 45001;
  await history.get("AAPL", "5Min", 20);
  assert.equal(tradierCalls, 1);
  assert.deepEqual(evidence[1].errors, ["tradier:COOLDOWN"]);
  assert.ok(history.getStatus().cooldowns.tradier);
  const delayed = createStockHistory({ now: () => now, tradierDelayed: true, onEvidence: (row) => evidence.push(row),
    tradier: async () => bars(25) });
  const result = await delayed.get("AAPL", "5Min", 20);
  assert.equal(result[0].provenance.timing, "DELAYED");
  assert.equal(evidence.at(-1).delayed, true);
});

test("quotes: Tradier first, Polygon for what Tradier missed, Alpaca IEX only for what both missed", async () => {
  const asked = { polygon: [], alpaca: [] };
  let served = null;
  const published = [];
  const batch = createStockQuoteBatch({
    primary: async (symbols) => { assert.deepEqual(symbols, ["AAA", "BBB", "CCC"]); return [tradierQuote("AAA")]; },
    primaryName: "tradier",
    fallbacks: [
      { name: "polygon", fetch: async (symbols, { signal, timeoutMs }) => {
        assert.ok(signal instanceof AbortSignal); assert.ok(timeoutMs > 0);
        asked.polygon.push(...symbols); return [polygonQuote("BBB")];
      } },
      { name: "alpaca_iex", fetch: async (symbols) => { asked.alpaca.push(...symbols); return [alpacaQuote("CCC")]; } },
    ],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
    onQuotes: (quotes) => published.push(...quotes.map((quote) => quote.symbol)),
    onServed: (summary) => { served = summary; },
  });
  const rows = await batch(["AAA", "BBB", "CCC"]);
  assert.deepEqual(asked.polygon, ["BBB", "CCC"]);
  assert.deepEqual(asked.alpaca, ["CCC"]);
  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.AAA.liveQuoteSource, "tradier_stock_quote");
  assert.equal(bySymbol.BBB.liveQuoteSource, "polygon_stock_snapshot");
  assert.equal(bySymbol.BBB.priceIsLive, true);
  assert.equal(bySymbol.BBB.spreadFresh, true);
  assert.equal(bySymbol.CCC.liveQuoteSource, "alpaca_latest_stock_quote");
  assert.deepEqual(served.servedBy, { tradier: 1, polygon: 1, alpaca_iex: 1 });
  assert.deepEqual(served.fallbackRequested, { polygon: 2, alpaca_iex: 1 });
  assert.deepEqual(published.sort(), ["AAA", "BBB", "CCC"]);
  // The real-time Polygon fallback quote is consolidated and can authorize execution.
  assert.equal(spreadQuoteClass(bySymbol.BBB.provenance).appliesConsolidatedSpreadRule, true);
  const polygonBars = stockFeedProvenance({ provider: "MASSIVE", feed: "CONSOLIDATED" });
  assert.equal(feedEvidenceFinding({ quote: bySymbol.BBB.provenance, intradayBars: polygonBars, dailyBars: polygonBars }).state, "PASS");
  assert.equal(executionQuoteDecision({ provider: bySymbol.BBB.provider, feed: bySymbol.BBB.feed, timing: bySymbol.BBB.timing,
    ageMs: now - Date.parse(bySymbol.BBB.liveQuoteUpdatedAt), spreadPercent: bySymbol.BBB.spreadPercent }).satisfiesExecution, true);
  // The IEX last resort still cannot.
  assert.equal(spreadQuoteClass(bySymbol.CCC.provenance).reason, "CONSOLIDATED_QUOTE_UNAVAILABLE");
});

test("quotes: a stale Tradier quote is refreshed from Polygon, and Alpaca is not asked", async () => {
  const asked = { polygon: [], alpaca: [] };
  let served = null;
  const stale = tradierQuote("AAA", now - 6000);
  assert.equal(stale.priceIsLive, false, "fixture: older than the 5s live window");
  const batch = createStockQuoteBatch({
    primary: async () => [stale],
    primaryName: "tradier",
    fallbacks: [
      { name: "polygon", fetch: async (symbols) => { asked.polygon.push(...symbols); return [polygonQuote("AAA")]; } },
      { name: "alpaca_iex", fetch: async (symbols) => { asked.alpaca.push(...symbols); return [alpacaQuote("AAA")]; } },
    ],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
    onServed: (summary) => { served = summary; },
  });
  const [row] = await batch(["AAA"]);
  assert.deepEqual(asked.polygon, ["AAA"]);
  assert.deepEqual(asked.alpaca, []);
  assert.equal(row.liveQuoteSource, "polygon_stock_snapshot");
  assert.equal(row.priceIsLive, true);
  assert.equal(row.spreadFresh, true);
  assert.deepEqual(served.servedBy, { polygon: 1 });
  assert.deepEqual(served.fallbackRequested, { polygon: 1 });
});

test("quotes: a delayed Polygon quote does not stop the Alpaca last resort and never wins on freshness", async () => {
  const asked = [];
  const delayedAt = now - 15 * 60000;
  const batch = createStockQuoteBatch({
    primary: async () => [],
    fallbacks: [
      { name: "polygon", fetch: async () => [polygonQuote("AAA", delayedAt)] },
      { name: "alpaca_iex", fetch: async (symbols) => { asked.push(...symbols); return [alpacaQuote("AAA")]; } },
    ],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
  });
  const [row] = await batch(["AAA"]);
  assert.deepEqual(asked, ["AAA"]);
  assert.equal(row.liveQuoteSource, "alpaca_latest_stock_quote");
  const delayed = polygonQuote("AAA", delayedAt);
  assert.equal(delayed.delayed, true);
  assert.equal(executionQuoteDecision({ provider: delayed.provider, feed: delayed.feed, timing: delayed.timing,
    ageMs: 1000, spreadPercent: 0.1 }).reason, "DELAYED_FEED");
});

test("quotes: a stalled Polygon stage cannot consume the Alpaca budget", async () => {
  let alpacaAsked = false, polygonAborted = false;
  const batch = createStockQuoteBatch({
    primary: async () => [],
    fallbacks: [
      { name: "polygon", fetch: (_symbols, { signal }) => new Promise((resolve) => signal.addEventListener("abort", () => { polygonAborted = true; resolve([]); }, { once: true })) },
      { name: "alpaca_iex", fetch: async (symbols) => { alpacaAsked = true; return symbols.map((symbol) => alpacaQuote(symbol, Date.now() - 100)); } },
    ],
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    // Polygon gets half (1s); Alpaca keeps about 1s even if timers fire late.
    maxFallbackMs: 2000,
  });
  const started = Date.now();
  const rows = await batch(["AAA"]);
  assert.ok(Date.now() - started < 4000, "bounded by the shared fallback budget");
  assert.equal(alpacaAsked, true);
  assert.equal(rows[0].liveQuoteSource, "alpaca_latest_stock_quote");
  assert.equal(polygonAborted, true, "the stalled stage is cancelled when its window ends");
});

test("execution: Massive needs an explicit REALTIME verdict and still obeys age, spread and tape rules", () => {
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "REALTIME", ageMs: 1000, spreadPercent: 0.2 }).state, "PASS");
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "REALTIME", ageMs: 1000, spreadPercent: 0.2 }).provider, "MASSIVE");
  assert.equal(executionQuoteDecision({ provider: "POLYGON", feed: "snapshot", ageMs: 1000, spreadPercent: 0.2 }).reason, "DELAYED_FEED");
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "DELAYED", ageMs: 1000, spreadPercent: 0.2 }).reason, "DELAYED_FEED");
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "REALTIME", ageMs: 6000, spreadPercent: 0.2 }).reason, "QUOTE_STALE");
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "REALTIME", ageMs: 1000, spreadPercent: 2 }).reason, "SPREAD_TOO_WIDE");
  assert.equal(executionQuoteDecision({ provider: "MASSIVE", feed: "snapshot", timing: "REALTIME", ageMs: 1000, spreadPercent: null }).reason, "SPREAD_UNAVAILABLE");
  // Tradier is unchanged.
  assert.equal(executionQuoteDecision({ provider: "TRADIER", feed: "CONSOLIDATED", ageMs: 1000, spreadPercent: 0.2 }).provider, "TRADIER");
});

test("execution: a real-time Polygon pair beats Alpaca IEX; a delayed one never displaces Tradier", () => {
  const polygon = { ...polygonQuote("AAA"), priceIsLive: true };
  assert.equal(selectStockExecutionQuote(alpacaQuote("AAA"), polygon, { now }), polygon);
  assert.equal(selectStockExecutionQuote(polygon, alpacaQuote("AAA"), { now }), polygon);
  const tradier = tradierQuote("AAA", now - 300);
  assert.equal(selectStockExecutionQuote(tradier, polygonQuote("AAA", now - 200), { now }).liveQuoteSource,
    "polygon_stock_snapshot", "both executable: the newer measurement wins, as before");
  const delayed = polygonQuote("AAA", now - 15 * 60000);
  assert.equal(selectStockExecutionQuote(tradier, delayed, { now }), tradier);
});

test("sweep: a real-time Polygon quote ranks as Massive; delayed or untimed Polygon quotes are rejected", () => {
  const realtime = polygonQuote("RT");
  const delayed = polygonQuote("DL", now - 15 * 60000);
  const untimed = { ...polygonQuote("UT"), delayed: undefined, timing: undefined };
  const legacy = { symbol: "LG", provider: "MASSIVE", price: 10, liveQuoteSource: "polygon_rest_quote",
    liveQuoteUpdatedAt: iso(now), provenance: stockFeedProvenance({ provider: "MASSIVE", feed: "CONSOLIDATED" }) };
  const iex = alpacaQuote("IX");
  const result = rankTradierSweep([realtime, delayed, untimed, legacy, iex, tradierQuote("TR")], { now });
  const ranked = Object.fromEntries(result.ranked.map((row) => [row.symbol, row]));
  assert.deepEqual(Object.keys(ranked).sort(), ["RT", "TR"]);
  assert.equal(ranked.RT.provider, "MASSIVE");
  assert.equal(ranked.RT.timing, "REALTIME");
  assert.equal(ranked.RT.candidateSource, "POLYGON_QUOTE_FALLBACK");
  assert.equal(ranked.TR.provider, "TRADIER");
  assert.equal(ranked.TR.candidateSource, "TRADIER_QUOTE_SWEEP");
  const reasons = Object.fromEntries(result.rejections.map((row) => [row.symbol, row.reason]));
  assert.deepEqual(reasons, { DL: "DELAYED_FEED", UT: "DELAYED_FEED", LG: "DELAYED_FEED", IX: "NO_TRADIER_QUOTE" });
  // A once-real-time quote that has aged past a minute is treated as delayed.
  assert.equal(rankTradierSweep([realtime], { now: now + 61000 }).rejections[0].reason, "DELAYED_FEED");
});

test("health exposes provider order and which provider served quotes and bars", () => {
  const health = stockDataHealth({
    tradier: { history: { state: "HEALTHY" } },
    massive: { quote: { state: "HEALTHY" }, entitlement: { marketData: "REALTIME_CONSOLIDATED" }, lastError: null },
    routing: { quotes: { servedBy: { tradier: 3, polygon: 1 } }, bars: { servedBy: { tradier: 2 } } },
  }).stocks;
  assert.deepEqual(health.routing.quoteOrder, ["TRADIER", "MASSIVE", "ALPACA_IEX"]);
  assert.equal(health.routing.quotes.servedBy.polygon, 1);
  assert.equal(health.routing.bars.servedBy.tradier, 2);
  assert.equal(health.tradier.role, "PRIMARY");
  assert.equal(health.tradier.history.state, "HEALTHY");
  assert.equal(health.massive.role, "FALLBACK");
  assert.equal(health.massive.quote.state, "HEALTHY");
  assert.equal(health.massive.quoteEntitlement.marketData, "REALTIME_CONSOLIDATED");
});

test("routing: server quote route is Tradier, then Polygon, then Alpaca IEX, with cumulative totals", async () => {
  assert.deepEqual(STOCK_QUOTE_ROUTE, ["tradier", "polygon", "alpaca_iex"]);
  const calls = [];
  const routing = createStockQuoteRouting({
    // Each provider serves only its own symbol, so every stage must run in order.
    tradier: { getLatestQuotes: async (symbols) => { calls.push(["tradier", symbols]); return symbols.includes("TTT") ? [tradierQuote("TTT")] : []; } },
    polygon: { getLatestQuotes: async (symbols, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      calls.push(["polygon", symbols]); return symbols.includes("PPP") ? [polygonQuote("PPP")] : [];
    } },
    alpacaIex: async (symbols) => { calls.push(["alpaca_iex", symbols]); return symbols.includes("AAA") ? [alpacaQuote("AAA")] : []; },
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
  });
  const rows = await routing.collect(["TTT", "PPP", "AAA"]);
  assert.deepEqual(calls, [["tradier", ["TTT", "PPP", "AAA"]], ["polygon", ["PPP", "AAA"]], ["alpaca_iex", ["AAA"]]]);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.symbol, row.liveQuoteSource])),
    { TTT: "tradier_stock_quote", PPP: "polygon_stock_snapshot", AAA: "alpaca_latest_stock_quote" });
  await routing.collect(["PPP"]);
  const status = routing.getStatus();
  assert.deepEqual(status.order, ["tradier", "polygon", "alpaca_iex"]);
  assert.deepEqual(status.last.servedBy, { polygon: 1 });
  assert.equal(status.totals.batches, 2);
  assert.equal(status.totals.requested, 4);
  assert.deepEqual(status.totals.servedBy, { tradier: 1, polygon: 2, alpaca_iex: 1 });
  assert.deepEqual(status.totals.fallbackRequested, { polygon: 3, alpaca_iex: 1 });
  // The status is a copy; callers cannot rewrite the counters.
  status.totals.servedBy.polygon = 99;
  assert.equal(routing.getStatus().totals.servedBy.polygon, 2);
});

test("routing: Tradier serving every symbol fresh means no fallback is asked", async () => {
  let fallbackCalls = 0;
  const routing = createStockQuoteRouting({
    tradier: { getLatestQuotes: async (symbols) => symbols.map((symbol) => tradierQuote(symbol)) },
    polygon: { getLatestQuotes: async () => { fallbackCalls++; return []; } },
    alpacaIex: async () => { fallbackCalls++; return []; },
    normalizeSymbol: (value) => String(value || "").toUpperCase(),
    now: () => now,
  });
  await routing.collect(["AAA", "BBB"]);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(routing.getStatus().totals.servedBy, { tradier: 2 });
  assert.deepEqual(routing.getStatus().totals.fallbackRequested, {});
  // A missing Polygon source leaves Alpaca IEX as the only fallback; Tradier is required.
  assert.deepEqual(createStockQuoteRouting({ tradier: { getLatestQuotes: async () => [] }, alpacaIex: async () => [],
    normalizeSymbol: String }).getStatus().order, ["tradier", "alpaca_iex"]);
  assert.throws(() => createStockQuoteRouting({ normalizeSymbol: String }), /Tradier quote source required/);
});

test("routing: bar route uses configured Tradier history first; unconfigured Tradier is skipped", async () => {
  assert.deepEqual(STOCK_BAR_ROUTE, ["tradier", "polygon", "alpaca"]);
  const seen = [];
  const providers = {
    polygon: async () => { seen.push("polygon"); return bars(25, 300000, 20); },
    alpaca: async () => { seen.push("alpaca"); return bars(25, 300000, 30); },
  };
  const configured = createStockHistoryRouting({ now: () => now, ...providers,
    tradierMarketData: { configured: true, sandbox: false, getHistory: async () => { seen.push("tradier"); return bars(25); } } });
  const result = await configured.get("AAPL", "5Min", 20);
  assert.deepEqual(seen, ["tradier"]);
  assert.ok(result.every((bar) => bar.provenance.provider === "TRADIER" && bar.provenance.timing !== "DELAYED"));
  assert.deepEqual(configured.getStatus().order, ["TRADIER", "MASSIVE", "ALPACA"]);

  // The real adapter without a key reports configured=false and is never called.
  seen.length = 0;
  const offline = createTradierMarketData({ apiKey: "", fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(offline.configured, false);
  const unconfigured = createStockHistoryRouting({ now: () => now, ...providers, tradierMarketData: offline });
  const fallback = await unconfigured.get("AAPL", "5Min", 20);
  assert.deepEqual(seen, ["polygon"]);
  assert.ok(fallback.every((bar) => bar.provenance.provider === "MASSIVE"));
  assert.deepEqual(unconfigured.getStatus().order, ["MASSIVE", "ALPACA"]);

  // Sandbox history is still tried first but labelled delayed.
  const sandbox = createStockHistoryRouting({ now: () => now, ...providers,
    tradierMarketData: { configured: true, sandbox: true, getHistory: async () => bars(25) } });
  const delayed = await sandbox.get("AAPL", "5Min", 20);
  assert.ok(delayed.every((bar) => bar.provenance.provider === "TRADIER" && bar.provenance.timing === "DELAYED"));
});

test("with the stock market closed, fallbacks only cover symbols Tradier returned nothing for", async () => {
  const { createStockQuoteRouting: routing } = await import("../market-data/stockDataRouting.js");
  const old = new Date(Date.now() - 20 * 3600000).toISOString();
  const row = (symbol, source) => ({ symbol, price: 10, bid: 9.99, ask: 10.01, spreadAvailable: true,
    liveQuoteUpdatedAt: old, spreadUpdatedAt: old, liveQuoteSource: source, source });
  const asked = { polygon: [], alpaca: [] };
  let open = false;
  const collect = routing({
    tradier: { getLatestQuotes: async (symbols) => symbols.filter((s) => s !== "MISS").map((s) => row(s, "tradier_stock_quote")) },
    polygon: { getLatestQuotes: async (symbols) => { asked.polygon.push(...symbols); return []; } },
    alpacaIex: async (symbols) => { asked.alpaca.push(...symbols); return []; },
    normalizeSymbol: (s) => String(s).toUpperCase(),
    fallbackForStale: () => open,
  }).collect;
  await collect(["AAPL", "MSFT", "MISS"]);
  assert.deepEqual(asked, { polygon: ["MISS"], alpaca: ["MISS"] });
  open = true; asked.polygon = []; asked.alpaca = [];
  await collect(["AAPL", "MISS"]);
  assert.deepEqual(asked.polygon.sort(), ["AAPL", "MISS"], "market open: stale Tradier quotes still get a fallback");
});
