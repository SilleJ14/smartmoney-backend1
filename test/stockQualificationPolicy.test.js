import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STOCK_EXECUTION_THRESHOLDS,
  analyticalStockPass,
  classifyStockMarketStress,
  classifyStockScoreBand,
} from "../scoring/stockQualificationPolicy.js";
import { evaluateCanonicalStockAutoBuyEligibility } from "../strategies/autoBuyStrategies.js";

const qualifiedEvidence = {
  finalScore: 70,
  entryApproved: true,
  entryCoverage: 0.8,
};

test("F69 with an approved entry is not qualified", () => {
  assert.equal(classifyStockScoreBand(69), "WATCH");
  assert.equal(analyticalStockPass({ ...qualifiedEvidence, finalScore: 69 }), false);
});

test("F70 without the setup entry approval is not qualified", () => {
  assert.equal(analyticalStockPass({ ...qualifiedEvidence, entryApproved: false }), false);
});

test("F70 with entry 75 and coverage 0.80 is analytically qualified", () => {
  assert.equal(analyticalStockPass(qualifiedEvidence), true);
  assert.equal(classifyStockScoreBand(70), "QUALIFIED");
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore, 70);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore, 75);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryCoverage, 0.8);
});

test("F74 can auto-buy without an extra F78 floor", () => {
  const now = new Date().toISOString();
  const signal = {
    currentAnalyticalScore: 74,
    stockDecisionScore: 74,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, coverage: 0.8, score: 80 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: now,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  const result = evaluateCanonicalStockAutoBuyEligibility(signal);
  assert.equal(result.minimumScore, 70);
  assert.equal(result.approved, true, JSON.stringify(result.evidence.reasons));
  assert.equal(classifyStockScoreBand(74), "QUALIFIED");
});

test("F80 is Strong and F86 is Exceptional without a different buy gate", () => {
  assert.equal(classifyStockScoreBand(80), "STRONG");
  assert.equal(classifyStockScoreBand(86), "EXCEPTIONAL");
  assert.equal(STOCK_EXECUTION_THRESHOLDS.strongScore, 78);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.exceptionalScore, 85);
  assert.equal(analyticalStockPass({ finalScore: 80, entryApproved: true, entryCoverage: 0.8 }), true);
  assert.equal(analyticalStockPass({ finalScore: 86, entryApproved: true, entryCoverage: 0.8 }), true);
  assert.equal(Object.values(STOCK_EXECUTION_THRESHOLDS).includes(86), false);
});

test("market stress cannot move required F and can change risk and size", () => {
  const calm = classifyStockMarketStress({ marketStress: 20 });
  const elevated = classifyStockMarketStress({ marketStress: 65 });
  const high = classifyStockMarketStress({ marketStress: 82 });
  const extreme = classifyStockMarketStress({ marketStress: 95 });
  for (const state of [calm, elevated, high, extreme]) {
    assert.equal(state.requiredF, 70);
    assert.equal(state.movesRequiredF, false);
  }
  assert.equal(calm.R.state, "PASS");
  assert.equal(calm.S.multiplier, 1);
  assert.equal(elevated.R.state, "PASS_WITH_CONSTRAINT");
  assert.equal(elevated.S.multiplier, 0.75);
  assert.equal(high.R.state, "PASS_WITH_CONSTRAINT");
  assert.equal(high.S.multiplier, 0.5);
  assert.equal(extreme.R.state, "REJECT");
  assert.equal(extreme.S.multiplier, 0);
  assert.equal(high.R.affectsF, false);
});

test("a runner score cannot qualify a stock whose canonical F fails", () => {
  assert.equal(analyticalStockPass({
    finalScore: 60,
    entryApproved: true,
    entryCoverage: 1,
  }), false);
  assert.equal(classifyStockScoreBand(99), "EXCEPTIONAL");
  assert.notEqual(classifyStockScoreBand(60), "QUALIFIED");
});

test("phone fallback and settings use the canonical stock policy", () => {
  const phone = fs.readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(phone, /analyticalStockPass/);
  assert.match(phone, /STOCK_EXECUTION_THRESHOLDS\.finalScore/);
  assert.doesNotMatch(phone, /STOCK_QUALIFIED_SCORE = 72/);
  assert.doesNotMatch(phone, /MIN_SCORE_TO_BUY_FLOOR = 78/);
  assert.match(phone, /Automation score preference/);
});

test("auto-buy, learning, and the live starter do not invent another final-score gate", () => {
  const autoBuy = fs.readFileSync(new URL("../strategies/autoBuyStrategies.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.doesNotMatch(autoBuy, /Math\.max\(\s*78/);
  assert.match(autoBuy, /canonicalBuyScore = STOCK_EXECUTION_THRESHOLDS\.finalScore/);
  assert.doesNotMatch(server, /finalLiveScore < LIVE_STARTER_MIN_FINAL_SCORE/);
  assert.doesNotMatch(server, /Math\.min\(dynamicThreshold, 85\)/);
  assert.match(server, /learningAdjustsQualification: false/);
  assert.match(server, /affectsCanonicalQualification: false/);
  assert.match(server, /fastRunnerMinimum: FAST_RUNNER_MIN_SCORE/);
  assert.match(server, /runnerHoldMinimum: 80/);
});
