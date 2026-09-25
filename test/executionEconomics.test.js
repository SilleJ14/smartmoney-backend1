import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAlpacaCryptoBook,
  normalizeAlpacaStockBook,
  normalizeTradierPrint,
  normalizeTradierRestBook,
  normalizeTradierStreamBook,
} from "../market-data/normalizedQuote.js";
import {
  annotateFillExecution,
  buildExecutionEconomicsShadow,
  estimateLongRewardRisk,
  quotedSpreadFromBook,
  spreadWideningRiskFromQuote,
} from "../scoring/executionEconomics.js";
import { calculateEntryQualityScore, evaluateStockTradeCandidate, STOCK_EXECUTION_THRESHOLDS } from "../scoring/decisionScores.js";
import { CRYPTO_MAX_ENTRY_SPREAD_PERCENT } from "../scoring/cryptoScoring.js";
import { assessCryptoOrderLiquidity } from "../scoring/cryptoOrderLiquidity.js";

const entryBase = {
  confirmations: { aboveVwap: true, closeNearHighPercent: 82, fakeBreakout: false },
  technicals: { ema9: 11, ema20: 10, macd: 2, macdSignal: 1, rsi: 60 },
  technicalBarsFound: 40,
  phase5SignalQuality: {
    liquidityStabilityScore: 85,
    antiChaseRisk: 15,
    exhaustionRisk: 15,
    breakoutRetestConfirmation: true,
  },
};

test("a 1 percent quoted spread is a 0.5 percent cross from the midpoint", () => {
  const book = quotedSpreadFromBook(99.5, 100.5);
  assert.equal(book.midpoint, 100);
  assert.equal(book.quotedSpreadPct, 1);
  assert.equal(book.halfSpreadPct, 0.5);
  const shadow = buildExecutionEconomicsShadow({ bid: 99.5, ask: 100.5, assetClass: "stock" });
  assert.equal(shadow.quotedSpreadPct, 1);
  assert.equal(shadow.halfSpreadPct, 0.5);
  assert.equal(shadow.executionCostEstimate.expectedTotalCost, null);
  assert.equal(shadow.executionCostEstimate.knownCostLowerBound, 0.5);
  assert.equal(shadow.executionCostEstimate.costCoverage, "PARTIAL");
});

test("a missing bid and ask is unknown and is not risk 8", () => {
  assert.equal(spreadWideningRiskFromQuote({}), null);
  assert.equal(spreadWideningRiskFromQuote({ spreadAvailable: false, spreadPercent: 0 }), null);
  const shadow = buildExecutionEconomicsShadow({ assetClass: "stock", spreadAvailable: false });
  assert.equal(shadow.quotedSpreadPct, null);
  assert.equal(shadow.halfSpreadPct, null);
  assert.equal(shadow.marketImpactPct, null);
  assert.equal(shadow.executionCostEstimate.expectedTotalCost, null);
  assert.notEqual(shadow.executionCostEstimate.knownCost, 0);
});

test("Tradier REST bid and ask size is kept in shares", () => {
  const book = normalizeTradierRestBook({
    bid: 100,
    ask: 100.1,
    bidsize: 4,
    asksize: 8,
    bidexch: "Q",
    askexch: "Z",
    last: 100.05,
    last_volume: 100,
    trade_date: 1762982100011,
  }, "2026-09-25T14:00:00.000Z");
  assert.equal(book.bidSizeRaw, 4);
  assert.equal(book.askSizeRaw, 8);
  assert.equal(book.bidSizeShares, 400);
  assert.equal(book.askSizeShares, 800);
  assert.equal(book.sizeUnit, "hundreds");
  assert.equal(book.bidExchange, "Q");
  assert.equal(book.askExchange, "Z");
  assert.equal(book.lastTradeSize, 100);
  assert.equal(book.provider, "TRADIER");
  assert.equal(book.provenance.feed, "CONSOLIDATED");
});

test("Tradier stream size is preserved without assuming it is shares", () => {
  const book = normalizeTradierStreamBook({ bid: 281.84, ask: 281.85, bidsz: 60, asksz: 6, bidexch: "M", askexch: "Z" });
  assert.equal(book.bidSizeRaw, 60);
  assert.equal(book.askSizeRaw, 6);
  assert.equal(book.bidSizeShares, null);
  assert.equal(book.sizeUnit, "unknown");
  const print = normalizeTradierPrint({
    type: "timesale",
    last: "282.09",
    size: "100",
    bid: "282.08",
    ask: "282.09",
    date: "1557758874355",
  });
  assert.equal(print.lastTradePrice, 282.09);
  assert.equal(print.lastTradeSize, 100);
  assert.equal(print.lastTradeBid, 282.08);
  assert.equal(print.feed, "timesale");
});

test("Alpaca stock bid and ask size survives normalization in the documented unit", () => {
  const current = normalizeAlpacaStockBook({
    bp: 100,
    ap: 100.02,
    bs: 4,
    as: 8,
    bx: "N",
    ax: "Q",
    t: "2026-09-25T14:00:00.000Z",
  }, "2026-09-25T14:00:00.000Z");
  assert.equal(current.bidSizeShares, 4);
  assert.equal(current.askSizeShares, 8);
  assert.equal(current.sizeUnit, "shares");
  assert.equal(current.bidExchange, "N");
  const historical = normalizeAlpacaStockBook({
    bs: 4,
    as: 8,
  }, "2025-10-01T14:00:00.000Z");
  assert.equal(historical.bidSizeShares, 400);
  assert.equal(historical.sizeUnit, "round_lots");
  const crypto = normalizeAlpacaCryptoBook({ bp: 100, ap: 100.1, bs: 1.5, as: 2 });
  assert.equal(crypto.bidSizeShares, 1.5);
  assert.equal(crypto.sizeUnit, "base_units");
});

test("fitting the displayed touch does not set market impact to zero", () => {
  const shadow = buildExecutionEconomicsShadow({
    assetClass: "stock",
    bid: 100,
    ask: 100.1,
    askSizeShares: 800,
    intendedShares: 500,
  });
  assert.equal(shadow.depthSlippageStatus, "LOWER_BOUND_ZERO");
  assert.equal(shadow.depthSlippagePct, null);
  assert.equal(shadow.marketImpactPct, null);
  assert.equal(shadow.marketImpactStatus, "UNKNOWN");
  assert.equal(shadow.executionCostEstimate.expectedTotalCost, null);
});

test("an order larger than top of book without depth leaves slippage unknown", () => {
  const shadow = buildExecutionEconomicsShadow({
    assetClass: "stock",
    bid: 100,
    ask: 100.1,
    askSizeShares: 500,
    intendedShares: 2000,
  });
  assert.equal(shadow.depthSlippageStatus, "UNKNOWN");
  assert.equal(shadow.depthSlippagePct, null);
  assert.equal(shadow.executionCostEstimate.slippageKnown, false);
});

test("a crypto book walk slippage depends on the order size", () => {
  const now = Date.parse("2026-09-25T14:00:00.000Z");
  const cryptoOrderbook = {
    source: "alpaca_crypto_orderbook",
    location: "us",
    symbol: "BTC/USD",
    updatedAt: new Date(now).toISOString(),
    bids: [{ p: 99.9, s: 5 }, { p: 99, s: 5 }],
    asks: [{ p: 100, s: 0.5 }, { p: 101, s: 5 }],
  };
  const small = assessCryptoOrderLiquidity(cryptoOrderbook, { symbol: "BTC/USD", notional: 40, now });
  const large = assessCryptoOrderLiquidity(cryptoOrderbook, { symbol: "BTC/USD", notional: 200, now });
  assert.ok(large.buySlippagePercent > small.buySlippagePercent);
  const shadow = buildExecutionEconomicsShadow({
    symbol: "BTC/USD",
    assetClass: "crypto",
    bid: 99.9,
    ask: 100,
    cryptoOrderbook,
    intendedOrderDollars: 200,
    now,
  });
  assert.equal(shadow.depthSlippageStatus, "BOOK_WALK");
  assert.ok(shadow.depthSlippagePct > 0);
});

test("a measured wide spread still fails the existing execution limit", () => {
  assert.equal(STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent, 1);
  assert.equal(CRYPTO_MAX_ENTRY_SPREAD_PERCENT, 0.85);
  const now = new Date().toISOString();
  const gate = evaluateStockTradeCandidate({
    masterFinalScore: 80,
    stockDecisionScore: 80,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 80,
    entryQualityScorecard: { approved: true, coverage: 1 },
    centralAutonomousAction: "ALLOW",
    bid: 99.4,
    ask: 100.6,
    spreadPercent: 1.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
  }, { requireCentralDecision: true });
  assert.equal(gate.approved, false);
  assert.ok(gate.reasons.includes("SPREAD_ABOVE_EXECUTION_LIMIT"));
  assert.equal(gate.finalScore, 80);
  assert.equal(gate.entryScore, 80);
});

test("gross continuation reward to risk can fall below 1.5 after the ask", () => {
  const result = estimateLongRewardRisk({
    price: 101,
    target: 104,
    stop: 99,
    ask: 101.4,
    feesPct: 0,
  });
  assert.equal(result.grossRewardRisk, 1.5);
  assert.ok(result.netEstimatedRewardRisk < 1.5);
  assert.ok(Math.abs(result.netEstimatedRewardRisk - 1.0833) < 0.001);
});

test("the unused spread penalty is shadow-only and spread is not charged twice in Entry", () => {
  const tight = calculateEntryQualityScore({
    ...entryBase,
    bid: 10,
    ask: 10.02,
    phase5SignalQuality: { ...entryBase.phase5SignalQuality, spreadWideningRisk: 8 },
  });
  const wideRisk = calculateEntryQualityScore({
    ...entryBase,
    bid: 10,
    ask: 10.02,
    phase5SignalQuality: { ...entryBase.phase5SignalQuality, spreadWideningRisk: 80 },
  });
  const wideBook = calculateEntryQualityScore({
    ...entryBase,
    bid: 99.4,
    ask: 100.6,
    phase5SignalQuality: { ...entryBase.phase5SignalQuality, spreadWideningRisk: 80 },
  });
  assert.equal(tight.spreadPenalty, undefined);
  assert.equal(tight.executionEconomicsShadow.legacyPercentPenalty.role, "SHADOW_ONLY");
  assert.equal(tight.executionEconomicsShadow.legacyPercentPenalty.productionEffect, false);
  assert.equal(tight.score, wideRisk.score);
  assert.equal(tight.score, wideBook.score);
  assert.equal(wideBook.spreadTooWide, true);
  assert.equal(tight.entryFamilyShadow.families.execution.inputs.filter((item) => item.id === "spread").length, 1);
});

test("a buy fill stores the arrival midpoint and the post-trade effective spread", () => {
  const measured = annotateFillExecution({
    side: "buy",
    fillPrice: 100.5,
    midpointAtArrival: 100,
    fillQuantity: 100,
  });
  assert.equal(measured.midpointAtArrival, 100);
  assert.equal(measured.effectiveSpreadPct, 1);
  assert.equal(measured.oneWayExecutionCostPct, 0.5);
  assert.equal(measured.effectiveSpreadStatus, "MEASURED");
  const unread = annotateFillExecution({ side: "buy", fillPrice: 100.5 });
  assert.equal(unread.effectiveSpreadPct, null);
  assert.equal(unread.effectiveSpreadStatus, "UNKNOWN");
});
