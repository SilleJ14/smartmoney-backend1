const finite = value => typeof value === "number" && Number.isFinite(value);

export function pairReturnCorrelation(leftReturns = [], rightReturns = [], { minimumSamples = 3 } = {}) {
  const pairs = [];
  const length = Math.min(leftReturns.length, rightReturns.length);
  for (let index = 0; index < length; index += 1) {
    if (finite(leftReturns[index]) && finite(rightReturns[index])) {
      pairs.push([leftReturns[index], rightReturns[index]]);
    }
  }
  if (pairs.length < minimumSamples) {
    return { correlation: null, sampleSize: pairs.length, missingReasons: ["INSUFFICIENT_ALIGNED_RETURNS"] };
  }
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (const [left, right] of pairs) {
    covariance += (left - leftMean) * (right - rightMean);
    leftVariance += (left - leftMean) ** 2;
    rightVariance += (right - rightMean) ** 2;
  }
  if (leftVariance === 0 || rightVariance === 0) {
    return { correlation: null, sampleSize: pairs.length, missingReasons: ["ZERO_RETURN_VARIANCE"] };
  }
  return {
    correlation: covariance / Math.sqrt(leftVariance * rightVariance),
    sampleSize: pairs.length,
    missingReasons: [],
  };
}

export const calculatePairReturnCorrelation = pairReturnCorrelation;
export const calculateCorrelation = pairReturnCorrelation;

function parsePair(position) {
  if (position.baseCurrency && position.quoteCurrency) {
    return [String(position.baseCurrency).toUpperCase(), String(position.quoteCurrency).toUpperCase()];
  }
  const compact = String(position.pair ?? position.instrument ?? position.symbol ?? "")
    .toUpperCase().replace(/[^A-Z]/g, "");
  return compact.length === 6 ? [compact.slice(0, 3), compact.slice(3)] : [null, null];
}

/**
 * Decomposes each FX position into its two currency legs. Native amounts are
 * always returned. Account-currency totals are returned only when every needed
 * conversion rate is supplied (account currency itself has an implicit rate 1).
 */
export function calculateCurrencyLegExposure({
  positions = [],
  accountCurrency = "USD",
  conversionRates = {},
} = {}) {
  const currencies = {};
  const missingReasons = [];
  const account = String(accountCurrency).toUpperCase();
  const add = (currency, amount, id) => {
    const row = currencies[currency] ||= {
      currency, netNative: 0, grossNative: 0, netAccount: 0, grossAccount: 0, legs: [],
    };
    row.netNative += amount;
    row.grossNative += Math.abs(amount);
    row.legs.push({ positionId: id, amountNative: amount });
  };

  positions.forEach((position, index) => {
    const [base, quote] = parsePair(position);
    const units = Number(position.units ?? position.quantity ?? position.baseUnits);
    const price = Number(position.price ?? position.entryPrice ?? position.markPrice);
    const side = String(position.side || "").toUpperCase();
    const signedUnits = position.units < 0 || position.quantity < 0
      ? units
      : units * (side === "SELL" || side === "SHORT" ? -1 : side === "BUY" || side === "LONG" ? 1 : NaN);
    if (!base || !quote) {
      missingReasons.push(`POSITION_${index}_PAIR_MISSING`);
      return;
    }
    if (!finite(signedUnits)) {
      missingReasons.push(`POSITION_${index}_UNITS_OR_SIDE_MISSING`);
      return;
    }
    if (!finite(price) || price <= 0) {
      missingReasons.push(`POSITION_${index}_PRICE_MISSING`);
      return;
    }
    const id = position.id ?? position.orderId ?? index;
    add(base, signedUnits, id);
    add(quote, -signedUnits * price, id);
  });

  let conversionComplete = true;
  for (const row of Object.values(currencies)) {
    const rate = row.currency === account ? 1 : Number(conversionRates[row.currency]);
    if (!finite(rate) || rate <= 0) {
      row.netAccount = null;
      row.grossAccount = null;
      conversionComplete = false;
      missingReasons.push(`CONVERSION_RATE_${row.currency}_MISSING`);
      continue;
    }
    row.netAccount = row.netNative * rate;
    row.grossAccount = row.grossNative * rate;
  }
  return {
    currencies,
    accountCurrency: account,
    totalGrossAccount: conversionComplete
      ? Object.values(currencies).reduce((sum, row) => sum + row.grossAccount, 0)
      : null,
    conversionComplete,
    missingReasons,
  };
}

export const currencyLegExposure = calculateCurrencyLegExposure;
export const calculateCurrencyExposure = calculateCurrencyLegExposure;

export function progressiveDrawdownMultiplier({
  drawdownFraction,
  reductionStartsAt = 0.03,
  hardStopAt = 0.1,
  minimumMultiplier = 0.25,
} = {}) {
  if (!finite(drawdownFraction) || drawdownFraction < 0) {
    return { multiplier: null, hardStop: false, missingReasons: ["DRAWDOWN_MISSING_OR_INVALID"] };
  }
  if (!(hardStopAt > reductionStartsAt) || minimumMultiplier < 0 || minimumMultiplier > 1) {
    return { multiplier: null, hardStop: false, missingReasons: ["DRAWDOWN_POLICY_INVALID"] };
  }
  if (drawdownFraction >= hardStopAt) {
    return { multiplier: 0, hardStop: true, reason: "DRAWDOWN_HARD_STOP", missingReasons: [] };
  }
  if (drawdownFraction <= reductionStartsAt) {
    return { multiplier: 1, hardStop: false, reason: "BELOW_REDUCTION_START", missingReasons: [] };
  }
  const progress = (drawdownFraction - reductionStartsAt) / (hardStopAt - reductionStartsAt);
  return {
    multiplier: 1 - progress * (1 - minimumMultiplier),
    hardStop: false,
    reason: "PROGRESSIVE_DRAWDOWN_REDUCTION",
    missingReasons: [],
  };
}

/**
 * Canonical pre-trade portfolio risk check. Risk amounts and caps use account
 * currency. Fractions (weekly loss/drawdown) use decimal equity fractions.
 */
export function assessPortfolioRisk({
  openRisk,
  pendingRisk,
  proposedRisk = 0,
  accountRiskCap,
  strategyId,
  strategyRisk = {},
  strategyRiskCap,
  strategyCaps = {},
  weeklyLossFraction,
  weeklyLossLimit,
  drawdownFraction,
  drawdownPolicy = {},
  currencySameDirectionRisk,
  currencyRiskCap,
  openPositionCount = 0,
  correlationEvidence,
  correlationRiskCap,
  maximumAbsoluteCorrelation = 0.8,
} = {}) {
  const missingReasons = [];
  const rejectionReasons = [];
  const amounts = { openRisk, pendingRisk, proposedRisk, accountRiskCap };
  for (const [name, value] of Object.entries(amounts)) {
    if (!finite(value) || value < 0) missingReasons.push(`${name.toUpperCase()}_MISSING_OR_INVALID`);
  }
  if (!finite(weeklyLossFraction) || weeklyLossFraction < 0) missingReasons.push("WEEKLY_LOSS_MISSING_OR_INVALID");
  if (!finite(weeklyLossLimit) || weeklyLossLimit < 0) missingReasons.push("WEEKLY_LOSS_LIMIT_MISSING_OR_INVALID");
  if (!strategyId) missingReasons.push("STRATEGY_ID_MISSING");
  const currentStrategyRisk = finite(strategyRisk)
    ? strategyRisk
    : strategyRisk && finite(strategyRisk[strategyId]) ? strategyRisk[strategyId] : null;
  const cap = finite(strategyRiskCap) ? strategyRiskCap : strategyCaps?.[strategyId];
  if (!finite(currentStrategyRisk) || currentStrategyRisk < 0) missingReasons.push("STRATEGY_RISK_MISSING_OR_INVALID");
  if (!finite(cap) || cap < 0) missingReasons.push("STRATEGY_CAP_MISSING_OR_INVALID");
  if (!finite(currencySameDirectionRisk) || currencySameDirectionRisk < 0) {
    missingReasons.push("CURRENCY_EXPOSURE_MISSING_OR_INVALID");
  }
  if (!finite(currencyRiskCap) || currencyRiskCap < 0) {
    missingReasons.push("CURRENCY_EXPOSURE_CAP_MISSING_OR_INVALID");
  }
  if (openPositionCount > 0 && !Array.isArray(correlationEvidence)) {
    missingReasons.push("PAIR_CORRELATION_EVIDENCE_MISSING");
  }
  if (openPositionCount > 0 && Array.isArray(correlationEvidence) &&
      (correlationEvidence.length < openPositionCount ||
       correlationEvidence.some(row => !finite(row?.correlation) || !finite(row?.risk) || row.risk < 0))) {
    missingReasons.push("PAIR_CORRELATION_EVIDENCE_MALFORMED");
  }
  if (openPositionCount > 0 && (!finite(correlationRiskCap) || correlationRiskCap < 0)) {
    missingReasons.push("PAIR_CORRELATION_CAP_MISSING_OR_INVALID");
  }

  const drawdown = progressiveDrawdownMultiplier({ drawdownFraction, ...drawdownPolicy });
  missingReasons.push(...drawdown.missingReasons);
  const openPlusPendingRisk = finite(openRisk) && finite(pendingRisk) ? openRisk + pendingRisk : null;
  const resultingAccountRisk = finite(openPlusPendingRisk) && finite(proposedRisk)
    ? openPlusPendingRisk + proposedRisk : null;
  const resultingStrategyRisk = finite(currentStrategyRisk) && finite(proposedRisk)
    ? currentStrategyRisk + proposedRisk : null;

  if (finite(resultingAccountRisk) && finite(accountRiskCap) && resultingAccountRisk > accountRiskCap) {
    rejectionReasons.push("ACCOUNT_RISK_CAP_EXCEEDED");
  }
  if (finite(resultingStrategyRisk) && finite(cap) && resultingStrategyRisk > cap) {
    rejectionReasons.push("STRATEGY_RISK_CAP_EXCEEDED");
  }
  if (finite(weeklyLossFraction) && finite(weeklyLossLimit) && weeklyLossFraction >= weeklyLossLimit) {
    rejectionReasons.push("WEEKLY_LOSS_LIMIT_REACHED");
  }
  if (drawdown.hardStop) rejectionReasons.push("DRAWDOWN_HARD_STOP");
  const resultingCurrencyRisk = finite(currencySameDirectionRisk) && finite(proposedRisk)
    ? currencySameDirectionRisk + proposedRisk : null;
  if (finite(resultingCurrencyRisk) && finite(currencyRiskCap) && resultingCurrencyRisk > currencyRiskCap) {
    rejectionReasons.push("CURRENCY_EXPOSURE_CAP_EXCEEDED");
  }
  const highCorrelationRisk = Array.isArray(correlationEvidence)
    ? correlationEvidence.filter(row => finite(row?.correlation) &&
      Math.abs(row.correlation) >= maximumAbsoluteCorrelation &&
      row.sameDirection === true)
      .reduce((sum, row) => sum + (finite(row.risk) && row.risk >= 0 ? row.risk : 0), 0)
    : null;
  const resultingCorrelationRisk = finite(highCorrelationRisk) && finite(proposedRisk)
    ? highCorrelationRisk + proposedRisk : null;
  if (finite(resultingCorrelationRisk) && finite(correlationRiskCap) &&
      resultingCorrelationRisk > correlationRiskCap) {
    rejectionReasons.push("PAIR_CORRELATION_CAP_EXCEEDED");
  }

  const approved = !missingReasons.length && !rejectionReasons.length;
  return {
    approved,
    disposition: approved ? "APPROVE" : rejectionReasons.length ? "REJECT" : "WAIT",
    reason: rejectionReasons[0] || missingReasons[0] || "PORTFOLIO_RISK_APPROVED",
    openPlusPendingRisk,
    resultingAccountRisk,
    resultingStrategyRisk,
    resultingCurrencyRisk,
    resultingCorrelationRisk,
    drawdownMultiplier: drawdown.multiplier,
    adjustedProposedRisk: finite(proposedRisk) && finite(drawdown.multiplier)
      ? proposedRisk * drawdown.multiplier : null,
    rejectionReasons,
    missingReasons,
    units: {
      risk: "ACCOUNT_CURRENCY",
      weeklyLossFraction: "EQUITY_FRACTION",
      drawdownFraction: "EQUITY_FRACTION",
    },
  };
}

export const portfolioRiskDecision = assessPortfolioRisk;
export const evaluatePortfolioRisk = assessPortfolioRisk;
