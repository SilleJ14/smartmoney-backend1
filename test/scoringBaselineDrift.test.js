import test from 'node:test';
import assert from 'node:assert/strict';
import { scoringBaselineInputs } from './fixtures/scoringBaseline.js';
import { buildStockDecisionScore, STOCK_DECISION_WEIGHTS, STOCK_EXECUTION_THRESHOLDS } from '../scoring/decisionScores.js';
import { buildCryptoDecisionScore, CRYPTO_DECISION_WEIGHTS, CRYPTO_MIN_FINAL_SCORE_TO_BUY } from '../scoring/componentScore.js';
import { cryptoBaselineInputs, cryptoBaselineTime } from './fixtures/cryptoScoringBaseline.js';
const expected = {
  complete: [92.8,95.6,90.7,1,1,[29.7,40.15,7.2,7.65,6],[]],
  missingFundamentals: [92.8,95.6,92.06,.92,1,[32.28,43.64,7.83,8.32,0],[]],
  lateMover: [92.8,95.6,90.7,1,1,[29.7,40.15,7.2,7.65,6],[]],
  missingNews: [92.8,95.6,90.7,1,1,[29.7,40.15,7.2,7.65,6],[]],
  sparse: [null,null,null,0,0,[0,0,0,0,0],['discoveryEvidence','canonicalDiscoveryExtensionEvidence','entryEvidence','approvedEntry','decisionCoverage']],
};
for (const [name, input] of Object.entries(scoringBaselineInputs)) test(`frozen baseline: ${name}`, () => {
  const c = buildStockDecisionScore(input);
  assert.deepEqual([c.discovery.score,c.entry.score,c.score,c.coverage,c.entry.coverage,
    c.components.map(x => x.contribution),c.missingCriticalEvidence], expected[name]);
  assert.equal(c.calculation.unroundedScore === null ? null : Number(c.calculation.unroundedScore.toFixed(2)), c.score);
  const measuredWeight = c.calculation.components.reduce((sum,x) => sum+x.measuredWeight,0);
  const configuredWeight = c.calculation.components.reduce((sum,x) => sum+x.weight,0);
  assert.equal(Number((measuredWeight/configuredWeight).toFixed(2)),c.coverage);
});
test('frozen thresholds and configured weights', () => {
  assert.deepEqual(STOCK_DECISION_WEIGHTS,{discovery:.32,entry:.42,marketContext:.09,riskPortfolio:.09,fundamentals:.08});
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore,70);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore,75);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryCoverage,.8);
});
const cryptoExpected={
  complete:[90.24,1,true,[40.5,37.74,0,12],[]],
  missingContext:[92.05,.85,true,[47.65,44.4,0,0],[]],
  staleSpread:[87.5,.6,false,[67.5,0,0,20],['freshLiveSpread','entryQuality','decisionCoverage']],
  zeroVolume:[77.44,1,false,[40.5,24.94,0,12],['minimumLiquidity']],
  missingNews:[90.24,1,true,[40.5,37.74,0,12],[]],
};
for(const [name,input] of Object.entries(cryptoBaselineInputs))test(`frozen crypto baseline: ${name}`,()=>{
  const c=buildCryptoDecisionScore(input,{now:cryptoBaselineTime});
  assert.deepEqual([c.score,c.coverage,c.coreEvidencePass,c.components.map(x=>x.contribution),c.missingCriticalEvidence],cryptoExpected[name]);
});
test('crypto analytical threshold stays uncalibrated and weights remain frozen',()=>{
  assert.equal(CRYPTO_MIN_FINAL_SCORE_TO_BUY,null);
  assert.deepEqual(CRYPTO_DECISION_WEIGHTS,{base:.45,execution:.4,runner:0,strategyEvolution:.15});
});
