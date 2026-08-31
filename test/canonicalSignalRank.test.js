import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCanonicalSignals,
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
} from "../scoring/canonicalSignalRank.js";

test("candidate ranking uses canonical F and explicit approval, never legacy score", () => {
  const approvedLowerF = {
    symbol: "AAA",
    score: 10,
    stockDecisionScore: 78,
    stockDecisionScoreAvailable: true,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  const unapprovedHighLegacy = {
    symbol: "BBB",
    score: 99,
    stockDecisionScore: 91,
    stockDecisionScoreAvailable: true,
    qualifiedToBuy: false,
    autoTradeApproved: false,
  };
  const unavailable = {
    symbol: "CCC",
    score: 100,
    stockDecisionScore: 100,
    stockDecisionScoreAvailable: false,
  };
  const ranked = [unavailable, unapprovedHighLegacy, approvedLowerF].sort(compareCanonicalSignals);
  assert.deepEqual(ranked.map((item) => item.symbol), ["AAA", "BBB", "CCC"]);
  assert.equal(getCanonicalFinalScore(unavailable), null);
});

test("candidate approval requires every explicit backend approval field", () => {
  const complete = {
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  assert.equal(hasExplicitTradeApproval(complete), true);
  for (const field of Object.keys(complete)) {
    const missing = { ...complete };
    delete missing[field];
    assert.equal(hasExplicitTradeApproval(missing), false, `${field} is required`);
  }
});

test("canonical F uses one stable score priority for stocks and crypto", () => {
  assert.equal(getCanonicalFinalScore({
    symbol: "AAPL",
    masterFinalScore: 84,
    finalAutonomousDecisionScore: 82,
    stockDecisionScore: 70,
    stockDecisionScoreAvailable: true,
  }), 84);
  assert.equal(getCanonicalFinalScore({
    symbol: "BTC/USD",
    assetClass: "crypto",
    cryptoDecisionScore: 65,
    masterFinalScore: 90,
    cryptoDecisionScoreAvailable: true,
  }), 65);
});
