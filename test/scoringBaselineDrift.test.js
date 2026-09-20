import test from 'node:test';
import assert from 'node:assert/strict';
import { scoringBaselineInputs } from './fixtures/scoringBaseline.js';
import { buildStockDecisionScore, STOCK_DECISION_WEIGHTS, STOCK_EXECUTION_THRESHOLDS } from '../scoring/decisionScores.js';
import { buildCryptoDecisionScore, CRYPTO_DECISION_WEIGHTS, CRYPTO_MIN_FINAL_SCORE_TO_BUY } from '../scoring/componentScore.js';
import { cryptoBaselineInputs, cryptoBaselineTime } from './fixtures/cryptoScoringBaseline.js';
const expected = {
  complete: [92.8,93.38,89.77,1,1,[29.7,39.22,7.2,7.65,6],[]],
  missingFundamentals: [92.8,93.38,83.77,.92,1,[29.69,39.22,7.2,7.65,0],[]],
  lateMover: [55,93.38,77.67,1,1,[17.6,39.22,7.2,7.65,6],[]],
  missingNews: [92.8,35,65.25,1,1,[29.7,14.7,7.2,7.65,6],['approvedEntry']],
  sparse: [0,0,0,0,0,[0,0,0,0,0],['discoveryEvidence','canonicalDiscoveryExtensionEvidence','entryEvidence','approvedEntry','decisionCoverage']],
};
for (const [name, input] of Object.entries(scoringBaselineInputs)) test(`frozen baseline: ${name}`, () => {
  const c = buildStockDecisionScore(input);
  assert.deepEqual([c.discovery.score,c.entry.score,c.score,c.coverage,c.entry.coverage,
    c.components.map(x => x.contribution),c.missingCriticalEvidence], expected[name]);
  assert.equal(Number(Math.min(100,Math.max(0,c.calculation.components.reduce((sum,x) => sum+x.contribution,0))).toFixed(2)), c.score);
  assert.equal(Number((c.availableScoringWeight/c.totalConfiguredWeight).toFixed(2)),c.coverage);
});
test('frozen thresholds and configured weights', () => {
  assert.deepEqual(STOCK_DECISION_WEIGHTS,{discovery:.32,entry:.42,marketContext:.09,riskPortfolio:.09,fundamentals:.08});
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore,78);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryScore,75);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.entryCoverage,.8);
});
const cryptoExpected={
  complete:[90.24,1,true,[40.5,37.74,0,12],[]],
  missingContext:[78.24,.85,true,[40.5,37.74,0,0],[]],
  staleSpread:[52.5,.6,false,[40.5,0,0,12],['freshLiveSpread','entryQuality','decisionCoverage']],
  zeroVolume:[52.5,.6,false,[40.5,0,0,12],['liquidity','minimumLiquidity','entryQuality','decisionCoverage']],
  missingNews:[90.24,1,false,[40.5,37.74,0,12],['newsRiskCoverage']],
};
for(const [name,input] of Object.entries(cryptoBaselineInputs))test(`frozen crypto baseline: ${name}`,()=>{
  const c=buildCryptoDecisionScore(input,{now:cryptoBaselineTime});
  assert.deepEqual([c.score,c.coverage,c.coreEvidencePass,c.components.map(x=>x.contribution),c.missingCriticalEvidence],cryptoExpected[name]);
});
test('crypto thresholds and weights remain frozen',()=>{
  assert.equal(CRYPTO_MIN_FINAL_SCORE_TO_BUY,65);
  assert.deepEqual(CRYPTO_DECISION_WEIGHTS,{base:.45,execution:.4,runner:0,strategyEvolution:.15});
});
