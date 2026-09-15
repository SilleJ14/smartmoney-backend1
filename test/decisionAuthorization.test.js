import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionAuthorization } from '../scoring/decisionAuthorization.js';
const now = Date.now(), stamp = new Date(now).toISOString();
const signal = { symbol: 'BTC/USD', liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp,
  decisionUpdatedAt: stamp, sizingDecisionUpdatedAt: stamp, finalApprovedTradeAmount: 25 };
test('authoritative approval binds symbol, evidence, sizing and expiry', () => {
  const a = decisionAuthorization(signal, { approved: true, reasons: [] }, now);
  assert.equal(a.approved, true); assert.equal(a.approvedAmount, 25);
  assert.equal(Date.parse(a.expiresAt), now + 5000);
  assert.equal(decisionAuthorization(signal, { approved: true, reasons: [] }, now + 5001).approved, false);
  assert.notEqual(decisionAuthorization({...signal, finalApprovedTradeAmount: 10}, {approved:true,reasons:[]}, now).decisionVersion, a.decisionVersion);
});
test('rejected, undated or revoked candidates never get an executable amount', () => {
  for (const [s,g] of [[signal,{approved:false,reasons:['SPREAD_STALE']}],
    [{...signal,spreadUpdatedAt:null},{approved:true,reasons:[]}],
    [{...signal,finalApprovedTradeAmount:0},{approved:true,reasons:[]}],
    [{...signal,sizingDecisionUpdatedAt:'old'},{approved:true,reasons:[]}]]) {
    const a=decisionAuthorization(s,g,now); assert.equal(a.approved,false);assert.equal(a.approvedAmount,0);
  }
});

test('display authorization rejects changed risk policy even if the old scoring gate approved', () => {
  const result = decisionAuthorization({ ...signal, riskPolicyVersion: 'old', currentRiskPolicyVersion: 'new' }, { approved: true, reasons: [] }, now);
  assert.equal(result.approved, false);
  assert.equal(result.approvedAmount, 0);
  assert.ok(result.blockingReasons.includes('RISK_POLICY_CHANGED_REASSESSMENT_REQUIRED'));
});
