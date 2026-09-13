import test from 'node:test';import assert from 'node:assert/strict';
import { createCryptoResearchVolume } from '../market-data/cryptoResearchVolume.js';
import { assessCryptoSetup } from '../scoring/cryptoSetup.js';
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';
test('research volume preserves execution OHLCV and requires aligned complete evidence', async () => {
  const now=Date.parse('2026-09-13T02:00:01Z');
  const fixture=cryptoSetupEvidence(100,now);
  const bars=fixture.chartBars.map(b=>({t:b.time,o:b.open,h:b.high,l:b.low,c:b.close,v:0,intervalMs:300000}));
  let calls=0;
  const enrich=createCryptoResearchVolume({now:()=>now,getBars:async()=>{calls++;return fixture.chartBars.map(b=>({t:b.time,v:b.volume}));}});
  const result=await enrich('BTC/USD',bars);
  assert.ok(result.every(b=>b.v===0));assert.equal(result.at(-1).c,bars.at(-1).c);
  const setup=assessCryptoSetup({price:100,chartBars:result},{now});
  assert.equal(setup.volumeConfirmed,true);assert.equal(setup.volumeSource,'alpaca_kraken_research_bars');
  await enrich('BTC/USD',bars);assert.equal(calls,1);
  result.at(-1).marketVolume=null;
  assert.equal(assessCryptoSetup({price:100,chartBars:result},{now}).volumeConfirmed,false);
});
