import test from "node:test";
import assert from "node:assert/strict";
import {
  decisionAffectingConfigKeys,
  invalidateAuthorizationsForConfigChange,
} from "../config/configAuthorization.js";

test("decision-affecting configuration invalidates live authorization", () => {
  const row = {
    symbol: "AAPL",
    authorizedDecisionValid: true,
    approved: true,
    backendApproved: true,
    autoTradeApproved: true,
    qualifiedToBuy: true,
  };
  const result = invalidateAuthorizationsForConfigChange(
    [row],
    { liveOrderMaxQuoteAgeSeconds: 4 },
    3
  );
  assert.equal(result.invalidated, 1);
  assert.deepEqual(result.changedKeys, ["liveOrderMaxQuoteAgeSeconds"]);
  assert.equal(row.authorizedDecisionValid, false);
  assert.equal(row.rescoreStatus, "QUEUED");
  assert.equal(row.authorizationInvalidatedByConfigRevision, 3);
});

test("owner automation switches do not rewrite analytical authorization", () => {
  const row = { symbol: "AAPL", authorizedDecisionValid: true, approved: true };
  assert.deepEqual(decisionAffectingConfigKeys({
    autoTradingEnabled: false,
    tradingMode: "paper",
  }), []);
  const result = invalidateAuthorizationsForConfigChange(
    [row],
    { autoTradingEnabled: false },
    4
  );
  assert.equal(result.invalidated, 0);
  assert.equal(row.authorizedDecisionValid, true);
});
