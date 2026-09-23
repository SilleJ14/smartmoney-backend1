import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarTimestamp, normalizeEconomicCalendar, createEconomicCalendarProvider } from '../forex/economicCalendarProvider.js';
import { calendarForDecision } from '../forex/calendarFeed.js';

const now = Date.parse('2026-09-23T14:00:00Z');
const row = {country:'US',event:'Employment report',impact:'high',time:'2026-09-23T14:10:00Z'};
const options = {from:'2026-09-22',to:'2026-09-25',requestedAt:now};
const payload = rows => ({economicCalendar:rows || [row]});
const response = value => new Response(JSON.stringify(value),{status:200});

test('calendar maps currencies, retains uncertain importance and central-bank events, deduplicates',()=>{
  const snapshot=normalizeEconomicCalendar(payload([row,row,{...row,country:'JP',impact:'low',event:'BoJ speech'},
    {...row,country:'XX',impact:null,event:'Unknown event'},{...row,impact:'low',event:'Minor report'}]),options);
  assert.equal(snapshot.events.length,3);
  assert.equal(snapshot.lowImpactCount,1);
  assert.ok(snapshot.events.some(e=>e.currency==='JPY'&&e.type.startsWith('central bank:')));
  assert.ok(snapshot.events.some(e=>e.currency==='ALL'));
  assert.equal(calendarForDecision(snapshot,{now,instrument:'EUR_USD'}).reason,'EVENT_WINDOW');
});

test('explicit timestamp zones only; never infer server timezone or roll invalid dates',()=>{
  assert.equal(calendarTimestamp('2026-09-23T10:00:00-04:00'),new Date(now).toISOString());
  assert.equal(calendarTimestamp('2026-09-23 14:00:00','UTC'),new Date(now).toISOString());
  for(const stamp of ['2026-09-23 14:00:00','2026-02-30T14:00:00Z','tentative',null])assert.throws(()=>calendarTimestamp(stamp));
});

for(const [name,value] of Object.entries({empty:payload([]),malformed:{},partial:{...payload(),hasMore:true},
  badRow:payload([null]),badTime:payload([{...row,time:'bad'}]),outside:payload([{...row,time:'2026-10-01T14:00:00Z'}])})) {
  test(`calendar rejects ${name} evidence`,()=>assert.throws(()=>normalizeEconomicCalendar(value,options)));
}

test('calendar verifies holding-horizon and currency coverage',()=>{
  const s=normalizeEconomicCalendar(payload([{...row,impact:'low'}]),options);
  assert.equal(calendarForDecision(s,{now,instrument:'EUR_USD'}).ok,true);
  assert.equal(calendarForDecision({...s,coveredThrough:new Date(now+3600000).toISOString()},{now,instrument:'EUR_USD'}).ok,false);
  assert.equal(calendarForDecision({...s,coveredCurrencies:['USD']},{now,instrument:'EUR_USD'}).ok,false);
});

test('provider batches concurrent refreshes, caches, keeps secrets out of URL and diagnostics',async()=>{
  let calls=0,time=now;
  const p=createEconomicCalendarProvider({apiKey:'private-key',nowFn:()=>time,fetchImpl:async(url,init)=>{
    calls++;assert.equal(new URL(url).pathname,'/api/v1/calendar/economic');
    assert.equal(new URL(url).searchParams.get('from'),'2026-09-22');
    assert.equal(init.headers['X-Finnhub-Token'],'private-key');assert.ok(!url.includes('private-key'));
    return response(payload());
  }});
  await Promise.all([p.refresh(),p.refresh(),p.refresh()]);await p.refresh();
  assert.equal(calls,1);assert.equal(p.getStatus().qualityStatus,'VALID');
  assert.ok(!JSON.stringify(p.getStatus()).includes('private-key'));
  assert.ok(Object.isFrozen(p.getSnapshot().events));
  time+=300001;await p.refresh();assert.equal(calls,2);
});

for(const [code,reason] of [[401,'CALENDAR_ACCESS_DENIED'],[403,'CALENDAR_ACCESS_DENIED'],[429,'CALENDAR_RATE_LIMITED'],[500,'CALENDAR_PROVIDER_FAILED']]) {
  test(`HTTP ${code} blocks entries and backs off`,async()=>{
    let calls=0;
    const p=createEconomicCalendarProvider({apiKey:'secret',nowFn:()=>now,fetchImpl:async()=>{calls++;return new Response('secret',{status:code,headers:{'retry-after':'1800'}})}});
    await p.refresh();await p.refresh();assert.equal(calls,1);
    assert.equal(p.getStatus().error,reason);assert.equal(p.getSnapshot().coverageComplete,false);
    assert.ok(!JSON.stringify(p.getStatus()).includes('secret'));
    if(code===429)assert.ok(Date.parse(p.getStatus().nextAttemptAt)>=now+1800000);
  });
}

test('failed refresh invalidates cached authorization without changing evidence time; later success recovers',async()=>{
  let time=now,broken=false;
  const p=createEconomicCalendarProvider({apiKey:'key',nowFn:()=>time,fetchImpl:async()=>{
    if(broken)throw new Error('private transport details');return response(payload());
  }});
  await p.refresh();const original=p.getSnapshot().refreshedAt;
  time+=300001;broken=true;await p.refresh();
  assert.equal(p.getSnapshot().coverageComplete,false);assert.equal(p.getSnapshot().refreshedAt,original);
  assert.equal(p.getStatus().error,'CALENDAR_NETWORK_ERROR');
  time+=60001;broken=false;await p.refresh();assert.equal(p.getStatus().qualityStatus,'VALID');
});

test('cold start without credentials blocks without making a request',async()=>{
  const p=createEconomicCalendarProvider({nowFn:()=>now,fetchImpl:()=>assert.fail('no request allowed')});
  await p.refresh();assert.equal(p.getStatus().error,'CALENDAR_MISSING_API_KEY');
});

test('oversized and invalid bodies fail closed',async()=>{
  for(const body of ['not json','x'.repeat(2*1024*1024+1)]){
    const p=createEconomicCalendarProvider({apiKey:'key',nowFn:()=>now,fetchImpl:async()=>new Response(body)});
    await p.refresh();assert.equal(p.getSnapshot().coverageComplete,false);
    assert.match(p.getStatus().error,/CALENDAR_(INVALID_RESPONSE|RESPONSE_TOO_LARGE)/);
  }
});

test('slow response cannot acquire a fresh receipt timestamp',async()=>{
  let time=now;
  const p=createEconomicCalendarProvider({apiKey:'key',nowFn:()=>time,fetchImpl:async()=>{time+=16*60000;return response(payload())}});
  await p.refresh();assert.equal(p.getStatus().error,'CALENDAR_STALE_RESPONSE');
});
