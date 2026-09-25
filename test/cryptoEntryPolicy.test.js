import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CRYPTO_EXECUTION_THRESHOLDS,
  evaluateCryptoAnalyticalQualification,
  evaluateCryptoEntryEvidence,
} from "../scoring/cryptoScoring.js";
import { CRYPTO_MIN_FINAL_SCORE_TO_BUY } from "../scoring/componentScore.js";
import { STOCK_EXECUTION_THRESHOLDS } from "../scoring/decisionScores.js";

test("crypto F 68 and measured E 70 is not rejected for being under 75", () => {
  const result = evaluateCryptoAnalyticalQualification({ finalScore: 68, entryScore: 70 });
  assert.equal(result.state, "PASS");
  assert.equal(result.entry.entryQualityPass, true);
  assert.equal(CRYPTO_EXECUTION_THRESHOLDS.entryScore, null);
});

test("missing crypto Entry waits and stays null", () => {
  const result = evaluateCryptoAnalyticalQualification({ finalScore: 68, entryScore: null });
  assert.equal(result.state, "WAIT");
  assert.equal(result.reason, "ENTRY_QUALITY_UNKNOWN");
  assert.equal(result.entry.score, null);
  assert.notEqual(result.entry.score, 0);
});

test("high Entry does not bypass a final score under 65", () => {
  const result = evaluateCryptoAnalyticalQualification({ finalScore: 62, entryScore: 90 });
  assert.equal(result.state, "REJECT");
  assert.equal(result.reason, "FINAL_SCORE_BELOW_POLICY");
});

test("measured weak Entry is not failed by a hidden 75", () => {
  const result = evaluateCryptoAnalyticalQualification({ finalScore: 70, entryScore: 40 });
  assert.equal(result.state, "PASS");
  assert.equal(result.entry.score, 40);
});

test("the scanner and the trade policy read the same crypto thresholds", () => {
  const scanner = fs.readFileSync(new URL("../strategies/cryptoMarketScanner.js", import.meta.url), "utf8");
  const autoBuy = fs.readFileSync(new URL("../strategies/autoBuyStrategies.js", import.meta.url), "utf8");
  assert.equal(scanner.includes("evaluateCryptoEntryEvidence"), true);
  assert.equal(scanner.includes("entryQualityScore || 0) >= 75"), false);
  assert.equal(CRYPTO_MIN_FINAL_SCORE_TO_BUY, CRYPTO_EXECUTION_THRESHOLDS.finalScore);
  assert.equal(autoBuy.includes("CRYPTO_MIN_FINAL_SCORE_TO_BUY"), true);
  const missing = evaluateCryptoEntryEvidence(null);
  const measured = evaluateCryptoEntryEvidence(70);
  assert.equal(missing.state, "WAIT");
  assert.equal(measured.entryQualityPass, true);
});

test("the phone does not apply the stock Entry floor to crypto", () => {
  const ui = fs.readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
  const start = ui.indexOf("const qualifiedCandidate = isCrypto");
  const cryptoArm = ui.slice(start, ui.indexOf(":", start));
  assert.equal(cryptoArm.includes("75"), false);
  assert.equal(ui.includes("entryQualityScore >= 75"), true);
});

test("the stock Entry floor stays 75", () => {
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore, 75);
});

test("a later crypto Entry floor is read from the same policy", () => {
  const thresholds = { ...CRYPTO_EXECUTION_THRESHOLDS, entryScore: 70 };
  assert.equal(evaluateCryptoEntryEvidence(70, thresholds).entryQualityPass, true);
  assert.equal(evaluateCryptoEntryEvidence(69, thresholds).state, "REJECT");
  assert.equal(evaluateCryptoEntryEvidence(null, thresholds).score, null);
});
