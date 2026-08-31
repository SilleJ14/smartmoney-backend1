import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCrossAssetCryptoContext,
  buildCrossAssetCryptoContextScorecard,
} from "../scoring/cryptoContext.js";

test("cross-asset crypto context supplies independent decision coverage with enough peers", () => {
  const now = new Date("2026-08-31T15:00:00.000Z");
  const scorecard = buildCrossAssetCryptoContextScorecard(
    { peerChanges: [1.2, 0.8, -0.5, 2.1, 0.4] },
    { now: () => now }
  );

  assert.equal(scorecard.independent, true);
  assert.equal(scorecard.coverage, 1);
  assert.equal(scorecard.sampleSize, 5);
  assert.equal(scorecard.positiveCount, 4);
  assert.equal(scorecard.breadthRatio, 0.8);
  assert.equal(scorecard.score, 75);
  assert.equal(scorecard.calculatedAt, now.toISOString());
});

test("cross-asset crypto context stays unavailable when the peer sample is too small", () => {
  const signals = [
    { symbol: "BTC/USD", percentChange: 10 },
    { symbol: "ETH/USD", percentChange: 1 },
  ];
  const scorecard = applyCrossAssetCryptoContext(
    signals,
    { reviewedCount: 2, approvedCount: 2 }
  );

  assert.equal(scorecard.independent, false);
  assert.equal(scorecard.coverage, 0);
  assert.equal(signals[0].cryptoContextScorecard.independent, false);
  assert.notEqual(
    signals[0].cryptoContextScorecard,
    signals[1].cryptoContextScorecard,
    "signals receive independent scorecard objects"
  );
});

test("each crypto context excludes that asset's own move", () => {
  const signals = [
    { symbol: "BTC/USD", percentChange: 50 },
    { symbol: "ETH/USD", percentChange: 1 },
    { symbol: "SOL/USD", percentChange: 1 },
    { symbol: "AVAX/USD", percentChange: 1 },
    { symbol: "LINK/USD", percentChange: -1 },
    { symbol: "LTC/USD", percentChange: -1 },
  ];

  applyCrossAssetCryptoContext(signals, {});

  const btcContext = signals[0].cryptoContextScorecard;
  const ethContext = signals[1].cryptoContextScorecard;
  assert.equal(btcContext.sampleSize, 5);
  assert.equal(btcContext.positiveCount, 3);
  assert.equal(ethContext.positiveCount, 3);
  assert.ok(
    btcContext.averagePeerChange < ethContext.averagePeerChange,
    "BTC's own 50% move is excluded from BTC context but remains a peer observation for ETH"
  );
});
