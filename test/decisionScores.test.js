import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionScoreTelemetry, calculateEarlyDiscoveryScore, calculateEntryQualityScore, calculateMultiDayContinuationScore } from "../scoring/decisionScores.js";

test("early discovery is independent from unsafe entry timing", () => {
  const signal = { percentChange: 7, volumeRatio: 3, preMoveScore: 88, accumulationIntelligence: { accumulationScore: 82 }, catalystScore: 75, lateChaseRisk: true };
  const discovery = calculateEarlyDiscoveryScore(signal);
  const entry = calculateEntryQualityScore({ ...signal, phase5SignalQuality: { hardReject: true, liquidityStabilityScore: 80 } });
  assert.ok(discovery.score >= 75);
  assert.ok(entry.score <= 35);
});

test("entry score consolidates correlated risks with a max risk component", () => {
  const base = { confirmations: { aboveVwap: true, closeNearHighPercent: 82 }, technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 }, phase5SignalQuality: { liquidityStabilityScore: 80, antiChaseRisk: 80, exhaustionRisk: 80, spreadWideningRisk: 80 } };
  const oneRisk = calculateEntryQualityScore(base);
  const repeatedRisk = calculateEntryQualityScore({ ...base, phase5SignalQuality: { ...base.phase5SignalQuality, antiChaseRisk: 80, exhaustionRisk: 20, spreadWideningRisk: 20 } });
  assert.equal(oneRisk.components.find((c) => c.name === "riskProtection").value, repeatedRisk.components.find((c) => c.name === "riskProtection").value);
});

test("multi-day continuation requires observed multi-session evidence", () => {
  const strong = calculateMultiDayContinuationScore({ multiDayAccumulation: { persistenceScore: 88, supportHoldingScore: 85, seenDays: [1, 2, 3, 4] }, confirmations: { aboveVwap: true, closeNearHigh: true }, technicals: { ema9: 12, ema20: 10 } });
  const newMover = calculateMultiDayContinuationScore({ percentChange: 30, volumeRatio: 8, confirmations: { aboveVwap: true }, technicals: { ema9: 12, ema20: 10 } });
  assert.ok(strong.score >= 75);
  assert.ok(newMover.score < strong.score);
  assert.ok(newMover.missingComponents.includes("observedPersistence"));
});

test("decision telemetry exposes every component value, weight, and contribution", () => {
  const telemetry = buildDecisionScoreTelemetry({ percentChange: 4, volumeRatio: 2, confirmations: { aboveVwap: true, closeNearHighPercent: 75 }, technicals: { ema9: 11, ema20: 10 }, multiDayAccumulation: { persistenceScore: 70, supportHoldingScore: 75, seenDays: [1, 2] } });
  assert.deepEqual(Object.keys(telemetry.scores), ["discovery", "entry", "continuation"]);
  for (const stage of Object.values(telemetry.stages)) {
    assert.ok(stage.components.length > 0);
    for (const item of stage.components) {
      assert.equal(typeof item.value, "number");
      assert.equal(typeof item.weight, "number");
      assert.equal(typeof item.contribution, "number");
      assert.equal(typeof item.source, "string");
    }
  }
});
