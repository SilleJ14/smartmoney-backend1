import test from "node:test";
import assert from "node:assert/strict";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";
import {
  CRYPTO_BREADTH_RANGE,
  buildCryptoMarketContext,
  buildCrossAssetCryptoContextScorecard,
} from "../scoring/cryptoContext.js";
import { CRYPTO_ANALYTICAL_THRESHOLD } from "../scoring/cryptoAnalyticalShadow.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

function coin(discovery = 88, extra = {}) {
  return {
    symbol: "BTC/USD",
    cryptoDiscoveryScorecard: {
      score: discovery,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: discovery === 35 },
    barsFound: 30,
    current: 100,
    priceIsLive: true,
    liveQuoteSource: "alpaca_crypto_latest",
    spreadSource: "alpaca_crypto_latest",
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString(),
    bid: 100,
    ask: 100,
    dollarVolume24h: 5_000_000_000,
    intendedNotional: 25,
    cryptoOrderbook: {
      source: "alpaca_crypto_orderbook",
      location: "us",
      symbol: "BTC/USD",
      updatedAt: new Date(now).toISOString(),
      asks: [{ p: 100, s: 100 }],
      bids: [{ p: 100, s: 100 }],
    },
    ...extra,
  };
}

function withBreadth(discovery, peerChanges, contextScore) {
  return coin(discovery, {
    cryptoPeerChanges: peerChanges,
    cryptoContextScorecard: {
      score: contextScore,
      independent: true,
      coverage: 1,
      source: "independent_crypto_context",
    },
  });
}

test("the same coin keeps one analytical F when breadth is 85 or 35", () => {
  const strong = buildCryptoDecisionScore(withBreadth(45, [1, 1, 1, 1, 1], 85), { now });
  const weak = buildCryptoDecisionScore(withBreadth(45, [-1, -1, -1, -1, -1], 35), { now });
  assert.equal(strong.cryptoAnalyticalShadow.cryptoAnalyticalF, 45);
  assert.equal(weak.cryptoAnalyticalShadow.cryptoAnalyticalF, 45);
  assert.notEqual(strong.score, weak.score);
});

test("strong breadth can favor risk and size without raising F", () => {
  const evidence = buildCryptoDecisionScore(withBreadth(45, [1, 1, 1, 1, 1], 85), { now });
  const shadow = evidence.cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 45);
  assert.equal(shadow.cryptoMarketContext.state, "STRONG");
  assert.equal(shadow.cryptoMarketContext.affectsF, false);
  assert.equal(shadow.R.posture, "FAVORABLE");
  assert.equal(shadow.S.regimeMultiplier, 1);
  assert.equal(shadow.R.hardReject, null);
});

test("weak breadth can restrict risk and size without lowering F", () => {
  const evidence = buildCryptoDecisionScore(withBreadth(82, [-1, -1, -1, -1, -1], 35), { now });
  const shadow = evidence.cryptoAnalyticalShadow;
  assert.equal(shadow.cryptoAnalyticalF, 82);
  assert.equal(shadow.cryptoMarketContext.score, 35);
  assert.equal(shadow.R.state, "PASS_WITH_CONSTRAINT");
  assert.equal(shadow.R.reason, "WEAK_CRYPTO_BREADTH");
  assert.equal(shadow.S.regimeMultiplier, 0.5);
  assert.equal(shadow.R.hardReject, null);
});

test("unavailable breadth leaves F unchanged and does not invent a score", () => {
  const bare = buildCryptoDecisionScore(coin(82), { now }).cryptoAnalyticalShadow;
  const weak = buildCryptoDecisionScore(withBreadth(82, [-1, -1, -1, -1, -1], 35), { now }).cryptoAnalyticalShadow;
  assert.equal(bare.cryptoAnalyticalF, weak.cryptoAnalyticalF);
  assert.equal(bare.cryptoMarketContext.state, "DATA_UNAVAILABLE");
  assert.equal(bare.cryptoMarketContext.score, null);
  assert.equal(bare.R.state, "WAIT");
});

test("four peers stay unavailable instead of publishing a discarded 85", () => {
  const context = buildCryptoMarketContext({ peerChanges: [1, 1, 1, 1], measuredAt: new Date(now).toISOString() });
  const card = buildCrossAssetCryptoContextScorecard({ peerChanges: [1, 1, 1, 1] });
  assert.equal(context.state, "DATA_UNAVAILABLE");
  assert.equal(context.score, null);
  assert.equal(card.score, null);
  assert.equal(card.independent, false);
  assert.notEqual(card.score, 85);
});

test("five peers all down score 35 and five peers all up score 85", () => {
  const down = buildCryptoMarketContext({ peerChanges: [-1, -1, -1, -1, -1] });
  const up = buildCryptoMarketContext({ peerChanges: [1, 1, 1, 1, 1] });
  assert.equal(down.score, 35);
  assert.equal(down.state, "WEAK");
  assert.equal(down.peersMeasured, 5);
  assert.equal(down.peersUp, 0);
  assert.equal(down.breadthPct, 0);
  assert.equal(up.score, 85);
  assert.equal(up.state, "STRONG");
  assert.equal(up.peersUp, 5);
  assert.equal(up.breadthPct, 100);
  assert.equal(down.affectsF, false);
  assert.equal(up.affectsF, false);
});

test("strong breadth cannot pull a negative-news discovery of 35 back up", () => {
  const evidence = buildCryptoDecisionScore(withBreadth(35, [1, 1, 1, 1, 1], 85), { now });
  assert.equal(evidence.cryptoAnalyticalShadow.cryptoAnalyticalF, 35);
  assert.equal(evidence.cryptoAnalyticalShadow.cryptoMarketContext.state, "STRONG");
  assert.ok(evidence.score > evidence.cryptoAnalyticalShadow.cryptoAnalyticalF);
});

test("unread breadth bounds use 35 to 85", () => {
  const evidence = buildCryptoDecisionScore(coin(35), { now });
  assert.equal(evidence.minimumPossibleF, 61);
  assert.equal(evidence.maximumPossibleF, 68.5);
  assert.equal(CRYPTO_BREADTH_RANGE.minimumMeasuredScore, 35);
  assert.equal(CRYPTO_BREADTH_RANGE.maximumMeasuredScore, 85);
});

test("the legacy 65.59 score stays beside the intrinsic score during migration", () => {
  const evidence = buildCryptoDecisionScore(coin(35), { now });
  assert.equal(evidence.score, 65.59);
  assert.equal(evidence.cryptoAnalyticalShadow.legacyCryptoF, 65.59);
  assert.equal(evidence.cryptoAnalyticalShadow.cryptoAnalyticalF, 35);
  assert.equal(CRYPTO_ANALYTICAL_THRESHOLD.analyticalMinimum, null);
  assert.equal(CRYPTO_ANALYTICAL_THRESHOLD.inheritsLegacyThreshold, false);
  assert.equal(evidence.cryptoAnalyticalShadow.productionEffect, true);
});
