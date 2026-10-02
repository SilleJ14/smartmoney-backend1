import { featureResult } from "./core.js";
import {
  analyzeCarry,
  analyzeMacroSurprises,
  analyzeRateDifferential,
  analyzeTffPositioning,
  rankCurrencyStrength,
} from "./fundamentals.js";
import {
  analyzeMarketStructure,
  analyzeMomentum,
  analyzeMultiTimeframe,
  analyzeTechnicalRegime,
  analyzeVolatility,
} from "./technicals.js";
import {
  analyzeCrossMarket,
  analyzeFuturesConfirmation,
  analyzeLiquidity,
  analyzeOrderFlow,
  analyzeTradingSessions,
  selectStrongWeakPair,
} from "./marketContext.js";

export * from "./core.js";
export * from "./fundamentals.js";
export * from "./technicals.js";
export * from "./marketContext.js";

export function buildForexContext(input = {}) {
  const currencyStrength = rankCurrencyStrength(input.pairReturns);
  const rates = analyzeRateDifferential(input.rates);
  const macro = analyzeMacroSurprises(input.macroEvents);
  const technicalRegime = analyzeTechnicalRegime(input.candles, input.technicalOptions);
  const multiTimeframe = analyzeMultiTimeframe(input.timeframes);
  const marketStructure = analyzeMarketStructure(input.candles, input.structureOptions);
  const momentum = analyzeMomentum(input.closes ?? input.candles?.map((row) => row.close), input.momentumOptions);
  const volatility = analyzeVolatility(input.candles, input.volatilityOptions);
  const liquidity = analyzeLiquidity(input.liquidity);
  const orderFlow = analyzeOrderFlow(input.orderFlow);
  const carry = analyzeCarry({
    ...input.carry,
    base: input.carry?.base ?? input.rates?.base,
    quote: input.carry?.quote ?? input.rates?.quote,
    rateDifferential: input.carry?.rateDifferential ?? rates.evidence?.differential,
    trend: input.carry?.trend ?? technicalRegime.evidence?.trend,
    volatility: input.carry?.volatility ?? technicalRegime.evidence?.volatilityRegime,
    liquidity: input.carry?.liquidity ?? liquidity.evidence,
  });
  const positioning = analyzeTffPositioning(input.positioning);
  const futures = analyzeFuturesConfirmation(input.futures);
  const crossMarket = analyzeCrossMarket(input.crossMarkets);
  const sessions = analyzeTradingSessions(input.asOf);
  const pairSelection = selectStrongWeakPair({
    strengths: input.strengths ?? currencyStrength.evidence?.strengths,
    allowedPairs: input.allowedPairs,
    liquidity: input.pairLiquidity,
  });
  const features = {
    currencyStrength,
    rates,
    macro,
    technicalRegime,
    multiTimeframe,
    marketStructure,
    momentum,
    volatility,
    carry,
    positioning,
    futures,
    crossMarket,
    sessions,
    liquidity,
    orderFlow,
    pairSelection,
  };
  const unavailableFeatures = Object.entries(features)
    .filter(([, result]) => !result.available)
    .map(([name]) => name);
  return featureResult({
    evidence: { asOf: input.asOf ?? null, features },
    missing: unavailableFeatures.map((name) => `features.${name}`),
    reasons: unavailableFeatures.length ? ["INCOMPLETE_FOREX_CONTEXT"] : [],
    state: unavailableFeatures.length ? "partial" : "available",
  });
}
