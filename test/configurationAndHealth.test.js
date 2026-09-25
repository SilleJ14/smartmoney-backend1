import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseFiniteNumber, parseFiniteNumberDetailed } from "../config/parseFiniteNumber.js";
import {
  CONFIGURATION_SCHEMA,
  applyAutomationPreference,
  auditConfigurationConsumers,
  recordConfigRevision,
} from "../config/configurationSchema.js";
import { sanitizeRuntimeConfig } from "../config/runtimePolicy.js";
import { STOCK_EXECUTION_THRESHOLDS } from "../scoring/stockQualificationPolicy.js";
import { REGULAR_MOVER_DISCOVERY_MAX_SPREAD, PREMARKET_MOVER_DISCOVERY_MAX_SPREAD } from "../scoring/executionPolicy.js";
import {
  createProviderHealth,
  cryptoChannelHealth,
  providerFailureDoesNotScore,
  stockDataHealth,
  symbolEvidenceFromHealth,
} from "../market-data/providerHealth.js";

test("environment zero stays zero and empty or invalid values use the default", () => {
  assert.equal(parseFiniteNumber("0", 300000), 0);
  assert.equal(parseFiniteNumber(0, 300000), 0);
  assert.equal(parseFiniteNumber("", 300000), 300000);
  assert.equal(parseFiniteNumber(undefined, 5), 5);
  const invalid = parseFiniteNumberDetailed("abc", 5);
  assert.equal(invalid.value, 5);
  assert.equal(invalid.reason, "INVALID_NUMBER");
  assert.equal(sanitizeRuntimeConfig({ minScanVolume: 0 }).minScanVolume, 0);
  assert.equal(sanitizeRuntimeConfig({ minScanVolume: "" }).minScanVolume, 300000);
});

test("an automation preference cannot change canonical F70", () => {
  const next = applyAutomationPreference(78);
  assert.equal(next.finalScore, 70);
  assert.equal(next.finalScore, STOCK_EXECUTION_THRESHOLDS.finalScore);
  assert.equal(next.automationMinimumPreference, 78);
  assert.equal(next.changedCanonicalQualification, false);
});

test("declared configuration keys have a consumer unless they are deprecated", () => {
  const audit = auditConfigurationConsumers();
  assert.equal(audit.ok, true, JSON.stringify(audit.unread));
  for (const key of ["runnerWatchlistMinimumConfidence", "runnerHighAlertMinimumMove20Probability", "targetCapitalSlots"]) {
    assert.equal(CONFIGURATION_SCHEMA[key].deprecated, true);
  }
  assert.equal(CONFIGURATION_SCHEMA["policy.stocks.maxQuotedSpreadPercent"].default, 1);
  assert.equal(REGULAR_MOVER_DISCOVERY_MAX_SPREAD, 2);
  assert.equal(PREMARKET_MOVER_DISCOVERY_MAX_SPREAD, 3);
  assert.notEqual(REGULAR_MOVER_DISCOVERY_MAX_SPREAD, STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent);
});

test("runtime configuration changes keep a revision", () => {
  const revision = recordConfigRevision({ minScanVolume: 300000 }, { minScanVolume: 0 }, { revision: 4 });
  assert.equal(revision.revision, 4);
  assert.equal(revision.changes[0].before, 300000);
  assert.equal(revision.changes[0].after, 0);
});

test("the phone uses one API origin", () => {
  const home = fs.readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
  const alpaca = fs.readFileSync(new URL("../../app/(tabs)/alpaca.tsx", import.meta.url), "utf8");
  assert.match(home, /constants\/apiBase/);
  assert.match(alpaca, /constants\/apiBase/);
  assert.doesNotMatch(alpaca, /const BACKEND_BASE_URL = "https:\/\/smartmoney1.onrender.com"/);
});

test("a healthy provider with no symbol quote does not invent a score", () => {
  const evidence = symbolEvidenceFromHealth({ providerHealthy: true, quoteReceived: false });
  assert.equal(evidence.state, "DATA_UNAVAILABLE");
  assert.equal(evidence.reason, "QUOTE_NOT_RECEIVED");
  const down = providerFailureDoesNotScore();
  assert.equal(down.discovery, null);
  assert.equal(down.entry, null);
  assert.equal(down.final, null);
  assert.equal(down.deteriorated, false);
});

test("status health separates feed, entitlement, fallback, and delay", () => {
  const stocks = stockDataHealth({ massive: { delayed: true }, alpaca: { authenticated: true } });
  assert.equal(stocks.stocks.tradier.entitlement.marketData, "REALTIME_CONSOLIDATED");
  assert.equal(stocks.stocks.massive.feed, "DELAYED");
  assert.equal(stocks.stocks.alpaca.stockFeedEntitlement, "IEX");
  assert.equal(stocks.stocks.alpaca.role, "FALLBACK_AND_EXECUTION");
});

test("crypto book timeout waits on execution and does not change analytical F", () => {
  const channels = cryptoChannelHealth({
    quote: { state: "PASS", evidenceAgeMs: 300 },
    bars: { state: "PASS" },
    orderBook: { state: "DATA_UNAVAILABLE", reason: "PROVIDER_TIMEOUT" },
    news: { state: "NOT_COVERED", reason: "NEWS_NOT_COVERED" },
  });
  assert.equal(channels.orderBook.state, "DATA_UNAVAILABLE");
  assert.equal(channels.news.reason, "NEWS_NOT_COVERED");
  const providerDown = symbolEvidenceFromHealth({ providerHealthy: false, covered: false });
  assert.equal(providerDown.reason, "PROVIDER_UNAVAILABLE");
  const uncovered = symbolEvidenceFromHealth({ providerHealthy: true, covered: false, quoteReceived: true });
  assert.equal(uncovered.reason, "NEWS_NOT_COVERED");
});

test("rate limiting and recovery are visible without creating a score", () => {
  const health = createProviderHealth();
  health.note("TRADIER", { ok: false, status: 429, retryAfter: "2s", channel: "quote" });
  const limited = health.snapshot("TRADIER");
  assert.equal(limited.throttling.state, "LIMITED");
  assert.equal(limited.channels.quote.state, "DEGRADED");
  health.note("TRADIER", { ok: true, channel: "quote", latencyMs: 400, feed: "CONSOLIDATED" });
  const recovered = health.snapshot("TRADIER");
  assert.equal(recovered.state, "HEALTHY");
  assert.equal(recovered.channels.quote.state, "HEALTHY");
  assert.equal(providerFailureDoesNotScore().final, null);
});
