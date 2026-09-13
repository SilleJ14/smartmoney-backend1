import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateDiagnostics, summarizeCandidateDiagnostics } from '../scoring/candidateDiagnostics.js';
import { compactCandidateTrace } from '../discovery/candidateTraceStore.js';
const signal = { symbol:'BTC/USD', cryptoDecisionScore:70, cryptoDecisionScoreAvailable:true };
test('missing optional points are distinct from measured weakness without increasing F', () => {
  const before = JSON.stringify(signal);
  const d = candidateDiagnostics(signal, { components:[
    {name:'base',weight:.45,available:true,value:80,contribution:36},
    {name:'context',weight:.15,available:false,value:0,contribution:0},
  ] }, {approved:false,reasons:['POSITION_SIZING_PENDING']});
  assert.equal(d.currentFinal,70);assert.equal(d.missingEvidencePoints,15);assert.equal(d.measuredShortfallPoints,9);
  assert.equal(d.status,'WAITING_FOR_ENTRY_OR_RISK_APPROVAL');assert.equal(JSON.stringify(signal),before);
});
test('stale execution is not presented as low quality and missing F is not zero', () => {
  assert.equal(candidateDiagnostics(signal,{}, {reasons:['SPREAD_STALE']}).status,'WAITING_FOR_FRESH_DATA');
  const d = candidateDiagnostics({...signal,cryptoDecisionScoreAvailable:false},{},{reasons:['barHistory']});
  assert.equal(d.currentFinal,null); assert.equal(d.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(candidateDiagnostics({...signal,cryptoDecisionScore:64},{},{reasons:[]}).status,'BELOW_SCORE_THRESHOLD');
});
test('summary counts blockers once per candidate and trace preserves crypto D/E', () => {
  const d = candidateDiagnostics(signal,{}, {reasons:['SPREAD_STALE','SPREAD_STALE']});
  assert.equal(summarizeCandidateDiagnostics([{symbol:'BTC/USD',currentDecision:{diagnostics:d}}]).blockers.SPREAD_STALE,1);
  const row = compactCandidateTrace({...signal,cryptoDiscoveryScore:71,cryptoEntryScore:73});
  assert.equal(row.discovery,71);assert.equal(row.entry,73);
});
