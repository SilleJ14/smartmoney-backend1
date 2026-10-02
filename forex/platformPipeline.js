import { createEvidenceSnapshot } from "./evidenceSnapshot.js";
import { buildForexContext } from "./features/index.js";
import {
  calculateForexExpectedValue,
  decideForexAction,
  estimateComparableSetupProbability,
  scoreForexOpportunity,
} from "./forexDecision.js";
import { assessPortfolioRisk } from "./portfolioRisk.js";

const finite = value => typeof value === "number" && Number.isFinite(value);

function candle(row) {
  if (!row) return null;
  const high = Number(row.high ?? row.h);
  const low = Number(row.low ?? row.l);
  const close = Number(row.close ?? row.c);
  return finite(high) && finite(low) && finite(close) ? { high, low, close } : null;
}

function candles(rows) {
  if (!Array.isArray(rows)) return null;
  const normalized = rows.map(candle);
  return normalized.every(Boolean) ? normalized : null;
}

function closes(rows) {
  return candles(rows)?.map(row => row.close) ?? null;
}

function directionScore(direction, side, neutral = 50) {
  if (!direction || direction === "flat" || direction === "mixed" || direction === "none") return neutral;
  const favorable = side === "BUY" ? ["up", "long"] : ["down", "short"];
  return favorable.includes(direction) ? 100 : 0;
}

function featureScores(features, side) {
  const value = features?.evidence?.features || {};
  const technical = value.technicalRegime?.evidence;
  const multi = value.multiTimeframe?.evidence;
  const structure = value.marketStructure?.evidence;
  const momentum = value.momentum?.evidence;
  const rates = value.rates?.evidence;
  const macro = value.macro?.evidence;
  const carry = value.carry?.evidence;
  const positioning = value.positioning?.evidence;
  const futures = value.futures?.evidence;
  const liquidity = value.liquidity?.evidence;
  const session = value.sessions?.evidence;
  const pair = rates?.base && rates?.quote ? [rates.base, rates.quote] : null;
  const macroDifference = pair && finite(macro?.aggregate?.[pair[0]]) && finite(macro?.aggregate?.[pair[1]])
    ? macro.aggregate[pair[0]] - macro.aggregate[pair[1]] : null;
  return {
    trend: { value: technical ? directionScore(technical.trend, side) : null, weight: 2 },
    timeframeAlignment: {
      value: multi ? (multi.aligned ? directionScore(multi.alignment, side) : 40) : null,
      weight: 2,
    },
    structure: { value: structure ? directionScore(structure.breakDirection, side) : null, weight: 1.5 },
    momentum: {
      value: momentum
        ? directionScore(momentum.direction, side) * (0.5 + 0.5 * Number(momentum.persistence || 0))
        : null,
      weight: 1.5,
    },
    rateDifferential: {
      value: rates ? directionScore(rates.differential > 0 ? "long" : rates.differential < 0 ? "short" : "flat", side) : null,
      weight: 1,
    },
    macroSurprise: {
      value: finite(macroDifference)
        ? directionScore(macroDifference > 0 ? "long" : macroDifference < 0 ? "short" : "flat", side)
        : null,
      weight: 1,
    },
    carry: { value: carry ? (carry.conditionsMet && directionScore(carry.direction, side) === 100 ? 100 : 25) : null, weight: 1 },
    positioning: { value: finite(positioning?.percentile) ? positioning.percentile * 100 : null, weight: 0.5 },
    futures: { value: futures ? (futures.confirmed ? 100 : futures.directionConfirmed ? 60 : 20) : null, weight: 0.5 },
    liquidity: { value: liquidity ? (liquidity.tradeable ? 100 : 0) : null, weight: 2 },
    session: { value: session ? (session.active.length ? (session.overlap ? 100 : 75) : 20) : null, weight: 0.5 },
  };
}

function providerRecord(provider, fallbackName, asOf) {
  if (provider?.state && provider?.provenance) {
    return {
      ...provider,
      // The provider cache retains the full bounded history. A decision
      // snapshot stores only the most recent observations needed for replay.
      observations: Array.isArray(provider.observations)
        ? provider.observations.slice(0, 100)
        : [],
    };
  }
  return {
    state: "UNAVAILABLE",
    ageMs: null,
    observations: [],
    provenance: { provider: fallbackName, sourceUrl: null, observedAt: asOf },
    error: provider?.error || "PROVIDER_NOT_CONFIGURED",
  };
}

function outcomeRows(journal, entityId) {
  if (!journal?.listEvents) return [];
  try {
    return journal.listEvents({ type: "OUTCOME", entityId, limit: 1000 })
      .map(row => row.payload || {});
  } catch {
    return [];
  }
}

export function runCanonicalForexPipeline({
  instrument,
  side,
  asOf,
  quote,
  bars = {},
  pairReturns,
  providerContext = {},
  allowedPairs = [],
  strategyId,
  strategyApproved,
  calendarClear,
  spreadAcceptable,
  intendedSize = 0,
  portfolioRisk = {},
  calibration = null,
  measuredSlippageR = null,
  financingR = null,
  rewardR = null,
  journal,
  persistSnapshot = true,
  configHash,
} = {}) {
  const decisionTime = new Date(asOf).toISOString();
  const compact = String(instrument || "").replace(/[^A-Z]/gi, "").toUpperCase();
  const base = compact.slice(0, 3) || null;
  const quoteCurrency = compact.slice(3, 6) || null;
  const quoteAgeMs = Number.isFinite(Date.parse(quote?.time || ""))
    ? asOf - Date.parse(quote.time) : null;
  const context = buildForexContext({
    asOf: decisionTime,
    pairReturns,
    rates: {
      base,
      quote: quoteCurrency,
      yields: providerContext.rates?.yields,
      expectedChanges: providerContext.rates?.expectedChanges,
    },
    macroEvents: providerContext.macroEvents,
    candles: candles(bars.m15),
    closes: closes(bars.m15),
    timeframes: {
      D: closes(bars.daily),
      H4: closes(bars.h4),
      H1: closes(bars.h1),
      M15: closes(bars.m15),
      M5: closes(bars.m5),
    },
    positioning: providerContext.positioning?.[base] ?? providerContext.positioning,
    futures: providerContext.futures?.[base] ?? providerContext.futures,
    crossMarkets: providerContext.crossMarkets,
    liquidity: {
      bid: quote?.bid,
      ask: quote?.ask,
      bidSize: quote?.bidSize,
      askSize: quote?.askSize,
      depthBid: null,
      depthAsk: null,
      intendedSize: Math.abs(Number(intendedSize) || 0),
      quoteAgeMs,
    },
    orderFlow: { providerTier: "LOW_COST_TOP_OF_BOOK" },
    carry: { base, quote: quoteCurrency },
    allowedPairs,
    strengths: providerContext.currencyStrengths,
    pairLiquidity: providerContext.pairLiquidity,
  });
  const score = scoreForexOpportunity(featureScores(context, side));
  const regime = context.evidence?.features?.technicalRegime?.evidence;
  const sessions = context.evidence?.features?.sessions?.evidence?.active || [];
  const bucket = `${strategyId || "UNKNOWN"}:${regime?.mode || "unknown"}:${sessions.join("+") || "closed"}:${side}`;
  const probability = estimateComparableSetupProbability({
    outcomes: outcomeRows(journal, instrument),
    bucket,
    cutoff: decisionTime,
    calibration,
  });
  const stopR = 1;
  const spreadR = finite(quote?.spreadR) ? quote.spreadR : null;
  const expectedValue = calculateForexExpectedValue({
    probability: probability.calibrationApplied ? probability.probability : null,
    reward: rewardR,
    loss: stopR,
    spreadCost: spreadR,
    slippageCost: measuredSlippageR,
    financingCost: financingR,
    units: "R_MULTIPLE",
  });
  const risk = assessPortfolioRisk(portfolioRisk);
  const liquidity = context.evidence?.features?.liquidity;
  const dataFresh = quoteAgeMs !== null && quoteAgeMs >= 0 && quoteAgeMs <= 2000 &&
    ["available", "partial"].includes(context.state);
  const action = decideForexAction({
    side,
    dataFresh,
    calendarClear,
    liquidityAdequate: liquidity?.evidence?.tradeable,
    spreadAcceptable,
    evPositive: finite(expectedValue.expectedValue) ? expectedValue.expectedValue > 0 : undefined,
    riskApproved: risk.approved,
    strategyApproved,
  });
  const providers = {
    oandaPricing: {
      state: dataFresh ? "FRESH" : quoteAgeMs === null ? "MALFORMED" : "STALE",
      ageMs: quoteAgeMs,
      observations: [{ bid: quote?.bid ?? null, ask: quote?.ask ?? null, bidSize: quote?.bidSize ?? null, askSize: quote?.askSize ?? null }],
      provenance: { provider: "OANDA_PRACTICE", sourceUrl: null, observedAt: quote?.time || decisionTime },
      error: dataFresh ? null : "QUOTE_NOT_FRESH",
    },
    fred: providerRecord(providerContext.providers?.fred, "FRED/ALFRED", decisionTime),
    cftc: providerRecord(providerContext.providers?.cftc, "CFTC_TFF_SOCRATA", decisionTime),
    cme: providerRecord(providerContext.providers?.cme, "CME_DELAYED", decisionTime),
    finnhub: providerRecord(providerContext.providers?.finnhub, "FINNHUB_MACRO", decisionTime),
    institutionalDepth: {
      state: "UNAVAILABLE",
      ageMs: null,
      observations: [],
      provenance: { provider: "LOW_COST_PROVIDER_TIER", sourceUrl: null, observedAt: decisionTime },
      error: "UNAVAILABLE_PROVIDER_TIER",
    },
  };
  const evidence = createEvidenceSnapshot({
    capturedAt: decisionTime,
    decisionTime,
    instrument,
    providers,
    market: { quote, bars },
    context: { features: context, score, probability, expectedValue, risk, action, bucket },
  });
  let evidenceSnapshotId = null;
  if (persistSnapshot && journal?.recordSnapshot) {
    const stored = journal.recordSnapshot({
      observedAt: quote?.time || decisionTime,
      decisionAt: decisionTime,
      entityId: instrument,
      configHash,
      payload: evidence,
    });
    evidenceSnapshotId = stored.snapshotId;
  }
  return Object.freeze({
    evidence,
    evidenceSnapshotId,
    features: context,
    opportunityScore: score,
    probability,
    expectedValue,
    portfolioRisk: risk,
    decision: action,
    regime: regime || null,
    providerLimitations: ["INSTITUTIONAL_L2_UNAVAILABLE", "CME_DELAYED_ONLY"],
  });
}
