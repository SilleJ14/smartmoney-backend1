// Synthetic fixed-time corpus; not historical market-performance evidence.
export const cryptoBaselineTime = Date.parse('2026-09-19T16:00:00Z');
const at=new Date(cryptoBaselineTime).toISOString();
const chartBars=Array.from({length:30},(_,index)=>{
  const last=index===29;
  return {t:cryptoBaselineTime-(31-index)*60000,o:last?100.2:100,h:last?102.2:100.3,
    l:last?100.1:99.8,c:last?102:100,v:last?300:100,marketVolume:last?300:100,
    marketVolumeSource:'alpaca_research_bars',intervalMs:60000};
});
const complete={symbol:'BTC/USD',cryptoDiscoveryScorecard:{score:90,coverage:1,calculatedAt:at,extension:{alreadyExtended:false}},
  newsCatalyst:{dataAvailable:true,riskDetected:false},cryptoContextScorecard:{independent:true,score:80,source:'independent_crypto_context'},
  barsFound:30,current:100,priceIsLive:true,liveQuoteUpdatedAt:at,liveQuoteSource:'alpaca_crypto_latest',
  spreadUpdatedAt:at,spreadSource:'alpaca_crypto_latest',bid:99.95,ask:100.05,windowDollarVolume:1000000,chartBars};
export const cryptoBaselineInputs={complete,missingContext:{...complete,cryptoContextScorecard:null},
  staleSpread:{...complete,spreadUpdatedAt:new Date(cryptoBaselineTime-6000).toISOString()},
  zeroVolume:{...complete,windowDollarVolume:0},missingNews:{...complete,newsCatalyst:{dataAvailable:false}}};
