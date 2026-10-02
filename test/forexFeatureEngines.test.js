import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCarry,
  analyzeCrossMarket,
  analyzeFuturesConfirmation,
  analyzeLiquidity,
  analyzeMacroSurprises,
  analyzeMarketStructure,
  analyzeMomentum,
  analyzeMultiTimeframe,
  analyzeRateDifferential,
  analyzeTechnicalRegime,
  analyzeTffPositioning,
  analyzeTradingSessions,
  analyzeVolatility,
  buildForexContext,
  rankCurrencyStrength,
  selectStrongWeakPair,
} from "../forex/features/index.js";

const currencies = ["USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "NZD"];
const knownStrengths = { USD: 0.2, EUR: 0.5, JPY: -0.4, GBP: 0.3, AUD: 0.1, CAD: -0.1, CHF: 0, NZD: -0.2 };
const pairReturns = currencies.slice(1).map((currency) => ({
  pair: `${currency}USD`,
  return: knownStrengths[currency] - knownStrengths.USD,
}));

function candles(count = 30) {
  return Array.from({ length: count }, (_, index) => {
    const close = 1 + index * 0.002 + Math.sin(index * Math.PI / 2) * 0.003;
    return { high: close + 0.004, low: close - 0.004, close };
  });
}

test("eight-currency strength is an independent connected least-squares ranking", () => {
  const result = rankCurrencyStrength([...pairReturns, { pair: "bad", return: "x" }]);
  assert.equal(result.available, true);
  assert.equal(result.evidence.ranking[0].currency, "EUR");
  assert.equal(result.evidence.ranking.at(-1).currency, "JPY");
  assert.ok(result.evidence.residualRmse < 1e-12);
  assert.ok(Math.abs(Object.values(result.evidence.strengths).reduce((a, b) => a + b, 0)) < 1e-12);
  assert.deepEqual(result.reasons, ["MALFORMED_OBSERVATIONS_IGNORED"]);

  const disconnected = rankCurrencyStrength([{ pair: "EURUSD", return: 0.1 }]);
  assert.equal(disconnected.available, false);
  assert.equal(disconnected.evidence, null);
  assert.ok(disconnected.reasons.includes("DISCONNECTED_CURRENCY_GRAPH"));
});

test("rates, macro surprise, carry, and TFF positioning preserve raw evidence", () => {
  const rates = analyzeRateDifferential({ base: "EUR", quote: "JPY", yields: { EUR: 3, JPY: 0.5 } });
  assert.equal(rates.evidence.differential, 2.5);
  assert.equal(rates.evidence.advantage, "EUR");

  const macro = analyzeMacroSurprises([
    { id: "cpi", currency: "USD", actual: 3.2, estimate: 3, historicalScale: 0.1 },
    { id: "claims", currency: "USD", actual: 210, estimate: 200, historicalScale: 5, higherIsPositive: false },
  ]);
  assert.ok(Math.abs(macro.evidence.aggregate.USD) < 1e-12);
  assert.ok(Math.abs(macro.evidence.events[0].normalizedSurprise - 2) < 1e-12);
  assert.equal(macro.evidence.events[1].normalizedSurprise, -2);

  const carry = analyzeCarry({
    base: "EUR", quote: "JPY", rateDifferential: 2.5,
    trend: "up", volatility: "normal", liquidity: { tradeable: true },
  });
  assert.equal(carry.evidence.conditionsMet, true);
  assert.equal(carry.evidence.direction, "long");

  const positioning = analyzeTffPositioning({ current: 30, history: [10, 20, 30, 40] });
  assert.equal(positioning.evidence.percentile, 0.75);
  assert.ok(positioning.evidence.zscore > 0);
});

test("technical regime, five timeframes, momentum, and volatility are deterministic", () => {
  const rows = candles();
  const regime = analyzeTechnicalRegime(rows);
  assert.equal(regime.available, true);
  assert.equal(regime.evidence.trend, "up");
  assert.ok(["none", "up"].includes(regime.evidence.breakout));

  const timeframes = Object.fromEntries(["D", "H4", "H1", "M15", "M5"].map((key) => [key, [1, 2, 3, 4]]));
  const multi = analyzeMultiTimeframe(timeframes);
  assert.deepEqual(multi.evidence.trends, { D: "up", H4: "up", H1: "up", M15: "up", M5: "up" });
  assert.equal(multi.evidence.aligned, true);

  const momentum = analyzeMomentum([100, 101, 102, 104, 107, 111]);
  assert.equal(momentum.evidence.direction, "up");
  assert.ok(momentum.evidence.acceleration > 0);
  assert.equal(momentum.evidence.persistence, 1);

  const volatility = analyzeVolatility(rows);
  assert.equal(volatility.available, true);
  assert.ok(volatility.evidence.atr > 0);
  assert.ok(volatility.evidence.realizedVolatility > 0);
  assert.ok(["expansion", "contraction", "stable"].includes(volatility.evidence.regime));
  assert.deepEqual(analyzeVolatility(rows), volatility);
});

test("market structure identifies pivots, support, resistance, and breaks", () => {
  const closes = [10, 12, 9, 13, 10, 14, 11, 15];
  const rows = closes.map((close) => ({ high: close + 0.4, low: close - 0.4, close }));
  const structure = analyzeMarketStructure(rows);
  assert.equal(structure.available, true);
  assert.ok(structure.evidence.highs.some((point) => point.label === "HH"));
  assert.ok(structure.evidence.lows.some((point) => point.label === "HL"));
  assert.equal(structure.evidence.breakDirection, "up");
  assert.equal(typeof structure.evidence.retest, "boolean");
});

test("delayed CME confirmation is explicit and does not hide participation", () => {
  const result = analyzeFuturesConfirmation({
    spotDirection: "up",
    previous: { price: 100, volume: 1000, openInterest: 500 },
    current: { price: 101, volume: 1200, openInterest: 550 },
    asOf: "2026-07-01T12:00:00.000Z",
    now: "2026-07-01T12:30:00.000Z",
    maxDelayMinutes: 20,
  });
  assert.equal(result.available, true);
  assert.equal(result.state, "delayed");
  assert.equal(result.evidence.delayed, true);
  assert.equal(result.evidence.confirmed, true);
  assert.ok(result.reasons.includes("DELAYED_CME_DATA"));
});

test("cross-market context and DST-safe sessions expose observations without scoring", () => {
  const context = analyzeCrossMarket([
    { id: "DXY", value: 101, previous: 100 },
    { id: "US10Y", value: 4.2, previous: 4.1 },
  ]);
  assert.equal(context.evidence.DXY.direction, "up");
  assert.ok(Math.abs(context.evidence.DXY.change - 0.01) < 1e-12);
  assert.equal("score" in context.evidence, false);

  const summer = analyzeTradingSessions("2026-07-01T12:30:00.000Z");
  assert.equal(summer.evidence.sessions.london.open, true);
  assert.equal(summer.evidence.sessions.newYork.open, true);
  assert.equal(summer.evidence.overlap, true);
  const winter = analyzeTradingSessions("2026-01-07T13:30:00.000Z");
  assert.equal(winter.evidence.sessions.london.open, true);
  assert.equal(winter.evidence.sessions.newYork.open, true);
});

test("liquidity keeps spread, quote liquidity, depth, and tradeability separate", () => {
  const liquid = analyzeLiquidity({
    bid: 1, ask: 1.0002, bidSize: 4, askSize: 3, depthBid: 12, depthAsk: 10, quoteAgeMs: 100,
    maxSpreadBps: 3, minQuoteSize: 2, minDepth: 5,
  });
  assert.equal(liquid.evidence.tradeable, true);
  assert.equal(liquid.evidence.quoteLiquidity, 3);
  assert.equal(liquid.evidence.depth, 10);
  assert.ok(liquid.evidence.spreadBps < 3);

  const stale = analyzeLiquidity({
    bid: 1, ask: 1.0002, bidSize: 4, askSize: 3, depthBid: 12, depthAsk: 10, quoteAgeMs: 5000,
  });
  assert.equal(stale.evidence.tradeable, false);
  assert.ok(stale.reasons.includes("STALE_QUOTE"));
});

test("strong-vs-weak selection respects allowed pairs and tradeability", () => {
  const selected = selectStrongWeakPair({
    strengths: knownStrengths,
    allowedPairs: ["EURJPY", "GBPJPY", "EURUSD"],
    liquidity: { EURJPY: { tradeable: false }, GBPJPY: { tradeable: true }, EURUSD: { tradeable: true } },
  });
  assert.deepEqual(selected.evidence.selected, {
    pair: "GBPJPY", direction: "long", strong: "GBP", weak: "JPY", strengthDifference: 0.7,
  });
});

test("every engine returns explicit unavailable state and null evidence for absent or malformed data", () => {
  const unavailableResults = [
    rankCurrencyStrength(null),
    analyzeRateDifferential({}),
    analyzeMacroSurprises([{ actual: "bad" }]),
    analyzeTechnicalRegime([{ high: 1 }]),
    analyzeMultiTimeframe({ D: [1, 2] }),
    analyzeMarketStructure([]),
    analyzeMomentum([1]),
    analyzeVolatility(null),
    analyzeCarry({}),
    analyzeTffPositioning({ current: "bad", history: [] }),
    analyzeFuturesConfirmation({}),
    analyzeCrossMarket([{ id: "DXY", value: "bad" }]),
    analyzeTradingSessions("not-a-date"),
    analyzeLiquidity({ bid: 1 }),
    selectStrongWeakPair({}),
  ];
  for (const result of unavailableResults) {
    assert.equal(result.available, false);
    assert.equal(result.state, "unavailable");
    assert.equal(result.evidence, null);
    assert.ok(result.missing.length > 0);
    assert.ok(result.reasons.length > 0);
  }
});

test("aggregator builds one stable context without probabilities or implicit clock reads", () => {
  const input = {
    asOf: "2026-07-01T12:30:00.000Z",
    pairReturns,
    rates: { base: "EUR", quote: "JPY", yields: { EUR: 3, JPY: 0.5 } },
    macroEvents: [{ currency: "EUR", actual: 2, estimate: 1, historicalScale: 0.5 }],
    candles: candles(),
    timeframes: Object.fromEntries(["D", "H4", "H1", "M15", "M5"].map((key) => [key, [1, 2, 3]])),
    liquidity: { bid: 1, ask: 1.0002, bidSize: 4, askSize: 3, depthBid: 12, depthAsk: 10, quoteAgeMs: 100 },
    positioning: { current: 3, history: [1, 2, 3, 4] },
    futures: {
      spotDirection: "up",
      previous: { price: 100, volume: 100, openInterest: 100 },
      current: { price: 101, volume: 110, openInterest: 105 },
      asOf: "2026-07-01T12:20:00.000Z",
      now: "2026-07-01T12:30:00.000Z",
    },
    crossMarkets: [{ id: "DXY", value: 100, previous: 99 }],
    allowedPairs: ["EURJPY", "GBPJPY"],
  };
  const first = buildForexContext(input);
  const second = buildForexContext(input);
  assert.deepEqual(first, second);
  assert.equal(first.evidence.asOf, input.asOf);
  assert.equal(Object.keys(first.evidence.features).length, 16);
  assert.deepEqual(first.evidence.features.orderFlow.reasons, ["UNAVAILABLE_PROVIDER_TIER"]);
  assert.equal(JSON.stringify(first).includes("probability"), false);
  assert.equal(JSON.stringify(first).includes('"score"'), false);
});
