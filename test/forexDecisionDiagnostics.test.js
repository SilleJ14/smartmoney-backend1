import test from 'node:test';
import assert from 'node:assert/strict';
import { forexDecisionDiagnostics, blockForexCandidates } from '../forex/decisionDiagnostics.js';
import { selectForexSignals, runForexEngineCycle } from '../forex/forexEngine.js';

test('diagnostics retain every strategy direction and count reasons once per pair', () => {
  const row = { instrument:'EUR_USD', state:'BLOCKED', lastReason:'ENTRY_EXPIRED', blockers:['STALE_PRICE'] };
  const d = forexDecisionDiagnostics({candidates:[{...row,side:'buy'},{...row,side:'sell'}],signals:[]}, ['EUR_USD','USD_JPY']);
  assert.equal(d.pairs[0].evaluations.length,2);
  assert.equal(d.reasonCounts.STALE_PRICE,1);
  assert.equal(d.pairs[1].outcome,'NOT_EVALUATED');
  assert.deepEqual(d.pairs[1].blockers,['NO_EVALUATION']);
});
test('missing credentials explain every unscanned pair', async () => {
  const s=await runForexEngineCycle({client:{token:''},forexAutoEnabled:true});
  assert.ok(s.decisionDiagnostics.pairs.length);
  assert.ok(s.decisionDiagnostics.pairs.every(p=>p.blockers.includes('MISSING_CREDENTIALS')));
});
test('account gate revokes ready rows but preserves strategy state and reasons', () => {
  const rows=[{state:'EXECUTION_ELIGIBLE',strategyState:'WATCHING',executionAuthorization:'PRACTICE',blockers:[]}];
  blockForexCandidates(rows,['OPEN_RISK_UNKNOWN']);
  assert.equal(rows[0].state,'BLOCKED');
  assert.equal(rows[0].strategyState,'WATCHING');
  assert.equal(rows[0].executionAuthorization,'None');
  assert.deepEqual(rows[0].blockers,['OPEN_RISK_UNKNOWN']);
});
test('triggered rejection is not hidden by a generic discovered strategy', () => {
  const source = row => ({instrument:'EUR_USD',identity:'x',quote:{},result:{},row});
  const sources=[source({state:'DISCOVERED',lastReason:'TREND_FAIL'}),source({state:'BLOCKED',confirmedAt:'2026-09-23T14:00:00Z',lastReason:'STALE_PRICE'})];
  assert.equal(selectForexSignals(sources,new Map(),{})[0].reason,'STALE_PRICE');
  sources.push(source({state:'EXECUTION_ELIGIBLE',lastReason:'ENTRY_TRIGGER'}));
  assert.equal(selectForexSignals(sources,new Map(),{})[0].forexState,'ready');
});
test('submitted order is not mislabeled as a new watch opportunity', () => {
  const sources=[{instrument:'EUR_USD',identity:'x',quote:{},result:{},row:{state:'ORDER_INTENT_CREATED',lastReason:'FILLED'}}];
  assert.equal(selectForexSignals(sources,new Map(),{})[0].forexState,'ordered');
});
