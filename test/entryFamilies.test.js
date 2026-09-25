import test from "node:test";
import assert from "node:assert/strict";
import { scoreEntryFamilies } from "../scoring/entryFamilies.js";
import {
  buildStockDecisionScore,
  calculateEntryQualityScore,
  STOCK_EXECUTION_THRESHOLDS,
} from "../scoring/decisionScores.js";
import { evaluateBuyable } from "../scoring/analyticalAuthorization.js";

const bullishTechnicals = {
  ema9: 11,
  ema20: 10.5,
  macd: 1,
  macdSignal: 0,
  rsi: 60,
};

function flatBars(count, volume = 0) {
  return Array.from({ length: count }, (_, index) => ({
    o: 10,
    h: 10.2 + (index % 3) * 0.05,
    l: 9.8,
    c: 10.05,
    v: volume,
  }));
}

test("bullish EMA, MACD, and RSI produce one momentum score", () => {
  const both = scoreEntryFamilies({
    price: 11,
    technicalBarsFound: 40,
    technicals: bullishTechnicals,
  });
  const trendOnly = scoreEntryFamilies({
    price: 11,
    technicalBarsFound: 40,
    technicals: { ema9: 11, ema20: 10.5 },
  });
  const rsiOnly = scoreEntryFamilies({
    price: 11,
    technicalBarsFound: 25,
    technicals: { ema9: 11, ema20: 10.5, rsi: 60, macd: 1, macdSignal: 0 },
  });
  assert.equal(both.families.trend.familyScore, trendOnly.families.trend.familyScore);
  assert.equal(both.families.momentum.familyCoverage, 1);
  assert.equal(both.families.momentum.familyScore, 88);
  assert.equal(rsiOnly.families.momentum.familyScore, 88);
  assert.ok(both.families.momentum.familyScore < rsiOnly.families.momentum.familyScore + 88);
  assert.equal(both.families.momentum.inputs.filter((item) => item.state === "PRESENT").length, 2);
});

test("missing RSI leaves momentum partial and does not invent a bearish MACD", () => {
  const shadow = scoreEntryFamilies({
    price: 11,
    technicalBarsFound: 40,
    technicals: { ema9: 11, ema20: 10.5, macd: 1, macdSignal: 0 },
  });
  const macd = shadow.families.momentum.inputs.find((item) => item.id === "macd");
  const rsi = shadow.families.momentum.inputs.find((item) => item.id === "rsi");
  assert.equal(shadow.families.momentum.familyCoverage, 0.5);
  assert.equal(shadow.families.momentum.state, "PARTIAL");
  assert.equal(macd.score, 88);
  assert.equal(rsi.score, null);
  assert.equal(rsi.state, "UNKNOWN");
  assert.ok(shadow.families.momentum.familyScore > 50);
});

test("a valid retest absorbs VWAP instead of awarding it again", () => {
  const held = {
    setupState: "RETEST",
    continuationStructure: { returnedToLevel: true, supportHeld: true },
  };
  const plain = scoreEntryFamilies(held);
  const withVwap = scoreEntryFamilies({ ...held, confirmations: { aboveVwap: true } });
  const inputs = withVwap.families.structure.inputs.filter((item) => item.score !== null);
  assert.equal(plain.families.structure.familyScore, withVwap.families.structure.familyScore);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].id, "retest");
  assert.deepEqual(inputs[0].absorbed, ["vwap-side"]);
});

test("missing bid and ask leaves execution quality unknown", () => {
  const shadow = scoreEntryFamilies({
    spreadWideningRisk: 8,
    phase5SignalQuality: { spreadWideningRisk: 8, liquidityStabilityScore: 10 },
  });
  assert.equal(shadow.families.execution.familyScore, null);
  assert.equal(shadow.families.execution.state, "UNKNOWN");
  assert.equal(shadow.families.execution.inputs[0].reason, "BOOK_UNAVAILABLE");
});

test("a measured 1.2 percent spread is poor execution quality and still fails the 1 percent rule", () => {
  const wide = scoreEntryFamilies({ bid: 100, ask: 101.21 });
  const tradable = scoreEntryFamilies({ bid: 100, ask: 100.8 });
  assert.ok(wide.families.execution.familyScore < 50);
  assert.ok(tradable.families.execution.familyScore > wide.families.execution.familyScore);
  assert.ok(tradable.families.execution.familyScore < 100);
  const entry = calculateEntryQualityScore({
    bid: 100,
    ask: 101.21,
    price: 100.6,
    technicalBarsFound: 40,
    technicals: bullishTechnicals,
    confirmations: { aboveVwap: true, closeNearHighPercent: 90, fakeBreakout: false },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      breakoutRetestConfirmation: true,
      antiChaseRisk: 10,
    },
  });
  assert.equal(entry.spreadTooWide, true);
  assert.equal(entry.entryFamilyShadow.replacesProductionEntry, false);
  assert.ok(entry.entryFamilyShadow.families.execution.familyScore < 50);
});

test("missing volume stays unknown", () => {
  const shadow = scoreEntryFamilies({
    volume: 0,
    phase5SignalQuality: { liquidityStabilityScore: 15 },
  });
  assert.equal(shadow.families.volume.familyScore, null);
  assert.equal(shadow.families.volume.familyCoverage, 0);
  assert.equal(shadow.families.volume.state, "UNKNOWN");
});

test("25 bars can score EMA and RSI while MACD stays unavailable", () => {
  const bars = flatBars(25, 1000);
  const quiet = scoreEntryFamilies({
    price: 10.05,
    technicalBarsFound: 25,
    chartBars: bars,
    percentChange: 1,
    technicals: { ema9: 10.2, ema20: 10, rsi: 60, macd: 2, macdSignal: 1 },
  });
  const stretchedMove = scoreEntryFamilies({
    price: 10.05,
    technicalBarsFound: 25,
    chartBars: bars,
    percentChange: 12,
    technicals: { ema9: 10.2, ema20: 10, rsi: 60, macd: 2, macdSignal: 1 },
  });
  const macd = quiet.families.momentum.inputs.find((item) => item.id === "macd");
  assert.equal(quiet.families.trend.state, "PRESENT");
  assert.equal(quiet.families.momentum.familyCoverage, 0.5);
  assert.equal(quiet.families.momentum.state, "PARTIAL");
  assert.equal(macd.state, "UNKNOWN");
  assert.equal(macd.reason, "MACD_REQUIRES_34_BARS");
  assert.equal(quiet.macdReady, false);
  assert.notEqual(quiet.families.momentum.familyScore, 34);
  assert.equal(quiet.families.volatility.familyScore, stretchedMove.families.volatility.familyScore);
});

test("34 bars make the intended momentum evidence available", () => {
  const shadow = scoreEntryFamilies({
    price: 11,
    technicalBarsFound: 34,
    technicals: bullishTechnicals,
  });
  const macd = shadow.families.momentum.inputs.find((item) => item.id === "macd");
  assert.equal(shadow.macdReady, true);
  assert.equal(shadow.families.momentum.familyCoverage, 1);
  assert.equal(shadow.families.momentum.state, "PRESENT");
  assert.equal(macd.state, "PRESENT");
  assert.equal(macd.score, 88);
});

test("the same RSI moves momentum and not the shadow analytical risk", () => {
  const shared = {
    price: 11,
    technicalBarsFound: 40,
    confirmations: { newsRisk: false, newsRiskAvailable: true, gapUpPercent: 1 },
  };
  const calm = scoreEntryFamilies({
    ...shared,
    technicals: { ...bullishTechnicals, rsi: 60 },
  });
  const hot = scoreEntryFamilies({
    ...shared,
    technicals: { ...bullishTechnicals, rsi: 90 },
  });
  assert.notEqual(calm.families.momentum.familyScore, hot.families.momentum.familyScore);
  for (const name of ["trend", "structure", "volume", "volatility", "execution"]) {
    assert.equal(calm.families[name].familyScore, hot.families[name].familyScore);
  }
  assert.equal(calm.analyticalRisk.familyScore, hot.analyticalRisk.familyScore);
  assert.ok(calm.analyticalRisk.excludedSharedEntryFacts.includes("rsi"));
  assert.equal(calm.liveAnalyticalRisk.rsiTermRemoved, false);
  assert.equal(calm.liveAnalyticalRisk.reason, "RISK_IN_F_AUDIT");
});

test("breakout and retest use different family requirements", () => {
  const shared = {
    price: 11,
    technicalBarsFound: 40,
    technicals: bullishTechnicals,
    bid: 10,
    ask: 10.02,
  };
  const breakout = scoreEntryFamilies({
    ...shared,
    setupState: "BREAKOUT",
    breakoutStructure: { clearedResistance: true, structureIntact: true },
  });
  const retest = scoreEntryFamilies({
    ...shared,
    setupState: "RETEST",
    continuationStructure: { returnedToLevel: true, supportHeld: true },
    chartBars: Array.from({ length: 24 }, () => ({ open: 10, high: 10.2, low: 9.85, close: 10.05, volume: 1000 })),
  });
  const retestWithoutStructure = scoreEntryFamilies({
    ...shared,
    setupState: "RETEST",
  });
  assert.equal(breakout.familyApproval.shadowApproved, false);
  assert.ok(breakout.familyApproval.missing.includes("volume"));
  assert.ok(breakout.familyApproval.missing.includes("volatility"));
  assert.equal(retest.familyApproval.shadowApproved, true);
  assert.ok(retest.familyApproval.supportive.includes("volume"));
  assert.ok(retest.familyApproval.supportive.includes("momentum"));
  assert.equal(retest.familyApproval.missing.includes("volume"), false);
  assert.equal(retestWithoutStructure.familyApproval.shadowApproved, false);
  assert.ok(retestWithoutStructure.familyApproval.missing.includes("structure"));
});

test("the shadow entry does not change the production score or Buyable", () => {
  const signal = {
    price: 11,
    bid: 10,
    ask: 10.02,
    technicalBarsFound: 40,
    technicals: bullishTechnicals,
    confirmations: { aboveVwap: true, closeNearHighPercent: 90, fakeBreakout: false, newsRiskAvailable: true },
    phase5SignalQuality: {
      liquidityStabilityScore: 90,
      breakoutRetestConfirmation: true,
      antiChaseRisk: 10,
      exhaustionRisk: 10,
      spreadWideningRisk: 5,
    },
    discoveryScorecard: { score: 80, buyScore: 80, coverage: 1, canonicalExtensionEvidencePass: true },
    contextScore: 70,
    riskPortfolioScore: 70,
    fundamentalBlendScore: 70,
    fundamentalDataValid: true,
  };
  const entry = calculateEntryQualityScore(signal);
  const { entryFamilyShadow, ...productionCard } = entry;
  const withShadow = buildStockDecisionScore({ ...signal, entryQualityScorecard: entry });
  const withoutShadow = buildStockDecisionScore({ ...signal, entryQualityScorecard: productionCard });
  assert.equal(withShadow.score, withoutShadow.score);
  assert.equal(entry.entryFamilyShadow.oldEntry, entry.score);
  assert.equal(entry.approved, entry.entryFamilyShadow.entryApproved);
  assert.equal(entry.entryFamilyShadow.controlsLiveApproval, true);
  assert.equal(entry.entryFamilyShadow.replacesProductionEntry, false);
  const buyable = evaluateBuyable({
    authorizedDecisionValid: true,
    authorizedDecisionScore: 80,
    currentAnalyticalScore: withShadow.score,
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 100,
  });
  assert.equal(buyable.buyable, withShadow.score >= 70);
});

test("the new entry threshold stays uncalibrated", () => {
  const entry = calculateEntryQualityScore({
    price: 11,
    bid: 10,
    ask: 10.02,
    technicalBarsFound: 40,
    technicals: bullishTechnicals,
    confirmations: { aboveVwap: true, fakeBreakout: false, closeNearHighPercent: 80 },
    phase5SignalQuality: { liquidityStabilityScore: 80, antiChaseRisk: 10, breakoutRetestConfirmation: true },
  });
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore, 75);
  assert.equal(entry.entryFamilyShadow.productionEntryGate, 75);
  assert.equal(entry.entryFamilyShadow.thresholdStatus, "NOT_CALIBRATED");
  assert.equal(entry.entryFamilyShadow.familyWeights, null);
  assert.equal(entry.entryFamilyShadow.blendMethod, "UNCALIBRATED_EQUAL_COVERAGE");
  assert.equal(entry.entryFamilyShadow.outcomes.status, "UNCALIBRATED");
  assert.deepEqual(entry.entryFamilyShadow.outcomes.windows, ["5m", "15m", "30m", "60m"]);
});
