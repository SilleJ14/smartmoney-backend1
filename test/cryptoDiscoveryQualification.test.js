import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCryptoEarlyDiscoveryScore,
  qualifyCryptoDiscovery,
  quietDiscoveryDecision,
} from "../scoring/earlyDiscovery.js";

function dailyBars(count, now = Date.parse("2026-08-20T00:00:00Z")) {
  return Array.from({ length: count }, (_, index) => {
    const base = 100 + index * 0.2;
    return {
      t: new Date(now - (count - index) * 86400000).toISOString(),
      o: base,
      h: base + 0.4,
      l: base - 0.2,
      c: base + 0.1,
      v: 1000,
    };
  });
}

test("fewer than five usable daily bars do not become D 0", () => {
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "SOL/USD",
    dailyBars: dailyBars(3),
    currentPrice: 101,
    now: Date.parse("2026-08-21T00:00:00Z"),
  });
  assert.equal(result.score, null);
  assert.notEqual(result.score, 0);
  assert.equal(result.scoreState, "DATA_UNAVAILABLE");
  assert.equal(result.cryptoDiscovery.qualificationState, "WAIT");
  assert.equal(result.cryptoDiscovery.qualificationReason, "INSUFFICIENT_DISCOVERY_HISTORY");
  assert.equal(result.cryptoDiscovery.scorePass, false);
});

test("a catalyst bonus does not turn a short history into a discovery score", () => {
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "SOL/USD",
    dailyBars: dailyBars(3),
    currentPrice: 101,
    now: Date.parse("2026-08-21T00:00:00Z"),
    newsCatalyst: { catalystAvailable: true, catalystScore: 100, riskDetected: false },
  });
  assert.equal(result.score, null);
  assert.notEqual(result.score, 8);
  assert.equal(result.cryptoDiscovery.qualificationState, "WAIT");
});

test("a measurable D stays visible when the 21-day extension is unknown", () => {
  const decision = qualifyCryptoDiscovery({
    score: 67,
    extensionEvidence: "UNKNOWN",
    structureScore: 63,
  });
  assert.equal(decision.score, 67);
  assert.equal(decision.scorePass, true);
  assert.equal(decision.scoreState, "PASS");
  assert.equal(decision.qualificationState, "WAIT");
  assert.equal(decision.qualificationReason, "INCOMPLETE_MULTI_HORIZON_EXTENSION_EVIDENCE");
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "SOL/USD",
    dailyBars: dailyBars(15),
    currentPrice: 103,
    now: Date.parse("2026-08-21T00:00:00Z"),
  });
  assert.equal(Number.isFinite(result.score), true);
  assert.equal(result.extensionEvidence, "UNKNOWN");
  assert.notEqual(result.score, null);
});

test("complete evidence and a strong measured D pass", () => {
  const decision = qualifyCryptoDiscovery({
    score: 67,
    extensionEvidence: "KNOWN",
    structureScore: 68,
  });
  assert.equal(decision.qualificationState, "PASS");
  assert.equal(decision.scorePass, true);
});

test("a measured D below 60 is a reject", () => {
  const decision = qualifyCryptoDiscovery({
    score: 48,
    extensionEvidence: "KNOWN",
    structureScore: 70,
  });
  assert.equal(decision.qualificationState, "REJECT");
  assert.equal(decision.qualificationReason, "DISCOVERY_SCORE_BELOW_60");
  assert.equal(decision.scorePass, false);
});

test("missing trend structure waits and a measured weak structure rejects", () => {
  const missing = qualifyCryptoDiscovery({
    score: 71,
    extensionEvidence: "KNOWN",
    structureScore: null,
  });
  assert.equal(missing.structure.score, null);
  assert.equal(missing.structure.state, "DATA_UNAVAILABLE");
  assert.equal(missing.qualificationState, "WAIT");
  assert.equal(missing.qualificationReason, "TREND_STRUCTURE_UNKNOWN");
  const weak = qualifyCryptoDiscovery({
    score: 71,
    extensionEvidence: "KNOWN",
    structureScore: 30,
  });
  assert.equal(weak.structure.score, 30);
  assert.equal(weak.qualificationState, "REJECT");
  assert.equal(weak.qualificationReason, "TREND_STRUCTURE_BELOW_55");
});

test("confirmed negative news stays a reject at the capped discovery score", () => {
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "SOL/USD",
    dailyBars: dailyBars(30),
    currentPrice: 106,
    now: Date.parse("2026-08-21T00:00:00Z"),
    newsCatalyst: { riskDetected: true, catalystAvailable: false },
  });
  assert.ok(result.score <= 35);
  assert.equal(result.cryptoDiscovery.qualificationState, "REJECT");
  assert.equal(result.cryptoDiscovery.qualificationReason, "CONFIRMED_NEGATIVE_NEWS");
});

test("legacy momentum does not fill an unavailable discovery score", () => {
  const result = calculateCryptoEarlyDiscoveryScore({
    symbol: "SOL/USD",
    dailyBars: dailyBars(2),
    currentPrice: 100,
    now: Date.parse("2026-08-21T00:00:00Z"),
  });
  const legacyMomentumScore = 50;
  assert.equal(result.score, null);
  assert.notEqual(result.score ?? null, legacyMomentumScore);
  assert.equal(result.cryptoDiscovery.score, null);
});

test("the quiet-discovery 58 line runs only after D is measured", () => {
  assert.equal(quietDiscoveryDecision(null).state, "WAIT");
  assert.equal(quietDiscoveryDecision(null).compared, false);
  assert.equal(quietDiscoveryDecision(58).state, "PASS");
  assert.equal(quietDiscoveryDecision(57).state, "REJECT");
  assert.equal(quietDiscoveryDecision(57).compared, true);
});
