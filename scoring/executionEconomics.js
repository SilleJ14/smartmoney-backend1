import { assessCryptoOrderLiquidity } from "./cryptoOrderLiquidity.js";

// Shadow only. Quoted spread and the one-way cross are different numbers.
// Unknown slippage or impact stays unknown. It is not zero.
// The 1% stock gate and the 0.85% crypto gate are not decided here.

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function quotedSpreadFromBook(bid, ask) {
  const bidPrice = finite(bid);
  const askPrice = finite(ask);
  if (bidPrice === null || askPrice === null || bidPrice <= 0 || askPrice < bidPrice) {
    return { midpoint: null, quotedSpreadPct: null, halfSpreadPct: null };
  }
  const midpoint = (bidPrice + askPrice) / 2;
  const quotedSpreadPct = midpoint > 0 ? ((askPrice - bidPrice) / midpoint) * 100 : null;
  return {
    midpoint,
    quotedSpreadPct: round(quotedSpreadPct),
    halfSpreadPct: round(quotedSpreadPct === null ? null : quotedSpreadPct / 2),
  };
}

export function spreadWideningRiskFromQuote(signal = {}) {
  if (signal.spreadAvailable === false || signal.bookAvailable === false) return null;
  const book = quotedSpreadFromBook(signal.bid ?? signal.bidPrice, signal.ask ?? signal.askPrice);
  if (book.quotedSpreadPct !== null) return Math.max(0, Math.min(100, book.quotedSpreadPct * 20));
  if (signal.spreadAvailable === true && finite(signal.spreadPercent) !== null && finite(signal.spreadPercent) >= 0) {
    return Math.max(0, Math.min(100, finite(signal.spreadPercent) * 20));
  }
  return null;
}

function feeTerms(signal, assetClass) {
  if (finite(signal.feesPct) !== null) {
    return { feesPct: round(finite(signal.feesPct), 4), feesKnown: true, feesBasis: signal.feesBasis || "PROVIDED" };
  }
  if (assetClass === "stock") {
    return { feesPct: 0, feesKnown: true, feesBasis: "STOCK_COMMISSION_NOT_CHARGED" };
  }
  return { feesPct: null, feesKnown: false, feesBasis: "UNKNOWN" };
}

export function estimateLongRewardRisk({
  price = null,
  target = null,
  stop = null,
  ask = null,
  feesPct = 0,
} = {}) {
  const last = finite(price);
  const targetPrice = finite(target);
  const stopPrice = finite(stop);
  const entry = finite(ask);
  const feeRate = finite(feesPct) ?? 0;
  const grossReward = last !== null && targetPrice !== null ? targetPrice - last : null;
  const grossRisk = last !== null && stopPrice !== null ? last - stopPrice : null;
  const grossRewardRisk = grossReward !== null && grossRisk > 0 ? round(grossReward / grossRisk, 4) : null;
  if (entry === null || targetPrice === null || stopPrice === null) {
    return {
      expectedEntryFill: entry,
      expectedTargetExitFill: targetPrice,
      expectedStopExitFill: stopPrice,
      grossRewardRisk,
      netEstimatedRewardRisk: null,
    };
  }
  const fee = entry * (feeRate / 100);
  const netReward = targetPrice - entry - fee;
  const netRisk = entry - stopPrice + fee;
  return {
    expectedEntryFill: round(entry, 4),
    expectedTargetExitFill: round(targetPrice, 4),
    expectedStopExitFill: round(stopPrice, 4),
    grossRewardRisk,
    netReward: round(netReward, 4),
    netRisk: round(netRisk, 4),
    netEstimatedRewardRisk: netRisk > 0 ? round(netReward / netRisk, 4) : null,
  };
}

export function buildExecutionEconomicsShadow(signal = {}, {
  measuredSpread = null,
  legacyPercentPenalty = null,
} = {}) {
  const assetClass = signal.assetClass || (String(signal.symbol || "").includes("/") ? "crypto" : "stock");
  const bid = finite(signal.bidPrice ?? signal.bid ?? signal.liveQuote?.bid);
  const ask = finite(signal.askPrice ?? signal.ask ?? signal.liveQuote?.ask);
  const book = quotedSpreadFromBook(bid, ask);
  const quotedSpreadPct = book.quotedSpreadPct ?? (finite(measuredSpread) !== null ? round(finite(measuredSpread)) : null);
  const halfSpreadPct = book.halfSpreadPct ?? (quotedSpreadPct === null ? null : round(quotedSpreadPct / 2));
  const bidSizeShares = finite(signal.bidSizeShares);
  const askSizeShares = finite(signal.askSizeShares);
  const intendedOrderDollars = finite(signal.intendedOrderDollars ?? signal.finalApprovedTradeAmount);
  const intendedShares = finite(signal.intendedShares) ?? (
    intendedOrderDollars !== null && book.midpoint
      ? intendedOrderDollars / book.midpoint
      : null
  );
  const touchCapacityRatio = intendedShares > 0 && askSizeShares !== null
    ? round(askSizeShares / intendedShares, 4)
    : null;
  let depthSlippagePct = null;
  let depthSlippageStatus = "UNKNOWN";
  if (assetClass === "crypto" && signal.cryptoOrderbook && intendedOrderDollars > 0) {
    const walked = assessCryptoOrderLiquidity(signal.cryptoOrderbook, {
      symbol: signal.symbol,
      notional: intendedOrderDollars,
      now: finite(signal.now) ?? Date.now(),
    });
    if (walked.available && Number.isFinite(walked.buySlippagePercent)) {
      depthSlippagePct = round(walked.buySlippagePercent);
      depthSlippageStatus = "BOOK_WALK";
    }
  } else if (intendedShares > 0 && askSizeShares !== null) {
    depthSlippageStatus = intendedShares <= askSizeShares ? "LOWER_BOUND_ZERO" : "UNKNOWN";
  }
  const fees = feeTerms(signal, assetClass);
  const marketImpactPct = null;
  const marketImpactStatus = "UNKNOWN";
  const knownParts = [
    halfSpreadPct !== null,
    fees.feesKnown,
  ];
  const knownCostLowerBound = halfSpreadPct === null
    ? null
    : round(halfSpreadPct + (fees.feesKnown ? fees.feesPct : 0));
  const totalKnown = halfSpreadPct !== null
    && fees.feesKnown
    && depthSlippagePct !== null
    && marketImpactPct !== null;
  const reward = estimateLongRewardRisk({
    price: signal.price ?? signal.current,
    target: signal.targetPrice ?? signal.continuationSetup?.observedTarget,
    stop: signal.stopPrice ?? signal.continuationSetup?.structuralStop,
    ask,
    feesPct: fees.feesKnown ? fees.feesPct : 0,
  });
  return {
    mode: "SHADOW",
    replacesProductionEntry: false,
    executionCostEstimate: {
      quotedSpreadPct,
      halfSpreadPct,
      touchCapacity: askSizeShares,
      touchCapacityRatio,
      touchCoverage: askSizeShares === null ? "UNKNOWN" : "TOP_OF_BOOK",
      slippagePastTouch: depthSlippagePct,
      slippageKnown: depthSlippagePct !== null,
      depthSlippagePct,
      depthSlippageStatus,
      fees: fees.feesPct,
      feesKnown: fees.feesKnown,
      feesBasis: fees.feesBasis,
      marketImpact: marketImpactPct,
      marketImpactKnown: false,
      marketImpactPct,
      marketImpactStatus,
      knownCost: knownCostLowerBound,
      knownCostLowerBound,
      expectedTotalCost: totalKnown ? knownCostLowerBound : null,
      costCoverage: totalKnown ? "COMPLETE" : knownParts.some(Boolean) ? "PARTIAL" : "NONE",
      notInKnownCost: [
        ...(depthSlippagePct === null ? ["DEPTH_SLIPPAGE"] : []),
        ...(!fees.feesKnown ? ["FEES"] : assetClass === "stock" ? ["REGULATORY_SELL_FEES"] : []),
        "MARKET_IMPACT",
      ],
    },
    intendedOrderDollars,
    intendedShares: intendedShares === null ? null : round(intendedShares, 4),
    midpoint: book.midpoint === null ? null : round(book.midpoint, 4),
    quotedSpreadPct,
    halfSpreadPct,
    bidSizeShares,
    askSizeShares,
    touchCapacityRatio,
    estimatedEntryPrice: ask,
    estimatedEntryCostPct: halfSpreadPct,
    depthSlippagePct,
    depthSlippageStatus,
    marketImpactPct,
    marketImpactStatus,
    feesPct: fees.feesPct,
    grossRewardRisk: reward.grossRewardRisk,
    netEstimatedRewardRisk: reward.netEstimatedRewardRisk,
    expectedEntryFill: reward.expectedEntryFill,
    expectedTargetExitFill: reward.expectedTargetExitFill,
    expectedStopExitFill: reward.expectedStopExitFill,
    costCoverage: totalKnown ? "COMPLETE" : knownParts.some(Boolean) ? "PARTIAL" : "NONE",
    provider: signal.provider || signal.liveQuoteSource || signal.source || null,
    quoteAgeMs: null,
    legacyPercentPenalty: {
      role: "SHADOW_ONLY",
      productionEffect: false,
      value: finite(legacyPercentPenalty) === null ? null : round(finite(legacyPercentPenalty), 2),
    },
  };
}

export function annotateFillExecution(fill = {}) {
  const side = String(fill.side || "buy").toLowerCase();
  const fillPrice = finite(fill.fillPrice ?? fill.filled_avg_price ?? fill.averageFill);
  const midpointAtArrival = finite(fill.midpointAtArrival ?? fill.decisionMidpoint ?? fill.preSubmitMidpoint);
  if (fillPrice === null || midpointAtArrival === null || midpointAtArrival <= 0) {
    return {
      midpointAtArrival,
      fillPrice,
      effectiveSpreadPct: null,
      oneWayExecutionCostPct: null,
      effectiveSpreadStatus: "UNKNOWN",
    };
  }
  const signed = side === "sell"
    ? (midpointAtArrival - fillPrice) / midpointAtArrival
    : (fillPrice - midpointAtArrival) / midpointAtArrival;
  const effectiveSpreadPct = round(2 * signed * 100);
  return {
    side,
    fillPrice,
    fillQuantity: finite(fill.fillQuantity ?? fill.filledQty ?? fill.filled_qty),
    midpointAtArrival,
    effectiveSpreadPct,
    oneWayExecutionCostPct: effectiveSpreadPct === null ? null : round(effectiveSpreadPct / 2),
    effectiveSpreadStatus: "MEASURED",
  };
}
