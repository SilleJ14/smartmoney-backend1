import test from 'node:test';
import assert from 'node:assert/strict';
import { assertVerifiedQuote } from '../live/quoteAuthorization.js';
import { createOrderService } from '../execution/orderService.js';

for (const method of ['manualStockBuy','stockBuy','cryptoMarketBuy']) {
  test(`${method}: failed verification sends zero orders; valid verification reaches mocked broker`, async () => {
    let ready = false, calls = 0;
    const service = createOrderService({ normalizeSymbol: s => s, tradingRequest: async () => {calls++;return {id:'mock'};},
      preTradeRiskGuard: { assertAllowed: async payload => {
        assertVerifiedQuote({quoteReady:ready,quote:{price:100}},payload.symbol);
        return { assertCurrent() { assertVerifiedQuote({quoteReady:ready,quote:{}},payload.symbol); } };
      }} });
    const input = { symbol:method==='cryptoMarketBuy'?'BTC/USD':'AAPL', dollars:25, score:100,
      fractionable:true,marketOpen:true,holdCategory:'intraday',buyMode:'dollars',referencePrice:100 };
    await assert.rejects(service[method](input), /QUOTE_VERIFICATION_FAILED/);
    assert.equal(calls,0);
    ready=true; assert.equal((await service[method](input)).id,'mock'); assert.equal(calls,1);
  });
}
test('revocation during asynchronous risk reservation blocks final broker submission', async () => {
  let ready=true,calls=0;
  const service=createOrderService({normalizeSymbol:s=>s,tradingRequest:async()=>{calls++;},
    reserveRisk:async()=>{ready=false;return {settle:async()=>{}};},
    preTradeRiskGuard:{assertAllowed:async()=>({assertCurrent(){assertVerifiedQuote({quoteReady:ready},'BTC/USD');}})}});
  await assert.rejects(service.cryptoMarketBuy({symbol:'BTC/USD',dollars:25}),/QUOTE_VERIFICATION_FAILED/);
  assert.equal(calls,0);
});
