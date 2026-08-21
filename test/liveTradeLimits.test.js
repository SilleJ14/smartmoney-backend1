import test from "node:test";
import assert from "node:assert/strict";
import { ensureLiveTradeLimitDay, evaluateLiveTradeLimits, recordSuccessfulEntry } from "../risk/liveTradeLimits.js";

const stock = (symbol) => ({ symbol, isCrypto: false });
const crypto = (symbol) => ({ symbol, isCrypto: true });

test("limits intraday entries to two per trading day", () => {
  const result = evaluateLiveTradeLimits({ symbol: "CCC", positions: [], intradayStockEntriesToday: 2 });
  assert.equal(result.approved, false);
  assert.match(result.reasons[0], /intraday stock trades/);
});

test("limits multi-day stocks and crypto to three open positions each", () => {
  const intents = { AAA: { holdCategory: "multi_day" }, BBB: { holdCategory: "multi_day" }, CCC: { holdCategory: "multi_day" } };
  assert.equal(evaluateLiveTradeLimits({ symbol: "DDD", holdCategory: "multi_day", positions: [stock("AAA"), stock("BBB"), stock("CCC")], positionIntents: intents }).approved, false);
  assert.equal(evaluateLiveTradeLimits({ symbol: "DOGEUSD", isCrypto: true, positions: [crypto("BTCUSD"), crypto("ETHUSD"), crypto("SOLUSD")] }).approved, false);
});

test("scale-ins do not consume a new slot or daily trade", () => {
  const result = evaluateLiveTradeLimits({ symbol: "AAA", positions: [stock("AAA"), stock("BBB")], intradayStockEntriesToday: 2, positionIntents: { AAA: { holdCategory: "intraday" }, BBB: { holdCategory: "intraday" } } });
  assert.equal(result.approved, true);
  assert.equal(result.isExistingPosition, true);
});

test("successful sliced entries increment only once", () => {
  const state = { dateKey: "2026-08-21", intradayStockEntriesToday: 0, positionIntents: {} };
  assert.equal(recordSuccessfulEntry(state, { symbol: "AAA", category: "intraday", dateKey: state.dateKey }).recorded, true);
  assert.equal(recordSuccessfulEntry(state, { symbol: "AAA", category: "intraday", dateKey: state.dateKey, isExistingPosition: true }).recorded, false);
  assert.equal(state.intradayStockEntriesToday, 1);
});

test("intraday counter resets on a new New York trading date", () => {
  const prior = { dateKey: "2026-08-20", intradayStockEntriesToday: 2, positionIntents: { AAA: { holdCategory: "multi_day" } } };
  const next = ensureLiveTradeLimitDay(prior, "2026-08-21");
  assert.equal(next.intradayStockEntriesToday, 0);
  assert.equal(next.positionIntents.AAA.holdCategory, "multi_day");
  assert.equal(ensureLiveTradeLimitDay(next, "2026-08-21"), next);
});
