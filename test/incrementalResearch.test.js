import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { createIncrementalResearch, canReuseResearch, needsCandidateResearch, incrementalResearchForState } from '../discovery/incrementalResearch.js';
import { createEarlyCandidateReassessment } from '../discovery/earlyCandidateReassessment.js';

const start = Date.parse('2026-09-11T15:01:00Z');
const candidate = (symbol, at = start) => ({ symbol, chartBars: Array(24).fill({ close: 10 }),
  researchEvidenceAt: new Date(at).toISOString(), centralAutonomousDecisionCore: { action: 'WATCH' } });

test('research expires on age, candle boundary, invalid setup and missing evidence', () => {
  const row = candidate('AAPL');
  assert.equal(canReuseResearch(row, start), true);
  assert.equal(canReuseResearch(row, start + 120000), false);
  assert.equal(canReuseResearch(row, start - 1), false);
  assert.equal(canReuseResearch(candidate('AAPL', start + 239000), start + 240000), false);
  for (const patch of [{ chartBars: [] }, { centralAutonomousDecisionCore: null }, { rawEarlyMover: true }, { setupRevalidationRequired: true }]) {
    assert.equal(needsCandidateResearch({ ...row, ...patch }, start), true);
  }
});

test('bounded fair batches serve stocks AND crypto with per-symbol revisit limit', () => {
  let now = start; const output = [];
  const worker = createIncrementalResearch({ now: () => now, capacity: 6, batchSize: 4,
    review: row => row, publish: rows => output.push(rows.map(row => row.symbol)) });
  const rows = ['AAPL', 'MSFT', 'BTC/USD', 'ETH/USD', 'SOL/USD', 'GDS'].map(s => candidate(s));
  assert.equal(worker.run(rows).reviewed, 4);
  assert.equal(worker.run(rows).reviewed, 2);
  assert.equal(worker.run(rows).skipped, true);
  now += 5000; assert.equal(worker.run(rows).reviewed, 4);
  assert.deepEqual(output[0], ['AAPL', 'MSFT', 'BTC/USD', 'ETH/USD']);
  assert.equal(worker.getStatus().tracked, 6);
});

test('quick research neither mutates its inputs nor grants approval or refreshes evidence timestamps', () => {
  let result;
  const row = { ...candidate('BTC/USD'), liveQuoteUpdatedAt: 'provider-timestamp' };
  const worker = createIncrementalResearch({ now: () => start + 5000,
    review: input => { input.centralAutonomousDecisionCore.action = 'ALLOW'; return { ...input,
      approved: true, finalApprovedTradeAmount: 100, starterBuyApproved: true }; }, publish: rows => { result = rows[0]; } });
  worker.run([row]);
  assert.equal(row.centralAutonomousDecisionCore.action, 'WATCH');
  assert.equal(result.approved, false); assert.equal(result.executionEligibility.approved, false);
  assert.equal(result.starterBuyApproved, false); assert.equal(result.finalApprovedTradeAmount, 0);
  assert.equal(result.researchEvidenceAt, row.researchEvidenceAt);
  assert.equal(result.liveQuoteUpdatedAt, 'provider-timestamp');
  assert.equal(canReuseResearch(result, start + 120000), false);
});

test('new full research and approved canonical candidates supersede research overlays', () => {
  const row = candidate('AAPL');
  const state = { incrementalResearchSignals: [row], lastStockSignals: [candidate('AAPL', start + 1)] };
  assert.equal(incrementalResearchForState(state, start + 2).length, 0);
  state.lastStockSignals = [{ ...row, approved: true }];
  assert.equal(incrementalResearchForState(state, start + 2).length, 0);
  let published = false;
  const worker = createIncrementalResearch({ now: () => start, review: r => r, publish: () => { published = true; } });
  worker.run([row, ...state.lastStockSignals]); assert.equal(published, false);
});

test('failures are contained and memory pressure pauses work', () => {
  let allowed = false;
  const worker = createIncrementalResearch({ now: () => start, canRun: () => allowed,
    review: () => { throw new Error('bad evidence'); }, publish: () => assert.fail() });
  assert.equal(worker.run([candidate('AAPL')]).skipped, true);
  allowed = true; assert.equal(worker.run([candidate('AAPL')]).failed, true);
  assert.equal(worker.getStatus().failures, 1); assert.equal(worker.getStatus().running, false);
});

test('cold research cadence is throttled independently of a one-second scheduler', async () => {
  let now = start, calls = 0;
  const worker = createEarlyCandidateReassessment({ now: () => now, minStartIntervalMs: 2500,
    analyze: async symbols => { calls++; return symbols.map(symbol => ({ symbol })); }, publish: () => {} });
  await worker.run(['A', 'B', 'C', 'D']); now += 1000;
  assert.equal((await worker.run()).skipped, true); now += 2000;
  assert.equal((await worker.run()).reviewed, 2); assert.equal(calls, 2);
});

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
test('research superseded by a full scan is requeued, not locked out for a minute', async () => {
  let publish = false, calls = 0;
  const worker = createEarlyCandidateReassessment({ now: () => start, retryMs: 60000,
    analyze: async symbols => { calls++; return symbols.map(symbol => ({ symbol })); }, publish: () => publish });
  assert.equal((await worker.run(['AAPL'])).superseded, true);
  publish = true; assert.equal((await worker.run()).scored, 1); assert.equal(calls, 2);
});
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declaration = tree.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'incrementalResearch'));
function actualWorker({ invalidSetup = false } = {}) {
  const engineState = { running: true, marketOpen: true };
  let centralCalls = 0, pushes = 0;
  const context = vm.createContext({ engineState, createIncrementalResearch: options => createIncrementalResearch({ ...options, now: () => start }),
    incrementalResearchForState: state => incrementalResearchForState(state, start),
    buildMemoryGuardSnapshot: () => ({ shouldPauseHeavyWork: false }), isCrypto: s => s.includes('/'),
    canRefreshStockQuotes: () => true, getMarketSession: () => 'regular', normalizeSymbol: s => s,
    mergeLiveQuoteIntoSignal: row => ({ ...row, setupRevalidationRequired: invalidSetup }),
    calculateCentralAutonomousDecisionCore: (stocks, crypto) => { centralCalls++; return { rankedDecisions: [...stocks, ...crypto].map(r => ({ symbol: r.symbol })) }; },
    installCentralDecision: row => { row.masterFinalScore = 65; }, normalizeSignalScoreCompleteness: row => row,
    pushLiveSignalUpdate: () => { pushes++; }, buildLiveSignalPushPayload: () => ({}) });
  vm.runInContext(source.slice(declaration.start, declaration.end) + '; globalThis.worker = incrementalResearch;', context);
  return { context, engineState, calls: () => centralCalls, pushes: () => pushes };
}

test('actual server warm path runs during full scan, publishes both classes, and never touches full-scan arrays', () => {
  const { context, engineState, calls, pushes } = actualWorker();
  assert.equal(context.worker.run([candidate('AAPL'), candidate('BTC/USD')]).reviewed, 2);
  assert.equal(calls(), 2); assert.equal(pushes(), 1);
  assert.equal(engineState.incrementalResearchSignals.length, 2);
  assert.equal(engineState.lastStockSignals, undefined); assert.equal(engineState.lastCryptoSignals, undefined);
  assert.ok(engineState.incrementalResearchSignals.every(r => r.masterFinalScore === 65 && r.approved === false));
});

test('actual quick path does not reset an invalidated entry setup through central install', () => {
  const { context, calls } = actualWorker({ invalidSetup: true });
  context.worker.run([candidate('BTC/USD')]); assert.equal(calls(), 0);
});
