import test from "node:test";
import assert from "node:assert/strict";
import { forexDailyChange } from "../forex/dailyChange.js";
const time = "2026-09-23T15:00:00Z";
const bar = (c, complete = true, time = "2026-09-21T21:00:00Z") => ({ time, complete, mid: { c } });
const calc = (candles, mid = 1.11) => forexDailyChange({ candles }, { mid, time });
test("daily change selects latest completed candle, not developing daily close", () => {
  // Latest timestamps must be unique, as on the provider feed.
  const latest = calc([bar(1, true, "2026-09-20T21:00:00Z"), bar(1.1), bar(2, false, "2026-09-22T21:00:00Z")]);
  assert.ok(Math.abs(latest.sessionChangePercent - 0.909090909) < 1e-8);
  assert.equal(latest.changePercentMeasured, true);
  assert.equal(latest.percentChangeEvidence.priceAt, time);
});
test("zero and negative daily changes remain measured", () => {
  assert.equal(calc([bar(1.1)], 1.1).sessionChangePercent, 0);
  assert.ok(calc([bar(1.1)], 1).sessionChangePercent < 0);
});
test("bad or missing evidence never becomes zero change", () => {
  for (const candles of [null, {}, [], [null], [bar(0)], [bar('bad')], [bar(1, false)], [bar(1, true, '2026-09-24T21:00:00Z')], [bar(1, true, '2026-09-10T21:00:00Z')]]) {
    assert.equal(calc(candles).changePercentMeasured, false);
    assert.equal(calc(candles).sessionChangePercent, null);
  }
  assert.equal(forexDailyChange({ candles: [bar(1)] }, { mid: 1, time: null }).changePercentMeasured, false);
});
