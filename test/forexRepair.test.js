import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runForexEngineCycle } from "../forex/forexEngine.js";
import { FOREX_SPEC } from "../forex/forexSpec.js";
import { createMemoryStore, createFileStore, compactForexLedger, emptyLedger } from "../forex/durableStore.js";
import { ingestTransactions } from "../forex/fills.js";
import { refreshExecutionPlan } from "../forex/executionEvidence.js";
import { canOpenRisk, FOREX_RISK_LIMITS } from "../forex/riskManager.js";
import { createApprovalRegistry, automaticEntryPermission, mayAutoExecute, STRATEGY_IDS } from "../forex/approvalRegistry.js";
import { createExecutionCoordinator } from "../forex/executionCoordinator.js";
import { inspectCandles } from "../forex/candleIntegrity.js";
import { createForexScheduler } from "../forex/scheduler.js";
import { registerOperationalControlRoutes } from "../routes/operationalControlRoutes.js";
import { manageForexPositions } from "../forex/positionManager.js";
import { lossConversion } from "../forex/instrumentSpecs.js";
import { candlesKnownAt } from "../forex/replay.js";
import { canonicalAccountId } from "../forex/identity.js";
import { evaluateTrendContinuation } from "../forex/strategies/trendContinuation.js";

const now = Date.parse("2026-09-23T14:00:30Z");
const bar = (t, o=1.1,h=1.101,l=1.099,c=1.1) => ({ t:new Date(t).toISOString(),o,h,l,c,complete:true });
const registry = () => createApprovalRegistry({ FOREX_BREAKOUT_RETEST_V1: { permittedEnvironment:"FORWARD_PRACTICE" } });
const calendar = { coverageComplete:true,refreshedAt:new Date(now).toISOString(),events:[] };

for (const stage of ['fetch', 'commit']) test(`new calendar restriction during ${stage} prevents order submission`, async()=>{
  const f=await fixture();let latest=calendar;
  const restricted={...calendar,events:[{currency:'USD',type:'FOMC central bank decision',start:new Date(now).toISOString()}]};
  if(stage==='fetch'){
    const original=f.client.getPrices;f.client.getPrices=async names=>{latest=restricted;return original(names)};
  }else{
    const original=f.store.commit.bind(f.store);f.store.commit=async mutate=>{const result=await original(mutate);latest=restricted;return result};
  }
  const c=createExecutionCoordinator({adapter:f.client,store:f.store,registry:createApprovalRegistry(),nowFn:()=>now,
    getAutoEnabled:()=>true,getEntryPause:()=>false,getCalendar:()=>latest});
  const result=await c.submit({intent:'automatic',environment:'FORWARD_PRACTICE',practiceOrdersEnabled:true,
    executionReady:true,autoTradingAuthorized:true,strategyId:STRATEGY_IDS.CONTINUATION,accountId:'a',instrumentId:'EUR_USD',
    units:10,currentUnits:0,stop:1.0995,takeProfitOnFill:'1.10242',A:.002,
    confirmedAt:new Date(now).toISOString(),confirmationPrice:1.1004,calendar,clientRequestId:`calendar-${stage}`});
  assert.equal(f.orders,0);assert.equal(result.state,'BLOCKED');
});

async function fixture() {
  const store=createMemoryStore({treatAsDurable:true});
  let time=now, orders=0, auto=true, pause=false;
  const close=Math.floor(now/900000)*900000;
  const identity=canonicalAccountId({environment:"practice",broker:"oanda",accountId:"a",assetClass:"forex",instrumentId:"EUR_USD"});
  await store.commit(l=>{l.candidates=[{identity,strategyId:"FOREX_BREAKOUT_RETEST_V1",side:"buy",state:"WATCHING",firstSeenAt:new Date(now-3600000).toISOString(),setupAnchor:new Date(close-2700000).toISOString(),frozen:{H:1.1,L:1.098,A:.002,side:"buy",rangeEnd:new Date(close-2700000).toISOString()}}];});
  const prices=names=>({prices:names.map(instrument=>({instrument,time:new Date(time).toISOString(),bids:[{price:"1.10040"}],asks:[{price:"1.10041"}],tradeable:true})),homeConversions:[{currency:"USD",accountLoss:"1"}]});
  const client={token:"mock",accountId:"a",liveHost:false,
    async getAccount(){return {account:{id:"a",NAV:"1000",balance:"1000",currency:"USD",lastTransactionID:"1",marginAvailable:"1000",marginUsed:"0"}}},
    async getOpenTrades(){return {trades:[]}},async getPendingOrders(){return {orders:[]}},async getTransactionsSince(){return {transactions:[]}},
    async getInstruments(){return {instruments:[{name:"EUR_USD",displayPrecision:5,tradeUnitsPrecision:0,minimumTradeSize:1,marginRate:.02}]}},
    async getPrices(names){return prices(names)},
    async getCandles(_instrument,{granularity}){
      const period={H4:14400000,H1:3600000,M15:900000}[granularity];
      const end=Math.floor(now/period)*period;
      // 23 H1 bars supply ATR + range; three H4 bars intentionally neutral (no opposing trend).
      const count={H4:3,H1:30,M15:20}[granularity];
      const rows=Array.from({length:count},(_,i)=>bar(end-(count-i)*period));
      if(granularity==="M15") rows.splice(-3,3,
        bar(close-2700000,1.10005,1.10035,1.09995,1.10030),
        bar(close-1800000,1.10015,1.10020,1.10000,1.10010),
        bar(close-900000,1.10010,1.10045,1.10010,1.10040));
      return {candles:rows.map(r=>({time:r.t,complete:true,mid:{o:r.o,h:r.h,l:r.l,c:r.c}}))};
    },
    async createMarketOrder(order){orders++;return {orderFillTransaction:{id:"2",type:"ORDER_FILL",orderID:"2",units:String(order.units),instrument:order.instrument,time:new Date(time).toISOString(),tradeOpened:{tradeID:"t",units:String(order.units),price:"1.10041"}}}},
  };
  return {client,store,get orders(){return orders},setAuto(v){auto=v},setPause(v){pause=v},setTime(v){time=v},
    run:(options={})=>runForexEngineCycle({client,store,now,clockNow:()=>time,forexAutoEnabled:auto,getAutoEnabled:()=>auto,getEntryPause:()=>pause,calendar,registry:registry(),spec:{...FOREX_SPEC,scanInstruments:["EUR_USD"]},...options})};
}

test("operator Autopilot permission does not fabricate strategy validation or enable breakout/live",()=>{
  const r=createApprovalRegistry();const before=JSON.stringify(r);
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.CONTINUATION,{autopilotEnabled:true}).allowed,true);
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.CONTINUATION,{autopilotEnabled:false}).allowed,false);
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.BREAKOUT,{autopilotEnabled:true}).allowed,false);
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.MANUAL,{autopilotEnabled:true}).allowed,false);
  assert.equal(automaticEntryPermission(r,'unknown',{autopilotEnabled:true}).allowed,false);
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.CONTINUATION,{autopilotEnabled:true,environment:'LIVE'}).allowed,false);
  assert.equal(mayAutoExecute(r,STRATEGY_IDS.CONTINUATION),false);
  assert.equal(JSON.stringify(r),before);
  r[STRATEGY_IDS.CONTINUATION].disabled=true;
  assert.equal(automaticEntryPermission(r,STRATEGY_IDS.CONTINUATION,{autopilotEnabled:true}).reason,'STRATEGY_DISABLED');
  for(const key of ['plannedRiskPerTradePercent','openPlusPendingPercent','sameDirectionCurrencyPercent','dailyLossTriggerPercent','drawdownPausePercent'])assert.equal(FOREX_RISK_LIMITS[key],10);
});

test("scanner exposes operator permission but keeps unapproved breakout out of execution",async()=>{
  const f=await fixture();const result=await f.run({registry:createApprovalRegistry()});
  assert.equal(f.orders,0);
  assert.ok(result.candidates.filter(c=>c.strategyId===STRATEGY_IDS.BREAKOUT).every(c=>c.blockers.includes('STRATEGY_NOT_APPROVED')));
  assert.ok(result.candidates.filter(c=>c.strategyId===STRATEGY_IDS.CONTINUATION).every(c=>c.entryPermission.allowed));
});

for(const condition of ['ON','OFF','STOP','STALE','NO_CALENDAR','LOSS_LOCK'])test(`continuation with operator permission and real mocked preflight: ${condition}`,async()=>{
  const f=await fixture();
  await f.store.commit(l=>{l.dayStart.a={adjustedEquity:condition==='LOSS_LOCK'?1200:1000};l.peakEquity.a=1000});
  if(condition==='STALE'){
    const original=f.client.getPrices;f.client.getPrices=async names=>{const p=await original(names);p.prices[0].time=new Date(now-10000).toISOString();return p};
  }
  const coordinator=createExecutionCoordinator({adapter:f.client,store:f.store,registry:createApprovalRegistry(),nowFn:()=>now,
    getAutoEnabled:()=>condition!=='OFF',getEntryPause:()=>condition==='STOP'});
  const result=await coordinator.submit({intent:'automatic',environment:'FORWARD_PRACTICE',practiceOrdersEnabled:true,
    executionReady:true,autoTradingAuthorized:true,strategyId:STRATEGY_IDS.CONTINUATION,accountId:'a',instrumentId:'EUR_USD',
    units:10,currentUnits:0,stop:1.0995,takeProfitOnFill:'1.10242',A:.002,
    confirmedAt:new Date(now).toISOString(),confirmationPrice:1.1004,calendar:condition==='NO_CALENDAR'?undefined:calendar,
    clientRequestId:`continuation-${condition}`});
  assert.equal(f.orders,condition==='ON'?1:0,JSON.stringify(result));
  if(condition==='ON'){
    assert.equal(result.state,'FILLED');assert.equal((await f.store.load()).intents[0].entryPermission.source,'OPERATOR_AUTOPILOT');
  }else assert.equal(result.state,'BLOCKED');
});

test("eligible forex setup submits one mocked protected practice order",async()=>{
  const f=await fixture();const result=await f.run();
  assert.equal(f.orders,1,JSON.stringify(result.candidates));
  assert.equal(result.lastPracticeOrder.state,"FILLED");
  assert.equal(result.signals[0].forexState,"ordered");
  assert.equal(result.decisionDiagnostics.lastOrder.state,"FILLED");
  const ledger=await f.store.load();assert.equal(ledger.reservations[0].state,"CONSUMED");
  assert.ok(ledger.audits.some(r=>r.type==="CANDIDATE_CYCLE"));
});
test("eligible setup with Forex Autopilot OFF never submits",async()=>{
  const f=await fixture();f.setAuto(false);const result=await f.run();
  assert.equal(f.orders,0);assert.equal(result.autoTradingAuthorized,false);
  assert.ok(result.candidates.some(c=>c.blockers.includes("FOREX_AUTOPILOT_OFF")));
});
test("pause received during live evidence refresh wins before broker submission",async()=>{
  const f=await fixture();let calls=0;const original=f.client.getAccount;
  f.client.getAccount=async()=>{if(++calls===2)f.setPause(true);return original()};
  await f.run();assert.equal(f.orders,0);
});
test("fresh quote batch after slow history avoids self-created stale halt",async()=>{
  const f=await fixture();const original=f.client.getCandles;let elapsed=0;
  f.client.getCandles=async(...args)=>{elapsed+=1000;f.setTime(now+elapsed);return original(...args)};
  const result=await f.run();assert.notEqual(result.halt,"STALE_PRICE");assert.equal(result.quoteAgeSeconds,0);
});
test("weekend closure is not a candle gap; trading-hour gaps and invalid OHLC are rejected",()=>{
  assert.equal(inspectCandles([bar(Date.parse("2026-09-18T20:00Z")),bar(Date.parse("2026-09-20T21:00Z"))],"H1").ok,true);
  assert.ok(inspectCandles([bar(now-7200000),bar(now)],"H1").issues.includes("CANDLE_GAP"));
  assert.equal(inspectCandles([bar(now,1,0,2,NaN)],"H1").ok,false);
  assert.equal(inspectCandles(null,"H1").ok,false);
  assert.ok(inspectCandles([bar(now-86400000)],"H1",{now}).issues.includes("CANDLES_STALE"));
});
test("forex and stock/crypto routes never mutate the other control domain",async()=>{
  let state={forexAutoEnabled:true,forexEmergencyStopActive:false,autoTradingEnabled:true,emergencyStopActive:false};
  const handlers=new Map();registerOperationalControlRoutes({post:(path,...h)=>handlers.set(path,h.at(-1))},{requireAdmin(){},getControlState:()=>state,updateControlState:u=>(state={...state,...u}),recordOrder(){},getClientIp(){},saveEngineState(){}});
  const invoke=async(path,body={})=>{const r={status(n){this.code=n;return this},json(d){this.data=d;return this}};await handlers.get(path)({body},r);return r};
  await invoke('/emergency-stop');assert.equal(state.forexAutoEnabled,true);assert.equal(state.forexEmergencyStopActive,false);
  await invoke('/forex-emergency-stop');assert.equal(state.emergencyStopActive,true);assert.equal(state.autoTradingEnabled,false);
  assert.equal((await invoke('/forex-auto/on')).code,423);
  await invoke('/emergency-stop/release',{confirmation:'RELEASE EMERGENCY STOP'});assert.equal(state.forexEmergencyStopActive,true);assert.equal(state.forexAutoEnabled,false);
  await invoke('/auto-trading/on');assert.equal(state.autoTradingEnabled,true);assert.equal(state.forexEmergencyStopActive,true);assert.equal(state.forexAutoEnabled,false);
  await invoke('/forex-emergency-stop/release',{confirmation:'RELEASE FOREX EMERGENCY STOP'});assert.equal(state.autoTradingEnabled,true);assert.equal(state.forexAutoEnabled,false);
  await invoke('/forex-auto/on');await invoke('/forex-auto/off');assert.equal(state.autoTradingEnabled,true);assert.equal(state.forexAutoEnabled,false);
});
test("forex protection can run while independent discovery is blocked",async()=>{
  let finish;let protection=0;const scheduler=createForexScheduler({scan:()=>new Promise(r=>finish=r),protect:async()=>++protection});
  const running=scheduler.scan();await scheduler.protect();assert.equal(protection,1);assert.equal((await scheduler.scan()).skipped,"SCAN_RUNNING");finish();await running;
  const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const runtime=server.slice(server.indexOf('function getForexEngineRuntime'),server.indexOf('const forexScheduler'));
  assert.doesNotMatch(runtime,/\bemergencyStopActive\b|\bautoTradingEnabled\b/);
});
test("missing forex protection closes verified exposure with Autopilot off",async()=>{
  const f=await fixture();f.setAuto(false);let closed=0;
  f.client.getOpenTrades=async()=>({trades:[{id:'t',instrument:'EUR_USD',currentUnits:10,openTime:new Date(now).toISOString()}]});
  f.client.closeTrade=async()=>{closed++;return {orderFillTransaction:{id:'3',type:'ORDER_FILL',units:'-10',tradesClosed:[{tradeID:'t',units:'10'}]}}};
  await manageForexPositions({client:f.client,store:f.store,now,calendar});assert.equal(closed,1);
});
test("unknown conversion stays unavailable and replay waits for candle close",()=>{
  assert.equal(lossConversion('USD_JPY','USD',[]),null);
  assert.equal(lossConversion('EUR_USD','USD',[]),1);
  assert.equal(candlesKnownAt([bar(now)],new Date(now+60000).toISOString(),900000).length,0);
});
test("history is archived before trim, unresolved order state is preserved",()=>{
  const ledger=emptyLedger();ledger.audits=Array.from({length:150},(_,id)=>({id}));ledger.intents=[{state:'OUTCOME_UNKNOWN',intentId:'keep'}];
  assert.throws(()=>compactForexLedger(ledger,()=>{throw Error('disk full')}));assert.equal(ledger.audits.length,150);
  const archive=[];compactForexLedger(ledger,row=>archive.push(row));assert.equal(ledger.audits.length,100);assert.equal(archive[0].rows.length,50);assert.equal(ledger.intents[0].intentId,'keep');
});

test("stale execution quote after a good scan prevents an order",async()=>{
  const f=await fixture();const original=f.client.getPrices;let calls=0;
  f.client.getPrices=async(...args)=>{const p=await original(...args);if(++calls>=3)p.prices[0].time=new Date(now-10000).toISOString();return p};
  const result=await f.run();assert.equal(f.orders,0);assert.equal(result.lastPracticeOrder.reason,'QUOTE_STALE');
});
test("an expired trigger and malformed provider bars never submit",async()=>{
  const f=await fixture();f.setTime(now+240000);const expired=await f.run();assert.equal(f.orders,0);
  assert.ok(expired.candidates.some(c=>c.blockers.includes('ENTRY_EXPIRED')));
  const bad=await fixture();bad.client.getCandles=async()=>({candles:[null,{complete:true,time:'bad',mid:{}}]});
  const result=await bad.run();assert.equal(bad.orders,0);assert.equal(result.lastError,null);assert.ok(result.candidates.every(c=>c.state==='BLOCKED'));
});
test("daily loss persists an Autotrade OFF callback and never submits",async()=>{
  const f=await fixture();
  await f.store.commit(l=>{l.dayStart.a={date:new Date(now).toISOString().slice(0,10),equity:1200,adjustedEquity:1200,cursor:'1'};});
  let disabled=0;
  const result=await runForexEngineCycle({client:f.client,store:f.store,now,clockNow:()=>now,forexAutoEnabled:true,
    onDailyLossLock:()=>{disabled++;},calendar,registry:registry(),spec:{...FOREX_SPEC,scanInstruments:['EUR_USD']}});
  assert.equal(disabled,1);assert.equal(result.dailyLossLocked,true);assert.equal(f.orders,0);
  assert.equal((await f.store.load()).incidentLocks.a.reason,'DAILY_LOSS_LOCK');
});

test("calendar failure remains a blocker in practice mode",async()=>{
  const f=await fixture();const result=await runForexEngineCycle({client:f.client,store:f.store,now,clockNow:()=>now,forexAutoEnabled:true,registry:registry(),spec:{...FOREX_SPEC,scanInstruments:['EUR_USD']}});
  assert.equal(f.orders,0);assert.ok(result.candidates.some(c=>c.blockers.includes('CALENDAR_UNAVAILABLE')));
});
test("broker margin constrains actual units and protection uses instrument precision",async()=>{
  const f=await fixture();let sent;const original=f.client.createMarketOrder;f.client.createMarketOrder=async p=>{sent=p;return original(p)};
  const result=await f.run();assert.equal(f.orders,1);assert.ok(Math.abs(sent.units)*1.10041*.02<=800);
  assert.match(sent.stopLossPrice,/^\d+\.\d{5}$/);assert.match(sent.takeProfitPrice,/^\d+\.\d{5}$/);
  assert.ok(result.lastPracticeOrder.plannedRiskPercent<=10);
});
test("Forex Autopilot OFF during evidence fetch cannot be bypassed by initial approval",async()=>{
  const f=await fixture();const original=f.client.getAccount;let calls=0;
  f.client.getAccount=async()=>{if(++calls===2)f.setAuto(false);return original()};
  await f.run();assert.equal(f.orders,0);
});
test("new setup identity can trade after a completed prior setup; its retry cannot",async()=>{
  const store=createMemoryStore({treatAsDurable:true});let calls=0;
  const coordinator=createExecutionCoordinator({store,registry:registry(),refreshPlan:async(a,s,p)=>p,adapter:{liveHost:false,async createMarketOrder(){calls++;return {orderFillTransaction:{id:String(calls),type:'ORDER_FILL',units:'10',tradeOpened:{tradeID:String(calls),units:'10'}}}}}});
  const p={intent:'automatic',practiceOrdersEnabled:true,environment:'FORWARD_PRACTICE',autoTradingAuthorized:true,executionReady:true,accountId:'a',strategyId:'FOREX_BREAKOUT_RETEST_V1',instrumentId:'EUR_USD',currentUnits:0,units:10,worstEntryPrice:1.1,stop:1.09,A:.01,bid:1.09999,ask:1.1,priceBound:'1.1',stopLossOnFill:'1.09',takeProfitOnFill:'1.122',allowedRisk:1,conversionFactor:1,remainingDailyRisk:10,plannedRiskPercent:.1,openPlusPendingPercent:0,sameDirectionPercent:0,quoteOk:true,calendar,now};
  assert.equal((await coordinator.submit({...p,clientRequestId:'setup1'})).state,'FILLED');
  assert.equal((await coordinator.submit({...p,clientRequestId:'setup1'})).reason,'DUPLICATE_INTENT');
  assert.equal((await coordinator.submit({...p,clientRequestId:'setup2'})).state,'FILLED');assert.equal(calls,2);
});

test("continuation pullback waits, preserves its anchor, then expires by elapsed bars",()=>{
  const h4=Array.from({length:220},(_,i)=>bar(now-(220-i)*14400000,80+i*.1,80+i*.1+.2,80+i*.1-.2,80+i*.1));
  const h1=Array.from({length:80},(_,i)=>{const c=100+i*.1+Math.sin(i*Math.PI/3)*.5;return bar(now-(80-i)*3600000,c,c+.2,c-.2,c)});
  const m15=Array.from({length:20},(_,i)=>bar(now-(20-i)*900000,108,108.1,107.9,108));
  m15[19]=bar(now-900000,107.9,108.05,107.7,107.8);
  const first=evaluateTrendContinuation({h4,h1,m15});assert.equal(first.reason,'PULLBACK');
  const next=evaluateTrendContinuation({h4,h1,m15,previous:{...first,state:first.stage}});assert.equal(next.reason,'PULLBACK');assert.equal(next.frozen.pullbackStart,first.frozen.pullbackStart);
  for(let i=0;i<3;i++)m15.push(bar(now+i*900000,107.9,108.05,107.7,107.8));
  assert.equal(evaluateTrendContinuation({h4,h1,m15,previous:{...first,state:first.stage}}).reason,'ENTRY_EXPIRED');
  m15.push(bar(now+2700000,108,108.6,108.1,108.5));
  assert.equal(evaluateTrendContinuation({h4,h1,m15,previous:{...first,state:first.stage}}).reason,'ENTRY_EXPIRED');
});

test("missing currency conversion and invalid risk numbers cannot authorize exposure",async()=>{
  const f=await fixture();const account=f.client.getAccount;const prices=f.client.getPrices;
  f.client.getAccount=async()=>{const p=await account();p.account.currency='EUR';return p};
  f.client.getPrices=async names=>({...await prices(names),homeConversions:[]});
  await assert.rejects(refreshExecutionPlan(f.client,f.store,{accountId:'a',instrumentId:'EUR_USD',confirmedAt:new Date(now).toISOString(),confirmationPrice:1.1},()=>now),/CONVERSION_UNAVAILABLE/);
  assert.equal(canOpenRisk({effect:'OPENING_LONG',remainingDailyRisk:NaN,plannedRisk:1,openPlusPending:0,sameDirection:0}).ok,false);
});

test("restart preserves forex locks, unresolved orders and candidate-to-exit history",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartmoney-forex-restart-'));
  const options={filePath:path.join(dir,'ledger.json'),persistentRoot:dir};
  const first=createFileStore(options);
  await first.commit(l=>{
    l.pauseEntries.a=true;l.incidentLocks.a=true;
    l.intents.push({intentId:'entry',accountId:'a',clientOrderId:'stable',candidateId:'setup',strategyId:'strategy',intent:'automatic',state:'OUTCOME_UNKNOWN'});
    l.reservations.push({intentId:'entry',state:'RESERVED',risk:1});
    l.audits=Array.from({length:105},(_,id)=>({id}));
  });
  const restarted=createFileStore(options);const before=await restarted.load();
  assert.equal(before.pauseEntries.a,true);assert.equal(before.incidentLocks.a,true);
  assert.equal(before.intents[0].state,'OUTCOME_UNKNOWN');assert.equal(before.reservations[0].state,'RESERVED');
  assert.equal(before.audits.length,100);assert.equal(fs.readdirSync(`${options.filePath}.archive`).length,1);
  await restarted.commit(l=>ingestTransactions(l,'a',[
    {id:'1',type:'ORDER_FILL',clientOrderID:'stable',tradeOpened:{tradeID:'t',units:'10'},instrument:'EUR_USD',price:'1.1'},
    {id:'2',type:'ORDER_FILL',reason:'STOP_LOSS_ORDER',tradesClosed:[{tradeID:'t',units:'10',realizedPL:'-1'}],instrument:'EUR_USD',price:'1.09'}
  ]));
  const after=await createFileStore(options).load();
  assert.equal(after.intents[0].state,'FILLED');assert.equal(after.fills[1].candidateId,'setup');
  assert.equal(after.fills[1].exitReason,'STOP_LOSS_ORDER');assert.equal(after.fills[1].realizedPL,'-1');
  // Delete only known files created by this fixture; no recursive deletion.
  for(const name of fs.readdirSync(`${options.filePath}.archive`))fs.unlinkSync(path.join(`${options.filePath}.archive`,name));
  fs.rmdirSync(`${options.filePath}.archive`);fs.unlinkSync(options.filePath);fs.rmdirSync(dir);
});

test("compaction never deletes unrelated legacy fills with missing dedupe keys",()=>{
  const l=emptyLedger();l.fills=Array.from({length:2001},(_,i)=>({accountId:'a',brokerTradeId:String(i),action:'CLOSED'}));
  l.fills.push({accountId:'a',brokerTradeId:'open',action:'OPENED'});l.openTradeIds=['a:open'];
  compactForexLedger(l,()=>{});
  assert.equal(l.fills.length,2000);assert.ok(l.fills.some(f=>f.brokerTradeId==='open'));
});
