import test from 'node:test';
import assert from 'node:assert/strict';
import { assessContinuationSetup } from '../scoring/continuationSetup.js';
import { classifyStockDiscoveryLane } from '../discovery/stockDiscoveryLanes.js';
import { buildStockDecisionScore } from '../scoring/decisionScores.js';
function fixture() {
  const now = Date.now();
  const chartBars = Array.from({ length: 20 }, (_, i) => ({ t: now - (20 - i) * 300000,
    o: 99, h: 104, l: 97, c: 100, v: 1000 }));
  chartBars.splice(-3, 3,
    { t: now - 900000, o: 99.5, h: 100, l: 99, c: 99.8, v: 2000 },
    { t: now - 600000, o: 99.8, h: 100.2, l: 99.4, c: 100, v: 2000 },
    { t: now - 300000, o: 100, h: 101.2, l: 99.8, c: 101, v: 2000 });
  return { symbol: 'RUN', chartBars, price: 101, percentChange: 49, volume: 1000000 };
}
test('an already-rising stock can earn a measured continuation lane, not automatic approval', () => {
  const row = fixture(), setup = assessContinuationSetup(row);
  assert.equal(setup.eligible, true); assert.equal(setup.observedTarget, 104);
  assert.equal(setup.structuralStop, 99); assert.equal(setup.rewardRisk, 1.5);
  const lane = classifyStockDiscoveryLane(row); assert.equal(lane.lane, 'MEASURED_CONTINUATION');
  const evidence = buildStockDecisionScore({ ...row, discoveryLane: lane.lane,
    discoveryScorecard: { score: 55, coverage: 1, canonicalExtensionEvidencePass: true },
    entryQualityScorecard: { score: 80, coverage: 1, approved: true }, contextScore: 80, riskPortfolioScore: 80 });
  assert.equal(evidence.opportunityBasis, 'MEASURED_CONTINUATION');
  assert.equal(evidence.discovery.score, 55, 'late discovery must not be relabeled early');
  assert.equal(evidence.components.find(c => c.name === 'discovery').source, 'measured_continuation_setup');
});
test('large daily gain alone, exhaustion, missing or stale bars cannot establish continuation', () => {
  assert.equal(assessContinuationSetup({ price: 100, percentChange: 88 }).available, false);
  const row = fixture(); assert.equal(assessContinuationSetup({ ...row, price: 105 }).eligible, false);
  assert.equal(assessContinuationSetup({ ...row, chartBars: row.chartBars.map(b => ({ ...b, v: 100 })) }).eligible, false);
  assert.equal(assessContinuationSetup(row, { now: Date.now() + 3600000 }).available, false);
  row.chartBars[3].t = Date.now() + 60000;
  assert.equal(assessContinuationSetup(row).available, false);
});
