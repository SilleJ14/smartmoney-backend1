import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ALPACA_CRYPTO_EXECUTION_VENUE,
  CRYPTO_EXECUTION_ECONOMICS_SHADOW,
  buildCryptoExecutionEconomics,
  buildCryptoLiquidityGate,
  evaluateCryptoQuotedSpreadGate,
  resolveCryptoFee,
} from "../scoring/cryptoExecutionEconomics.js";
import {
  CRYPTO_EXECUTION_THRESHOLDS,
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  calculateCryptoEntryQualityFromEvidence,
} from "../scoring/cryptoScoring.js";
import { CRYPTO_DECISION_WEIGHTS } from "../scoring/componentScore.js";
import { evaluateCryptoTradePlan } from "../scoring/cryptoTradePlan.js";
import { cryptoSetupEvidence } from "./fixtures/cryptoSetupFixture.js";

const now = Date.parse("2026-09-25T14:00:00.000Z");

function book({ asks, bids, location = "us", symbol = "BTC/USD", updatedAt = new Date(now).toISOString() }) {
  return {
    source: "alpaca_crypto_orderbook",
    location,
    symbol,
    updatedAt,
    asks,
    bids,
  };
}

function touchBook(spreadPct, size = 100) {
  const mid = 100;
  const half = (spreadPct / 100) / 2;
  return book({
    asks: [{ p: mid * (1 + half), s: size }],
    bids: [{ p: mid * (1 - half), s: size }],
  });
}

test("a quoted spread of 0.85 percent still passes the coarse execution gate", () => {
  assert.equal(CRYPTO_MAX_ENTRY_SPREAD_PERCENT, 0.85);
  const gate = evaluateCryptoQuotedSpreadGate(0.85, true);
  assert.equal(gate.state, "PASS");
  assert.equal(gate.pass, true);
  assert.equal(evaluateCryptoQuotedSpreadGate(0.8501, true).state, "REJECT");
});

test("shadow execution economics does not score a 0.85 percent quote as spread quality 20", () => {
  const economics = buildCryptoExecutionEconomics({
    symbol: "BTC/USD",
    cryptoOrderbook: touchBook(0.85, 100),
  }, { notional: 25, now });
  assert.equal(CRYPTO_EXECUTION_ECONOMICS_SHADOW.replacesSpreadQualityCurve, true);
  assert.equal(Object.hasOwn(economics, "spreadQualityScore"), false);
  assert.notEqual(economics.estimatedRoundTripCostPct, 20);
  assert.equal(economics.state, "PASS");
  const source = fs.readFileSync(new URL("../scoring/cryptoExecutionEconomics.js", import.meta.url), "utf8");
  assert.equal(source.includes("(quotedSpread / 0.85)"), false);
  assert.equal(source.includes("* 80"), false);
  const legacy = calculateCryptoEntryQualityFromEvidence({
    spreadAvailable: true,
    spreadPercent: 0.85,
    liquidityEvidence: { available: true, dollarVolume: 2_000_000, minimum: 1_000_000, pass: true },
  });
  assert.equal(legacy.spreadQualityScore, 20);
});

test("fifteen dollars and four hundred dollars walk the same book differently", () => {
  const cryptoOrderbook = book({
    asks: [{ p: 100.2, s: 250 / 100.2 }, { p: 100.5, s: 2500 / 100.5 }],
    bids: [{ p: 99.8, s: 250 / 99.8 }, { p: 99.5, s: 2500 / 99.5 }],
  });
  const small = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 15, now });
  const large = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 400, now });
  assert.equal(small.state, "PASS");
  assert.equal(small.buySlippageVsAsk, 0);
  assert.equal(large.state, "REJECT");
  assert.ok(large.buySlippageVsAsk > small.buySlippageVsAsk);
  assert.notEqual(small.estimatedRoundTripCostPct, large.estimatedRoundTripCostPct);
  assert.notEqual(small.walkedBuyPrice, large.walkedBuyPrice);
});

test("a missing order book is unavailable and does not become zero slippage", () => {
  const economics = buildCryptoExecutionEconomics({ symbol: "BTC/USD" }, { notional: 25, now });
  assert.equal(economics.state, "DATA_UNAVAILABLE");
  assert.deepEqual(economics.reasons, ["ORDER_BOOK_UNAVAILABLE"]);
  assert.equal(economics.walkedBuyPrice, null);
  assert.equal(economics.buySlippageVsAsk, null);
  assert.equal(economics.estimatedRoundTripCostPct, null);
  assert.notEqual(economics.buySlippageVsAsk, 0);
});

test("a deep 0.40 percent book can pass a small order and reject a large one", () => {
  const cryptoOrderbook = book({
    asks: [{ p: 100.2, s: 250 / 100.2 }, { p: 100.5, s: 2500 / 100.5 }],
    bids: [{ p: 99.8, s: 250 / 99.8 }, { p: 99.5, s: 2500 / 99.5 }],
  });
  const small = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 15, now });
  const large = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 400, now });
  assert.equal(Number(small.quotedSpreadPct.toFixed(2)), 0.4);
  assert.equal(small.state, "PASS");
  assert.ok(large.reasons.includes("CRYPTO_ORDER_EXCEEDS_DEPTH_PARTICIPATION"));
  assert.equal(large.buyWalk.approved, true);
  assert.equal(large.state, "REJECT");
});

test("a higher fee tier lowers the expected round trip", () => {
  const cryptoOrderbook = touchBook(0.4, 100);
  const tierOne = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 25, now, thirtyDayCryptoVolumeUsd: 0 });
  const tierEight = buildCryptoExecutionEconomics({
    symbol: "BTC/USD",
    cryptoOrderbook,
  }, { notional: 25, now, thirtyDayCryptoVolumeUsd: 100_000_000 });
  assert.equal(tierOne.feeTier, 1);
  assert.equal(tierOne.fees.feeType, "TAKER");
  assert.equal(tierOne.takerFeePct, 0.25);
  assert.equal(tierOne.fees.feeScheduleVersion, "alpaca-crypto-spot-2023-03-13");
  assert.equal(tierEight.feeTier, 8);
  assert.equal(tierEight.takerFeePct, 0.10);
  assert.ok(Math.abs((tierOne.estimatedRoundTripCostPct - tierEight.estimatedRoundTripCostPct) - 0.3) < 0.0001);
  assert.equal(resolveCryptoFee({ orderType: "limit", thirtyDayCryptoVolumeUsd: 0 }).feeType, "MAKER");
  assert.equal(resolveCryptoFee({ orderType: "limit", thirtyDayCryptoVolumeUsd: 0 }).feeRate, 0.15);
});

test("dollar volume can pass while the book rejects the order size", () => {
  const cryptoOrderbook = book({
    asks: [{ p: 100.2, s: 0.05 }],
    bids: [{ p: 99.8, s: 0.05 }],
  });
  const economics = buildCryptoExecutionEconomics({ symbol: "BTC/USD", cryptoOrderbook }, { notional: 400, now });
  const liquidity = buildCryptoLiquidityGate({ dollarVolume24h: 5_000_000 });
  assert.equal(liquidity.state, "PASS");
  assert.equal(economics.state, "REJECT");
  assert.notEqual(liquidity.state, economics.state);
});

test("book economics can pass while 24-hour dollar volume fails", () => {
  const economics = buildCryptoExecutionEconomics({
    symbol: "BTC/USD",
    cryptoOrderbook: touchBook(0.2, 100),
  }, { notional: 25, now });
  const liquidity = buildCryptoLiquidityGate({ dollarVolume24h: 1_000 });
  assert.equal(economics.state, "PASS");
  assert.equal(liquidity.state, "REJECT");
  assert.equal(liquidity.reason, "INSUFFICIENT_24H_LIQUIDITY");
});

test("the book venue and the execution venue are both recorded", () => {
  const matched = buildCryptoExecutionEconomics({
    symbol: "BTC/USD",
    cryptoOrderbook: touchBook(0.2, 100),
  }, { notional: 25, now });
  assert.equal(matched.bookVenue, "alpaca-us");
  assert.equal(matched.executionVenue, ALPACA_CRYPTO_EXECUTION_VENUE);
  assert.equal(matched.state, "PASS");
  const crossed = buildCryptoExecutionEconomics({
    symbol: "BTC/USD",
    cryptoOrderbook: book({
      location: "us-1",
      asks: [{ p: 100.1, s: 10 }],
      bids: [{ p: 99.9, s: 10 }],
    }),
  }, { notional: 25, now, executionVenue: "alpaca-us" });
  assert.equal(crossed.bookVenue, "alpaca-kraken");
  assert.equal(crossed.executionVenue, "alpaca-us");
  assert.equal(crossed.state, "REJECT");
  assert.ok(crossed.reasons.includes("BOOK_VENUE_MISMATCH"));
});

test("crypto still has no numeric Entry floor and F is unchanged", () => {
  assert.equal(CRYPTO_EXECUTION_THRESHOLDS.entryScore, null);
  assert.equal(CRYPTO_EXECUTION_THRESHOLDS.finalScore, 65);
  assert.equal(CRYPTO_DECISION_WEIGHTS.base, 0.45);
  assert.equal(CRYPTO_DECISION_WEIGHTS.execution, 0.40);
  assert.equal(CRYPTO_DECISION_WEIGHTS.runner, 0);
  assert.equal(CRYPTO_DECISION_WEIGHTS.strategyEvolution, 0.15);
  assert.equal(CRYPTO_EXECUTION_ECONOMICS_SHADOW.replacesFinalScore, false);
  assert.equal(CRYPTO_EXECUTION_ECONOMICS_SHADOW.replacesProductionEntry, false);
  const plan = evaluateCryptoTradePlan({
    symbol: "BTC/USD",
    price: 100,
    ...cryptoSetupEvidence(100, now),
  }, { notional: 100, now });
  assert.equal(plan.approved, true);
  assert.equal(plan.cryptoExecutionEconomics.name, "cryptoExecutionEconomics");
  assert.equal(plan.cryptoExecutionEconomics.mode, "SHADOW");
  assert.notEqual(plan.cryptoLiquidityGate.name, plan.cryptoExecutionEconomics.name);
});
