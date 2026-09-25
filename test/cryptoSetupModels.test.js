import test from "node:test";
import assert from "node:assert/strict";
import { assessCryptoSetup, assessBtcContext, cryptoSetupGate } from "../scoring/cryptoSetup.js";

const now = Date.parse("2026-09-10T18:00:01Z");
const intervalMs = 300000;

function chart(count, paint) {
  const end = Math.floor(now / intervalMs) * intervalMs;
  return Array.from({ length: count }, (_, index) => {
    const bar = {
      time: end - (count - index) * intervalMs,
      intervalMs,
      open: 100,
      high: 100.2,
      low: 99.8,
      close: 100,
      volume: 100,
    };
    paint(bar, index, count);
    return bar;
  });
}

function setup(chartBars, price) {
  return assessCryptoSetup({ symbol: "ETH/USD", price, chartBars }, { now });
}

test("a fresh breakout can pass without a retest or higher lows", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 1) {
      bar.open = 100.1;
      bar.high = 101.2;
      bar.low = 100.05;
      bar.close = 101;
      bar.volume = 180;
    }
  });
  const result = setup(bars, 101);
  assert.equal(result.cryptoSetupAssessment.candidates.BREAKOUT.state, "PASS");
  assert.equal(result.cryptoSetupAssessment.candidates.RETEST.state, "REJECT");
  assert.equal(result.route, "BREAKOUT");
});

test("a quiet retest can pass below the old 1.3 volume rule", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 3) {
      bar.open = 100.3;
      bar.close = 101;
      bar.high = 101.2;
      bar.low = 100.2;
      bar.volume = 400;
    }
    if (index === count - 2) {
      bar.open = 100.8;
      bar.high = 100.9;
      bar.low = 100.05;
      bar.close = 100.4;
      bar.volume = 40;
    }
    if (index === count - 1) {
      bar.open = 100.4;
      bar.high = 100.8;
      bar.low = 100.2;
      bar.close = 100.7;
      bar.volume = 50;
    }
  });
  const retest = setup(bars, 100.7).cryptoSetupAssessment.candidates.RETEST;
  assert.equal(retest.state, "PASS");
  assert.equal(retest.supportiveEvidence.volumeDryUp, "PASS");
});

test("a trend pullback can pass while the last three bars are down", () => {
  const bars = chart(24, (bar, index) => {
    const base = 100 + index * 0.15;
    bar.open = base;
    bar.close = base + 0.05;
    bar.high = base + 0.2;
    bar.low = base - 0.05;
    if (index === 8) bar.low = 100.2;
    if (index === 14) bar.low = 100.8;
    if (index === 21) {
      bar.open = 103;
      bar.close = 102.4;
      bar.high = 103.1;
      bar.low = 102.2;
    }
    if (index === 22) {
      bar.open = 102.4;
      bar.close = 102.1;
      bar.high = 102.5;
      bar.low = 101.9;
    }
    if (index === 23) {
      bar.open = 102.1;
      bar.close = 102.25;
      bar.high = 102.4;
      bar.low = 102;
    }
  });
  const pullback = setup(bars, 102.25).cryptoSetupAssessment.candidates.TREND_PULLBACK;
  assert.equal(pullback.state, "PASS");
  assert.equal(pullback.supportiveEvidence.threeBarMomentum, "REJECT");
});

test("continuation above the old projected target asks for a new target", () => {
  const bars = chart(24, (bar, index, count) => {
    bar.high = bar.close + 1;
    bar.low = bar.close - 1;
    if (index === count - 6) {
      bar.open = 100.2;
      bar.close = 102;
      bar.high = 102.4;
      bar.low = 100.2;
    }
    if (index === count - 1) {
      bar.open = 104;
      bar.close = 105;
      bar.high = 105.4;
      bar.low = 103.8;
    }
  });
  const continuation = setup(bars, 105).cryptoSetupAssessment.candidates.CONTINUATION;
  assert.equal(continuation.state, "PASS");
  assert.ok(continuation.reasons.includes("TARGET_REASSESSMENT_REQUIRED"));
});

test("a compression breakout is judged against the quiet bars", () => {
  const bars = chart(20, (bar, index, count) => {
    if (index < count - 9) {
      bar.high = 102;
      bar.low = 98;
      bar.volume = 200;
    } else if (index < count - 1) {
      bar.high = 100.15;
      bar.low = 99.9;
      bar.close = 100.05;
      bar.open = 100;
      bar.volume = 40;
    } else {
      bar.open = 100.1;
      bar.high = 100.8;
      bar.low = 100.05;
      bar.close = 100.7;
      bar.volume = 70;
    }
  });
  const compression = setup(bars, 100.7).cryptoSetupAssessment.candidates.COMPRESSION_BREAKOUT;
  assert.equal(compression.state, "PASS");
  assert.equal(compression.requiredEvidence.participationVsCompression, "PASS");
});

test("missing BTC leaves the setup measurable and the regime unavailable", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 1) {
      bar.open = 100.2;
      bar.close = 101;
      bar.high = 101.2;
      bar.low = 100.1;
      bar.volume = 180;
    }
  });
  const signal = { symbol: "ETH/USD", price: 101, chartBars: bars, btcMarketContext: null };
  const gate = cryptoSetupGate(signal, { now });
  assert.equal(gate.setup.eligible, true);
  assert.equal(gate.approved, true);
  assert.equal(gate.marketRegime.state, "DATA_UNAVAILABLE");
});

test("a sharp BTC decline tightens risk without changing the setup", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 1) {
      bar.open = 100.2;
      bar.close = 101;
      bar.high = 101.2;
      bar.low = 100.1;
      bar.volume = 180;
    }
  });
  const calm = cryptoSetupGate({ symbol: "ETH/USD", price: 101, chartBars: bars, btcMarketContext: { bars } }, { now });
  const declining = bars.map((bar, index) => {
    const price = 100 - index * 0.4;
    return { ...bar, open: price, close: price, high: price + 0.05, low: price - 0.05 };
  });
  assert.equal(assessBtcContext(declining, { now }).block, true);
  const stressed = cryptoSetupGate({
    symbol: "ETH/USD",
    price: 101,
    chartBars: bars,
    btcMarketContext: { bars: declining },
  }, { now });
  assert.equal(stressed.setup.route, calm.setup.route);
  assert.equal(stressed.approved, true);
  assert.equal(stressed.marketRegime.state, "PASS_WITH_CONSTRAINT");
  assert.equal(stressed.btcRegime.state, "SHARP_DECLINE");
  assert.equal(stressed.btcRegime.suggestedRiskMultiplier, 0.5);
  assert.equal(stressed.btcRegime.affectsF, false);
  assert.equal(stressed.btcRegime.productionEffect, true);
  assert.equal(stressed.marketRegime.sizeMultiplier, null);
});

test("a live price more than one ATR above the last close is chased, not a different pattern", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 1) {
      bar.open = 100.2;
      bar.close = 101;
      bar.high = 101.2;
      bar.low = 100.1;
      bar.volume = 180;
    }
  });
  const timely = setup(bars, 101);
  const chased = setup(bars, 110);
  assert.equal(timely.route, chased.route);
  assert.equal(chased.entryTiming, "CHASED");
  assert.equal(chased.eligible, true);
});

test("two valid setups resolve by score and then by a fixed order", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 4) {
      bar.open = 100.2;
      bar.close = 101;
      bar.high = 101.1;
      bar.low = 100.1;
      bar.volume = 300;
    }
    if (index === count - 1) {
      bar.close = 101.4;
      bar.high = 101.6;
      bar.low = 101.1;
      bar.open = 101.15;
      bar.volume = 220;
    }
  });
  const first = setup(bars, 101.4).cryptoSetupAssessment;
  const second = setup(bars, 101.4).cryptoSetupAssessment;
  assert.equal(first.candidates.BREAKOUT.state, "PASS");
  assert.equal(first.candidates.CONTINUATION.state, "PASS");
  assert.equal(first.selectedSetup, second.selectedSetup);
  const breakoutScore = first.candidates.BREAKOUT.score;
  const continuationScore = first.candidates.CONTINUATION.score;
  const expected = breakoutScore > continuationScore
    ? "BREAKOUT"
    : continuationScore > breakoutScore
      ? "CONTINUATION"
      : "BREAKOUT";
  assert.equal(first.selectedSetup, expected);
});

test("a failed breakout does not fail a valid retest", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 3) {
      bar.open = 100.3;
      bar.close = 101;
      bar.high = 101.2;
      bar.low = 100.2;
      bar.volume = 400;
    }
    if (index === count - 2) {
      bar.open = 100.5;
      bar.low = 100.05;
      bar.close = 100.4;
      bar.high = 100.6;
      bar.volume = 30;
    }
    if (index === count - 1) {
      bar.close = 100.7;
      bar.high = 100.75;
      bar.low = 100.3;
      bar.open = 100.4;
      bar.volume = 40;
    }
  });
  const assessment = setup(bars, 100.7).cryptoSetupAssessment;
  assert.equal(assessment.candidates.BREAKOUT.state, "REJECT");
  assert.equal(assessment.candidates.RETEST.state, "PASS");
  assert.equal(assessment.selectedSetup, "RETEST");
});

test("short history makes only the setups that need it unavailable", () => {
  const bars = chart(12, (bar, index, count) => {
    if (index === count - 3) {
      bar.open = 100.3;
      bar.close = 101;
      bar.high = 101.1;
      bar.low = 100.2;
      bar.volume = 250;
    }
    if (index === count - 2) {
      bar.open = 100.5;
      bar.low = 100.15;
      bar.close = 100.45;
      bar.high = 100.6;
      bar.volume = 40;
    }
    if (index === count - 1) {
      bar.open = 100.5;
      bar.close = 100.8;
      bar.high = 100.9;
      bar.low = 100.4;
      bar.volume = 60;
    }
  });
  const assessment = setup(bars, 100.8).cryptoSetupAssessment;
  assert.equal(assessment.candidates.BREAKOUT.state, "DATA_UNAVAILABLE");
  assert.equal(assessment.candidates.RETEST.state, "PASS");
});

test("exhaustion blocks every new long setup", () => {
  const bars = chart(24, (bar, index, count) => {
    if (index === count - 1) {
      bar.open = 102;
      bar.high = 102.2;
      bar.low = 99;
      bar.close = 99.4;
      bar.volume = 2000;
    }
  });
  const assessment = setup(bars, 99.4).cryptoSetupAssessment;
  assert.equal(assessment.exhausted, true);
  for (const candidate of Object.values(assessment.candidates)) {
    if (candidate.state === "DATA_UNAVAILABLE") continue;
    assert.equal(candidate.state, "REJECT");
    assert.ok(candidate.reasons.includes("EXHAUSTION"));
  }
  assert.equal(assessment.selectedSetup, null);
});
