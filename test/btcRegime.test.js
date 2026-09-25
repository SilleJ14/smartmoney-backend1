import test from "node:test";
import assert from "node:assert/strict";
import { assessBtcContext, cryptoSetupGate } from "../scoring/cryptoSetup.js";
import { buildBtcRegime, buildBtcRegimeOutcome } from "../scoring/btcRegime.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";

const now = Date.parse("2026-09-10T18:00:01Z");
const intervalMs = 300000;

function bars(paint) {
  const end = Math.floor(now / intervalMs) * intervalMs;
  return Array.from({ length: 24 }, (_, index) => {
    const price = 100;
    const bar = {
      time: end - (24 - index) * intervalMs,
      intervalMs,
      open: price,
      high: price + 0.2,
      low: price - 0.2,
      close: price,
      volume: 100,
    };
    paint(bar, index);
    return bar;
  });
}

const coinBars = bars((bar, index) => {
  if (index === 23) {
    bar.open = 100.2;
    bar.high = 101.2;
    bar.low = 100.1;
    bar.close = 101;
    bar.volume = 180;
  }
});

function coin(extra = {}) {
  return {
    symbol: "ETH/USD",
    price: 101,
    chartBars: coinBars,
    cryptoDiscoveryScorecard: {
      score: 83,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    ...extra,
  };
}

test("a sharp BTC decline is a shadow risk note and does not change the coin score", () => {
  const declining = bars((bar, index) => {
    const price = 100 - index * 0.4;
    bar.open = price;
    bar.close = price;
    bar.high = price + 0.05;
    bar.low = price - 0.05;
  });
  const calm = cryptoSetupGate(coin({ btcMarketContext: { bars: coinBars } }), { now });
  const stressed = cryptoSetupGate(coin({ btcMarketContext: { bars: declining } }), { now });
  assert.equal(stressed.btcRegime.state, "SHARP_DECLINE");
  assert.equal(stressed.btcRegime.below20BarAverage, true);
  assert.ok(stressed.btcRegime.oneHourReturn <= -3);
  assert.equal(stressed.btcRegime.suggestedRiskMultiplier, 0.5);
  assert.equal(stressed.btcRegime.affectsF, false);
  assert.equal(stressed.btcRegime.affectsSetup, false);
  assert.equal(stressed.btcRegime.affectsX, false);
  assert.equal(stressed.btcRegime.productionEffect, true);
  assert.equal(stressed.setup.route, calm.setup.route);
  assert.equal(stressed.approved, calm.approved);
  const calmScore = buildCryptoDecisionScore(coin({ btcMarketContext: { bars: coinBars } }), { now });
  const stressedScore = buildCryptoDecisionScore(coin({ btcMarketContext: { bars: declining } }), { now });
  assert.equal(stressedScore.cryptoAnalyticalShadow.cryptoAnalyticalF, calmScore.cryptoAnalyticalShadow.cryptoAnalyticalF);
  assert.equal(stressedScore.score, calmScore.score);
});

test("missing or stale BTC bars stay unavailable and do not invent a decline", () => {
  const missing = buildBtcRegime(assessBtcContext([], { now }));
  assert.equal(missing.state, "DATA_UNAVAILABLE");
  assert.equal(missing.available, false);
  assert.equal(missing.oneHourReturn, null);
  assert.equal(missing.below20BarAverage, null);
  assert.equal(missing.suggestedRiskMultiplier, null);
  const gate = cryptoSetupGate(coin({ btcMarketContext: null }), { now });
  assert.equal(gate.btcRegime.state, "DATA_UNAVAILABLE");
  assert.equal(gate.approved, true);
  assert.equal(gate.btcRegimeOutcome.shadowBtcAdjustedSize, null);
});

test("a sharp decline cuts the live size and leaves the later prices empty", () => {
  const declining = bars((bar, index) => {
    const price = 100 - index * 0.4;
    bar.open = price;
    bar.close = price;
    bar.high = price + 0.05;
    bar.low = price - 0.05;
  });
  const gate = cryptoSetupGate(coin({
    btcMarketContext: { bars: declining },
    cryptoDecisionScore: 83,
    intendedNotional: 500,
  }), { now });
  const outcome = gate.btcRegimeOutcome;
  assert.equal(outcome.coinF, 83);
  assert.equal(outcome.btcState, "SHARP_DECLINE");
  assert.equal(outcome.proposedSize, 500);
  assert.equal(outcome.shadowBtcAdjustedSize, 250);
  assert.equal(outcome.liveSize, 250);
  assert.equal(outcome.forwardReturns.m5, null);
  assert.equal(outcome.forwardReturns.m60, null);
  assert.equal(outcome.maximumFavorableExcursion, null);
  assert.equal(outcome.maximumAdverseExcursion, null);
  assert.equal(outcome.productionEffect, true);
  assert.equal(buildBtcRegimeOutcome({ btcRegime: gate.btcRegime, symbol: "ETH/USD" }, { proposedSize: 500 }).shadowBtcAdjustedSize, 250);
});
