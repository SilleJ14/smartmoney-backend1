import test from "node:test";
import assert from "node:assert/strict";
import {
  breakoutFeedState,
  feedEvidenceFinding,
  marketDataQuality,
  scopedRelativeVolume,
  spreadQuoteClass,
  stockFeedProvenance,
} from "../market-data/feedContract.js";
import { buildCurrentAnalyticalSnapshot } from "../scoring/analyticalSnapshot.js";
import { normalizeTradierRestBook } from "../market-data/normalizedQuote.js";
import { createStockHistory } from "../market-data/stockHistory.js";
import { selectStockExecutionQuote } from "../market-data/stockQuoteSelection.js";
import { buildStockOpportunityLayers } from "../scoring/opportunityLayers.js";

const consolidated = (provider) => stockFeedProvenance({ provider, feed: "CONSOLIDATED", measuredAt: "2026-09-25T14:00:00.000Z" });
const iex = stockFeedProvenance({ provider: "ALPACA", feed: "IEX", measuredAt: "2026-09-25T14:00:00.000Z" });

test("Tradier quote and Massive bars are both consolidated", () => {
  const quote = consolidated("TRADIER");
  const bars = consolidated("MASSIVE");
  assert.equal(quote.provider, "TRADIER");
  assert.equal(quote.feed, "CONSOLIDATED");
  assert.equal(quote.isConsolidated, true);
  assert.equal(bars.provider, "MASSIVE");
  assert.equal(bars.volumeScope, "CONSOLIDATED");
  assert.equal(marketDataQuality({ quote, intradayBars: bars }).state, "FULL_CONSOLIDATED");
});

test("Alpaca Basic fallback is explicitly IEX", () => {
  assert.equal(iex.provider, "ALPACA");
  assert.equal(iex.feed, "IEX");
  assert.equal(iex.isConsolidated, false);
  assert.equal(iex.volumeScope, "IEX_ONLY");
  assert.equal(iex.feedVersion, "alpaca-iex-v1");
  assert.notEqual(stockFeedProvenance({ provider: "ALPACA", feed: "SIP" }).feedVersion, iex.feedVersion);
});

test("IEX volume cannot use a consolidated relative-volume baseline", () => {
  const mixed = scopedRelativeVolume({
    currentVolume: 1000,
    currentProvenance: iex,
    baselineVolume: 50000,
    baselineProvenance: consolidated("MASSIVE"),
  });
  assert.equal(mixed.value, null);
  assert.equal(mixed.reason, "FEED_SCOPE_MISMATCH");
  const same = scopedRelativeVolume({
    currentVolume: 1000,
    currentProvenance: iex,
    baselineVolume: 200,
    baselineProvenance: iex,
  });
  assert.equal(same.value, 5);
  assert.equal(same.rule, "IEX_RVOL");
});

test("a consolidated price cannot break out against an IEX high", () => {
  const crossed = breakoutFeedState({
    priceProvenance: consolidated("TRADIER"),
    highProvenance: iex,
  });
  assert.equal(crossed.state, "DEGRADED_FEED");
  assert.equal(crossed.comparable, false);
  const national = breakoutFeedState({
    priceProvenance: consolidated("TRADIER"),
    highProvenance: consolidated("MASSIVE"),
  });
  assert.equal(national.state, "PASS");
  assert.equal(national.rule, "FULL_MARKET_BREAKOUT");
});

test("an IEX quote cannot use the consolidated spread rule", () => {
  const degraded = spreadQuoteClass(iex);
  assert.equal(degraded.appliesConsolidatedSpreadRule, false);
  assert.equal(degraded.reason, "CONSOLIDATED_QUOTE_UNAVAILABLE");
  assert.equal(spreadQuoteClass(consolidated("TRADIER")).source, "CONSOLIDATED_LIVE_QUOTE");
});

test("the analytical snapshot keeps quote and bar providers beside F", () => {
  const components = { discovery: { score: 74, coverage: 1, configuredWeight: 1, measuredWeight: 1, state: "PASS" } };
  const weights = { discovery: 1 };
  const massive = buildCurrentAnalyticalSnapshot({
    components, weights, F: 74, marketData: { quote: consolidated("TRADIER"), intradayBars: consolidated("MASSIVE"), dailyBars: null },
  });
  const iexBars = buildCurrentAnalyticalSnapshot({
    components, weights, F: 74, marketData: { quote: consolidated("TRADIER"), intradayBars: iex, dailyBars: null },
  });
  assert.equal(massive.F, iexBars.F);
  assert.equal(massive.marketData.intradayBars.provider, "MASSIVE");
  assert.equal(iexBars.marketData.intradayBars.feed, "IEX");
  assert.notEqual(massive.draftKey, iexBars.draftKey);
});

test("missing feed metadata is not usable", () => {
  const missing = stockFeedProvenance({});
  assert.equal(missing.state, "DATA_UNAVAILABLE");
  assert.equal(missing.usable, false);
  assert.equal(feedEvidenceFinding({ quote: null, intradayBars: null }).reason, "FEED_PROVENANCE_MISSING");
});

test("IEX bars make evidence wait instead of rewriting F", () => {
  const layers = buildStockOpportunityLayers({
    symbol: "XYZ",
    currentAnalyticalScore: 79,
    entryQualityScore: 81,
    entryQualityScorecard: { approved: true, score: 81, coverage: 1 },
    quoteProvenance: consolidated("TRADIER"),
    intradayBarProvenance: iex,
  }, {
    requiredF: 70,
    eligibility: {
      quoteAgeSeconds: 1,
      quoteSourceApproved: true,
      quoteFreshnessPass: true,
      spreadAvailable: true,
      spreadTooWide: false,
      spreadAgeSeconds: 1,
      spreadSourceApproved: true,
      spreadFreshnessPass: true,
      centralDecisionPass: true,
    },
  });
  assert.equal(layers.F, 79);
  assert.equal(layers.C.state, "WAIT");
  assert.ok(layers.C.reasons.includes("CONSOLIDATED_BAR_HISTORY_REQUIRED"));
});

test("chart bars keep the provider that actually returned them", async () => {
  const now = Date.now();
  const bar = { o: 10, h: 11, l: 9.5, c: 10.5, v: 1000, t: now - 400000 };
  const history = createStockHistory({
    polygon: async () => [bar],
    alpaca: async () => [{ ...bar, v: 20, h: 10.2 }],
    now: () => now,
  });
  const bars = await history.get("AAPL", "5Min", 5);
  assert.equal(bars[0].provenance.provider, "MASSIVE");
  assert.equal(bars[0].provenance.feed, "CONSOLIDATED");
  assert.equal(bars[0].v, 1000);
});

test("a fresh Tradier quote stays ahead of a fresh Alpaca IEX quote", () => {
  const now = Date.now();
  const iso = (time) => new Date(time).toISOString();
  const tradier = {
    priceIsLive: true,
    liveQuoteUpdatedAt: iso(now - 2000),
    spreadUpdatedAt: iso(now - 2000),
    liveQuoteSource: "tradier_stock_quote",
    spreadSource: "tradier_stock_quote",
    provenance: consolidated("TRADIER"),
  };
  const alpaca = {
    ...tradier,
    liveQuoteUpdatedAt: iso(now - 200),
    spreadUpdatedAt: iso(now - 200),
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    provenance: iex,
  };
  assert.equal(selectStockExecutionQuote(tradier, alpaca, { now }), tradier);
});

test("Tradier bid and ask size survive with consolidated provenance", () => {
  const book = normalizeTradierRestBook({
    bid: 100,
    ask: 100.1,
    bidsize: 4,
    asksize: 8,
  }, "2026-09-25T14:00:00.000Z");
  assert.equal(book.bidSizeRaw, 4);
  assert.equal(book.askSizeRaw, 8);
  assert.equal(book.provenance.provider, "TRADIER");
  assert.equal(book.provenance.feed, "CONSOLIDATED");
  assert.equal(book.provenance.isConsolidated, true);
});
