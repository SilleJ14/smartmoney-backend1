import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evidencePolicy, purchasePolicy, executionEvidenceIssues, researchExecutionIssues } from '../risk/evidencePolicy.js';
import { getLiveQuoteTimestampMs } from '../live/liveQuoteCache.js';
import { createDecisionSnapshot, canPublishDecision } from '../scoring/decisionProvenance.js';
import { barSnapshot } from '../market-data/barSnapshot.js';
import { recentBarVolumeEvidence } from '../market-data/volumeEvidence.js';
import { createPipelineLatency } from '../analytics/pipelineLatency.js';
import { createCandidateTraceStore } from '../discovery/candidateTraceStore.js';
import { createOrderRiskReservations } from '../risk/orderRiskReservations.js';
import { createSafetyJournal, readSafetyJournal } from '../state/safetyJournal.js';
import { createOrderService } from '../execution/orderService.js';
import { scoringBaselineInputs } from './fixtures/scoringBaseline.js';
import { buildStockDecisionScore } from '../scoring/decisionScores.js';
import { evaluateScaleInEvidence } from '../risk/scaleInEvidence.js';
import { installCentralDecision } from '../scoring/installCentralDecision.js';

test('all asset/stage/purchase policies exist and manual has only enumerated exemptions', () => {
  for (const asset of ['stock','crypto']) for (const stage of ['discovery','entry','final','order']) for (const purchase of ['manual','automatic','scale_in']) {
    assert.equal(evidencePolicy(asset,stage,purchase).purchaseType,purchase);
  }
  const manual = purchasePolicy({automated:false});
  assert.deepEqual(manual.exemptions,['AI_SCORE','AI_ENTRY_TRIGGER','AUTOPILOT_ENABLED','AI_APPROVED_SIZE','BOT_ALLOCATION_CAP']);
  assert.equal(manual.evidence.safetyLocks,'AUTHORIZATION_ONLY');
  assert.equal(manual.evidence.account,'AUTHORIZATION_ONLY');
  assert.equal(purchasePolicy({automated:false,requireCandidateDecision:true}).requireStrategy,true);
  assert.throws(()=>evidencePolicy('unknown','order','manual'));
});
test('fresh price cannot hide an undated, stale or incoherent spread', () => {
  const now=100000, policy=evidencePolicy('stock','order','automatic');
  assert.deepEqual(executionEvidenceIssues({priceAt:now,spreadAt:now-100,now,policy}),[]);
  assert.ok(executionEvidenceIssues({priceAt:now,spreadAt:null,now,policy}).includes('SPREAD_TIMESTAMP_MISSING'));
  assert.ok(executionEvidenceIssues({priceAt:now,spreadAt:now-6000,now,policy}).includes('SPREAD_EVIDENCE_STALE'));
  assert.ok(executionEvidenceIssues({priceAt:now+5000,spreadAt:now-6000,now,policy}).includes('EVIDENCE_SKEW_EXCEEDED'));
});
test('snapshots detach and freeze evidence and whitelist configuration', () => {
  const source={price:10,technicals:{ema9:9},chartBars:[{c:10}]};
  const snap=createDecisionSnapshot(source,{minStockPrice:.5,ALPACA_LIVE_KEY:'never-copy'});
  source.chartBars[0].c=900;
  assert.equal(snap.input.chartBars[0].c,10);
  assert.throws(()=>{snap.input.technicals.ema9=0});
  assert.ok(!JSON.stringify(snap).includes('never-copy'));
  assert.equal(canPublishDecision({decisionRevision:52},{decisionRevision:51}),false);
  assert.equal(canPublishDecision({decisionRevision:52},{decisionRevision:52}),false);
  assert.equal(canPublishDecision({decisionRevision:52},{decisionRevision:53}),true);
  const published = {symbol:'AAPL',decisionRevision:52,stockDecisionScore:80};
  installCentralDecision(published,{decisionRevision:51,finalDecisionScore:99});
  assert.equal(published.decisionRevision,52);
  assert.equal(published.stockDecisionScore,80);
});
test('technical dependency mismatch blocks qualification, not silently using old indicators', () => {
  const input=structuredClone(scoringBaselineInputs.complete);
  input.barSnapshotId='new'; input.technicals.barSnapshotId='old';
  const snap=createDecisionSnapshot(input);
  const scored=buildStockDecisionScore(snap.input);
  assert.equal(scored.coreEvidencePass,false);
  assert.ok(scored.missingCriticalEvidence.includes('TECHNICAL_BAR_SNAPSHOT_MISMATCH'));
});
test('bar identity is ordered, missing dates stay missing, malformed data is unavailable', () => {
  assert.equal(barSnapshot(null).available,false);
  assert.equal(barSnapshot([null]).available,false);
  assert.equal(barSnapshot([{c:10,t:2000},{c:11,t:1000}]).reason,'BAR_SEQUENCE_INVALID');
  assert.equal(barSnapshot([{c:10}]).lastProviderAt,null);
  assert.equal(barSnapshot([{c:10,t:1000},{c:11}]).lastProviderAt,null);
  assert.notEqual(barSnapshot([{c:10}]).id,barSnapshot([{c:11}]).id);
  assert.equal(recentBarVolumeEvidence({}).available,false);
  assert.equal(recentBarVolumeEvidence([null]).available,false);
  const bars=Array.from({length:7},()=>({v:100,volume:100}));
  bars[6]={v:0,volume:100};
  assert.equal(recentBarVolumeEvidence(bars).available,false);
  bars[6]={v:0,volume:0};
  assert.equal(recentBarVolumeEvidence(bars).ratio,0);
});

test('crypto setup provenance cannot claim to come from replacement bars', () => {
  const bars=[{c:10,t:1000},{c:11,t:1060}];
  const input={symbol:'BTC/USD',chartBars:bars,cryptoSetup:{available:true,eligible:true,inputBarSnapshotId:barSnapshot(bars).id}};
  assert.deepEqual(createDecisionSnapshot(input).input.evidenceCoherence.issues,[]);
  input.chartBars[1].c=20;
  const snapshot=createDecisionSnapshot(input);
  assert.equal(snapshot.input.cryptoSetup.eligible,false);
  assert.deepEqual(snapshot.input.evidenceCoherence.issues,['CRYPTO_SETUP_BAR_SNAPSHOT_MISMATCH']);
});
test('bounded asset-separated latency is diagnostic only', () => {
  const latency=createPipelineLatency(16);
  for(let i=0;i<100;i++)latency.observe('stock','calculationMs',i);
  latency.observe('crypto','calculationMs',5);
  latency.observe('crypto','calculationMs',NaN);
  assert.equal(latency.summary()['stock:calculationMs'].sampleCount,16);
  assert.equal(latency.summary()['crypto:calculationMs'].p95,5);
});
test('persistence failures expose degraded diagnostics without rejecting the engine promise', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sm-integrity-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'not-a-directory');fs.writeFileSync(file,'occupied');
  const trace=createCandidateTraceStore(file);
  trace.record({symbol:'AAPL',stage:'TEST'});await trace.flush();
  assert.equal(trace.status().diagnosticsStatus,'DIAGNOSTICS_DEGRADED');
  assert.equal(trace.status().tracePersistenceFailures,1);
  assert.ok(trace.status().firstLossAt);
});
test('intent plus reservation survives restart; regressions in fills cannot release exposure', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sm-intent-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,'safety.json');
  const state={liveTradeLimitState:{intradayStockEntriesToday:0,dateKey:'2026-09-19'}};
  const store=createOrderRiskReservations({state,persist:createSafetyJournal(file,state),normalizeSymbol:String});
  store.reserve({client_order_id:'same-id',symbol:'AAPL',side:'buy'}, {riskNotional:25,riskReferencePrice:5,holdCategory:'intraday',automated:false});
  const saved=readSafetyJournal(file), entry=saved.orderRiskReservations['same-id'];
  assert.equal(entry.status,'submitting');assert.equal(entry.origin,'MANUAL');
  assert.equal(entry.entryPolicy,'MANUAL_V1'); assert.equal(entry.managementPolicy,'AI_MANAGED_V1');
  assert.equal(entry.clientOrderId,entry.reservationId);
  entry.filledQty=2;
  const restarted=createOrderRiskReservations({state:saved,persist(){},normalizeSymbol:String,
    lookupOrder:async()=>({symbol:'AAPL',status:'canceled',filled_qty:'0'})});
  await restarted.reconcile([]);
  assert.equal(entry.filledQty,2);assert.notEqual(entry.released,true);
  assert.throws(()=>restarted.reserve({client_order_id:'same-id',symbol:'AAPL'},{}),/Duplicate/);
});
test('manual confirmation keeps identity and never rounds above confirmed dollars', async () => {
  const requests=[];
  const service=createOrderService({normalizeSymbol:String,tradingRequest:async(_,r)=>{requests.push(JSON.parse(r.body));return {id:'mock'}}});
  const confirmed={symbol:'AAPL',dollars:20.126,buyMode:'dollars',fractionable:true,marketOpen:true,holdCategory:'intraday',confirmationId:'12345678-1234-1234-1234-123456789abc'};
  await service.manualStockBuy(confirmed);await service.manualStockBuy(confirmed);
  assert.equal(requests[0].client_order_id,requests[1].client_order_id);
  assert.ok(requests[0].notional<=confirmed.dollars);
  await service.manualStockBuy({...confirmed,fractionable:false,referencePrice:7});
  assert.equal(requests[2].type,'limit');
  assert.ok(Number(requests[2].qty)*Number(requests[2].limit_price)<=confirmed.dollars);
});
test('scale-in requires reconciled quantity, protection and no unresolved buy, and reports combined exposure',()=>{
  const now=Date.now();
  const input={symbol:'AAPL',positions:[{symbol:'AAPL',qty:'3',avg_entry_price:'9'}],price:10,notional:20,
    protection:{ok:true,checkedAt:new Date(now).toISOString()},now};
  assert.equal(evaluateScaleInEvidence(input).resultingExposure,50);
  assert.equal(evaluateScaleInEvidence(input).approved,true);
  assert.equal(evaluateScaleInEvidence({...input,protection:{ok:false}}).approved,false);
  assert.equal(evaluateScaleInEvidence({...input,reservations:{id:{symbol:'AAPL',status:'uncertain'}}}).approved,false);
  assert.equal(evaluateScaleInEvidence({...input,positions:[{symbol:'AAPL',qty:null}]}).approved,false);
});
test('provider time, never receipt time, determines ordering and age in the actual server helper',()=>{
  const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const start=source.indexOf('function getProviderQuoteTimestampMs('), end=source.indexOf('function getActiveCandidateQuoteRefreshSymbols(',start);
  const read=new Function('getLiveQuoteTimestampMs',source.slice(start,end)+'; return getProviderQuoteTimestampMs;')(getLiveQuoteTimestampMs);
  const now=Date.now(), old=new Date(now-60000).toISOString(), receipt=new Date(now).toISOString();
  assert.equal(read({liveQuoteUpdatedAt:old,quoteFetchedAt:receipt,updatedAt:receipt}),now-60000);
  assert.equal(read({quoteFetchedAt:receipt,updatedAt:receipt}),null);
});
test('execution coherency uses completed-bar intervals while manual bypasses AI technicals',()=>{
  const at=Date.parse('2026-09-19T16:00:00Z');
  const s={liveQuoteUpdatedAt:new Date(at).toISOString(),decisionProvenance:{evidencePolicyVersion:'EVIDENCE_V1'},
    technicals:{lastBarAt:new Date(at-300000).toISOString(),intervalMs:300000}};
  const policy=evidencePolicy('stock','order','automatic');
  assert.deepEqual(researchExecutionIssues(s,policy),[]);
  assert.deepEqual(researchExecutionIssues({...s,liveQuoteUpdatedAt:new Date(at+900000).toISOString()},policy),['PRICE_TECHNICAL_SKEW_EXCEEDED']);
  assert.deepEqual(researchExecutionIssues({...s,technicals:{}},policy),['TECHNICAL_EXECUTION_TIME_UNAVAILABLE']);
  assert.deepEqual(researchExecutionIssues({...s,technicals:{}},evidencePolicy('stock','order','manual')),[]);
});
