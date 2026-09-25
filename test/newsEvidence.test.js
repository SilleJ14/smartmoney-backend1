import test from "node:test";
import assert from "node:assert/strict";
import { calculateNewsCatalyst } from "../scoring/newsCatalyst.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";
import { classifyStockNews, buildStockOpportunityLayers } from "../scoring/opportunityLayers.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

test("a covered quiet stock is none-found in the monitored window, not proof that nothing exists", () => {
  const news = calculateNewsCatalyst({
    articles: [{
      headline: "Company schedules regular investor meeting",
      datetime: now - 2 * 60 * 60 * 1000,
      source: "alpaca",
    }],
    dataAvailable: true,
    now,
    coverageMode: "SYMBOL_TAGGED",
    coverageReason: "SYMBOL_TAGGED_BY_PROVIDER",
    sources: ["ALPACA_NEWS"],
  });
  assert.equal(news.catalystScore, 0);
  assert.equal(news.newsEvidence.providerState, "AVAILABLE");
  assert.equal(news.newsEvidence.coverageState, "COVERED");
  assert.equal(news.newsEvidence.catalystState, "NONE_FOUND");
  assert.equal(news.newsEvidence.adverseState, "NONE_FOUND");
  assert.equal(news.newsEvidence.adverseSummary, "No adverse news found in monitored sources/window.");
});

test("provider failure stays unknown and does not look like a quiet covered name", () => {
  const down = calculateNewsCatalyst({ dataAvailable: false, now });
  const quiet = calculateNewsCatalyst({ dataAvailable: true, articles: [], now });
  assert.equal(down.catalystScore, 0);
  assert.equal(quiet.catalystScore, 0);
  assert.equal(down.newsEvidence.providerState, "UNAVAILABLE");
  assert.equal(down.newsEvidence.coverageState, "UNKNOWN");
  assert.equal(down.newsEvidence.catalystState, "UNKNOWN");
  assert.equal(down.newsEvidence.adverseState, "UNKNOWN");
  assert.equal(down.newsEvidence.catalystScore, null);
  assert.equal(quiet.newsEvidence.coverageState, "COVERED");
  assert.equal(quiet.newsEvidence.catalystState, "NONE_FOUND");
  assert.notEqual(down.newsEvidence.catalystState, quiet.newsEvidence.catalystState);
});

test("a crypto category feed without a symbol tag is not covered", () => {
  const news = calculateNewsCatalyst({
    articles: [{
      headline: "XYZ rips as bitcoin traders watch the tape",
      datetime: now - 60 * 60 * 1000,
    }],
    dataAvailable: true,
    now,
    coverageMode: "NOT_COVERED",
    coverageReason: "NO_SYMBOL_TAG",
    sources: ["FINNHUB_CRYPTO_CATEGORY"],
  });
  assert.equal(news.newsEvidence.providerState, "AVAILABLE");
  assert.equal(news.newsEvidence.coverageState, "NOT_COVERED");
  assert.equal(news.newsEvidence.catalystState, "UNKNOWN");
  assert.equal(news.newsEvidence.adverseState, "UNKNOWN");
  assert.equal(news.riskDetected, false);
});

test("an undated headline is partial coverage and is not scored as none found", () => {
  const news = calculateNewsCatalyst({
    articles: [{ headline: "Exchange listing announced", datetime: null }],
    dataAvailable: true,
    now,
  });
  assert.equal(news.newsEvidence.coverageState, "PARTIAL");
  assert.equal(news.newsEvidence.coverageReason, "ARTICLE_TIMESTAMP_MISSING");
  assert.equal(news.newsEvidence.unusableArticles, 1);
  assert.equal(news.newsEvidence.catalystState, "UNKNOWN");
  assert.equal(news.newsEvidence.adverseState, "UNKNOWN");
  assert.equal(news.riskDetected, false);
});

test("measured adverse news stays negative without being confused with a missing feed", () => {
  const news = calculateNewsCatalyst({
    articles: [{
      headline: "Company announces secondary stock offering",
      datetime: now - 60 * 60 * 1000,
    }],
    dataAvailable: true,
    now,
    coverageMode: "SYMBOL_TAGGED",
  });
  assert.equal(news.riskDetected, true);
  assert.equal(news.newsEvidence.coverageState, "COVERED");
  assert.equal(news.newsEvidence.adverseState, "NEGATIVE");
  assert.equal(news.newsEvidence.catalystState, "NONE_FOUND");
});

test("a missing crypto news feed does not change discovery", () => {
  const base = {
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      score: 80,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    barsFound: 30,
    current: 100,
  };
  const covered = buildCryptoDecisionScore({
    ...base,
    newsCatalyst: calculateNewsCatalyst({ dataAvailable: true, articles: [], now }),
  }, { now });
  const down = buildCryptoDecisionScore({
    ...base,
    newsCatalyst: calculateNewsCatalyst({ dataAvailable: false, now }),
  }, { now });
  assert.equal(down.componentsByName.base.value, covered.componentsByName.base.value);
  assert.equal(down.missingCriticalEvidence.includes("newsRiskCoverage"), false);
  assert.equal(down.score, covered.score);
});

test("mandatory stock news waits when the provider is down and does not call it negative", () => {
  const down = calculateNewsCatalyst({ dataAvailable: false, now });
  const signal = {
    requireNewsRiskForEntry: true,
    newsCatalyst: down,
    confirmations: { newsCatalyst: down },
  };
  const news = classifyStockNews(signal);
  assert.equal(news.adverseState, "UNKNOWN");
  assert.notEqual(news.state, "NEGATIVE_CATALYST");
  const layers = buildStockOpportunityLayers(signal);
  assert.equal(layers.C.state, "WAIT");
  assert.ok(layers.C.reasons.includes("NEWS_PROVIDER_UNAVAILABLE"));
});
