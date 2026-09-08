import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactLiveQuoteDto } from "../market-data/liveQuoteDto.js";

test("compact quote DTO preserves true zero and omits raw/candle/debug payloads", () => {
  const dto = buildCompactLiveQuoteDto("BTC/USD", {
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spread: 0.02,
    spreadPercent: 0.02,
    spreadAvailable: true,
    percentChange: 0,
    percentChangeAvailable: true,
    displayPercent: 0,
    displayPercentAvailable: true,
    liveQuoteUpdatedAt: "2026-09-01T14:30:00.000Z",
    spreadUpdatedAt: "2026-09-01T14:30:00.000Z",
    liveQuoteSource: "alpaca_crypto_latest",
    priceIsLive: true,
    raw: { enormous: "x".repeat(20_000) },
    oneSecondCandles: Array.from({ length: 60 }, (_, index) => ({ index })),
  }, {
    fastRunnerBreakdown: { debug: true },
    secondCandles: Array.from({ length: 60 }, (_, index) => ({ index })),
  });

  assert.equal(dto.percentChange, 0);
  assert.equal(dto.percentChangeAvailable, true);
  assert.equal(dto.displayPercent, 0);
  assert.equal(dto.raw, undefined);
  assert.equal(dto.oneSecondCandles, undefined);
  assert.equal(dto.fastRunnerBreakdown, undefined);
  assert.ok(JSON.stringify(dto).length < 2_000);
});

test("compact quote DTO does not coerce missing change or spread to zero", () => {
  const dto = buildCompactLiveQuoteDto("BTC/USD", {
    price: 100,
    percentChange: 0,
    percentChangeAvailable: false,
    spreadAvailable: false,
  });

  assert.equal(dto.percentChange, null);
  assert.equal(dto.percentChangeAvailable, false);
  assert.equal(dto.spread, null);
  assert.equal(dto.spreadPercent, null);
});
