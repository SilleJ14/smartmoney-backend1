import test from "node:test";
import assert from "node:assert/strict";
import { assessTechnicalFeatures } from "../scoring/technicalFeatureReadiness.js";
import {
  buildLegacyVetoShadow,
  canonicalRiskAssessment,
  composeCanonicalDecision,
  cryptoRiskEvidence,
} from "../scoring/decisionGateRegistry.js";

function ready(barCount) {
  return assessTechnicalFeatures({
    barCount,
    rsi: 61,
    ema9: 10,
    ema20: 9,
    macd: 0.4,
    macdSignal: 0.2,
  });
}

test("RSI is unavailable at 13 bars and available at 14", () => {
  assert.equal(ready(13).features.RSI.state, "DATA_UNAVAILABLE");
  assert.equal(ready(13).features.RSI.reason, "RSI_REQUIRES_14_BARS");
  assert.equal(ready(14).features.RSI.state, "AVAILABLE");
  assert.equal(ready(14).features.RSI.value, 61);
});

test("EMA20 is unavailable at 19 bars and available at 20", () => {
  assert.equal(ready(19).features.EMA20.state, "DATA_UNAVAILABLE");
  assert.equal(ready(19).features.EMA20.reason, "EMA20_REQUIRES_20_BARS");
  assert.equal(ready(20).features.EMA9.state, "AVAILABLE");
  assert.equal(ready(20).features.EMA20.state, "AVAILABLE");
});

test("MACD stays unavailable through 33 bars and does not zero the value", () => {
  const early = ready(33);
  assert.equal(early.features.MACD.state, "DATA_UNAVAILABLE");
  assert.equal(early.features.MACD.reason, "MACD_REQUIRES_34_BARS");
  assert.equal(early.features.MACD.value, null);
  assert.equal(ready(34).features.MACD.state, "AVAILABLE");
  assert.equal(ready(34).features.MACD_SIGNAL.state, "AVAILABLE");
});

test("25 bars does not call the technical package complete", () => {
  const snapshot = ready(25);
  assert.equal(snapshot.barsAvailable, 25);
  assert.ok(snapshot.availableFeatures.includes("RSI"));
  assert.ok(snapshot.availableFeatures.includes("EMA9"));
  assert.ok(snapshot.availableFeatures.includes("EMA20"));
  assert.ok(snapshot.unavailableFeatures.includes("MACD"));
  assert.ok(snapshot.unavailableFeatures.includes("MACD_SIGNAL"));
  assert.equal(snapshot.packageComplete, false);
  assert.equal(snapshot.technicalsComplete, false);
  assert.equal(snapshot.technicalReadinessForPolicy.legacyEntry, "WAIT");
  assert.equal(snapshot.features.RSI.idealMet, false);
});

test("legacy phase objections do not flip a canonical buyable decision", () => {
  const shadow = buildLegacyVetoShadow({
    phase7Suppressed: true,
    phase9LiquiditySuppressed: true,
    phase11Suppressed: true,
    phase12Suppressed: true,
    phase13Suppressed: true,
    phase14Suppressed: true,
    phase15ExecutionBlocked: true,
    phase59InstitutionalOrderFlow: { shouldBlock: true },
    phase62MarketPersonality: { shouldPersonalityBlock: true },
  });
  const decision = composeCanonicalDecision({
    analytical: "PASS",
    authorization: "PASS",
    C: "PASS",
    X: "PASS",
    R: "PASS",
    S: 100,
    legacyVetoes: shadow,
  });
  assert.equal(decision.buyable, true);
  assert.equal(decision.legacyMayFlipBuyable, false);
  assert.equal(shadow.legacyPhase7WouldBlock, true);
  assert.equal(shadow.legacyPhase9WouldBlock, true);
  assert.equal(shadow.classifiedAs.phase9, "EXECUTION_EVIDENCE");
  assert.equal(shadow.classifiedAs.phase12, "RISK_EVIDENCE");
  assert.equal(shadow.classifiedAs.phase15, "EXECUTION_EVIDENCE");
  assert.equal(shadow.mayChangeCanonicalBuyable, false);
});

test("daily loss and crash are one risk decision and do not change F", () => {
  const loss = canonicalRiskAssessment({ dailyLoss: true, crash: true, equityMacroStress: true, portfolioHeat: true });
  assert.equal(loss.state, "REJECT");
  assert.equal(loss.reasons.filter((reason) => reason === "CRASH_REGIME").length, 1);
  assert.ok(loss.reasons.includes("DAILY_LOSS_LIMIT"));
  assert.equal(loss.affectsF, false);
  assert.equal(loss.duplicatePhaseVetoes, false);
});

test("crypto equity stress is explicit risk evidence", () => {
  const risk = cryptoRiskEvidence({
    equityMacroStress: true,
    cryptoMarketRegime: "WEAK",
    btcRegime: "SHARP_DECLINE",
  });
  assert.equal(risk.hiddenMacroPass, false);
  assert.equal(risk.affectsF, false);
  assert.equal(risk.R.equityMacroStress, "STRESSED");
  assert.equal(risk.R.btcRegime, "SHARP_DECLINE");
  assert.ok(risk.R.reasons.includes("EQUITY_MACRO_STRESS"));
});

test("a failed canonical decision names the blocking layer", () => {
  const decision = composeCanonicalDecision({
    analytical: "PASS",
    authorization: "PASS",
    C: "PASS",
    X: "EXECUTION_NOT_READY",
    xReason: "QUOTE_STALE",
    R: "PASS",
    S: 100,
  });
  assert.equal(decision.buyable, false);
  assert.deepEqual(decision.blockingLayers, [{ layer: "X", reason: "QUOTE_STALE" }]);
});
