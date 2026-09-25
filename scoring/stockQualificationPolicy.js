// One stock qualification scale. 70 decides whether F qualifies.
// 78 and 85 describe how strong a qualified opportunity is.
// Risk can change permission or size. It does not move this line.

export const STOCK_EXECUTION_THRESHOLDS = Object.freeze({
  watchScore: 60,
  watchlistScore: 60,
  qualifiedScore: 70,
  finalScore: 70,
  entryScore: 75,
  entryCoverage: 0.8,
  strongScore: 78,
  exceptionalScore: 85,
  // Acceleration is a sizing band inside Exceptional, not a second buy gate.
  acceleratedFinalScore: 85,
  acceleratedEntryScore: 82,
  maxSpreadPercent: 1,
  maxQuoteAgeSeconds: 5,
  maxDecisionAgeSeconds: 300,
  riskQualityScore: 55,
});

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyStockScoreBand(finalScore) {
  const score = finite(finalScore);
  if (score === null) return null;
  const thresholds = STOCK_EXECUTION_THRESHOLDS;
  if (score >= thresholds.exceptionalScore) return "EXCEPTIONAL";
  if (score >= thresholds.strongScore) return "STRONG";
  if (score >= thresholds.finalScore) return "QUALIFIED";
  if (score >= thresholds.watchScore) return "WATCH";
  return "RESEARCH";
}

export function analyticalStockPass({
  finalScore = null,
  entryApproved = false,
  entryCoverage = null,
} = {}) {
  const thresholds = STOCK_EXECUTION_THRESHOLDS;
  const final = finite(finalScore);
  const coverage = finite(entryCoverage);
  return final !== null
    && coverage !== null
    && final >= thresholds.finalScore
    && entryApproved === true
    && coverage >= thresholds.entryCoverage;
}

// Market stress never changes required F. Size multipliers are provisional
// until outcomes are measured. Extreme stress can withhold permission.
export function classifyStockMarketStress({
  marketStress = 0,
  crashBlock = false,
  macroBlock = false,
} = {}) {
  const requiredF = STOCK_EXECUTION_THRESHOLDS.finalScore;
  const stress = finite(marketStress) ?? 0;
  let band = "NORMAL";
  let riskState = "PASS";
  let multiplier = 1;
  let reason = null;
  if (crashBlock === true || stress >= 90) {
    band = "EXTREME";
    riskState = "REJECT";
    multiplier = 0;
    reason = crashBlock === true ? "MARKET_CRASH_PROTECTION" : "EXTREME_MARKET_STRESS";
  } else if (stress >= 80) {
    band = "HIGH";
    riskState = "PASS_WITH_CONSTRAINT";
    multiplier = 0.5;
    reason = "HIGH_MARKET_STRESS";
  } else if (stress >= 60 || macroBlock === true) {
    band = "ELEVATED";
    riskState = "PASS_WITH_CONSTRAINT";
    multiplier = 0.75;
    reason = macroBlock === true && stress < 60 ? "MACRO_STRESS" : "ELEVATED_MARKET_STRESS";
  }
  return {
    requiredF,
    movesRequiredF: false,
    band,
    R: { state: riskState, reason, affectsF: false },
    S: {
      multiplier,
      multiplierStatus: band === "NORMAL" ? "NO_ADJUSTMENT" : "PROVISIONAL_UNTIL_OUTCOMES",
      affectsF: false,
    },
  };
}
