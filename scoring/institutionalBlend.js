export const DEFAULT_REINFORCEMENT_WEIGHTS = Object.freeze({
  momentum: 0.18,
  technicals: 0.25,
  fundamentals: 0.12,
  macro: 0.1,
  statisticalEdge: 0.2,
  riskQuality: 0.15,
});

const BASE_GROUP_WEIGHTS = Object.freeze({
  marketEvidence: 0.44,
  fundamentals: 0.12,
  marketContext: 0.14,
  riskAndPortfolio: 0.3,
});

const clampMultiplier = (value) => Math.max(0.75, Math.min(1.25, Number(value) || 1));

function resolveEffectiveGroupWeights(reinforcementWeights = {}) {
  const merged = { ...DEFAULT_REINFORCEMENT_WEIGHTS, ...(reinforcementWeights || {}) };
  const ratio = (key) => Number(merged[key]) / Number(DEFAULT_REINFORCEMENT_WEIGHTS[key]);
  const marketDefaultTotal = DEFAULT_REINFORCEMENT_WEIGHTS.momentum
    + DEFAULT_REINFORCEMENT_WEIGHTS.technicals
    + DEFAULT_REINFORCEMENT_WEIGHTS.statisticalEdge;
  const marketMultiplier = clampMultiplier(
    (
      ratio("momentum") * DEFAULT_REINFORCEMENT_WEIGHTS.momentum
      + ratio("technicals") * DEFAULT_REINFORCEMENT_WEIGHTS.technicals
      + ratio("statisticalEdge") * DEFAULT_REINFORCEMENT_WEIGHTS.statisticalEdge
    ) / marketDefaultTotal
  );
  const multipliers = {
    marketEvidence: marketMultiplier,
    fundamentals: clampMultiplier(ratio("fundamentals")),
    marketContext: clampMultiplier(ratio("macro")),
    riskAndPortfolio: clampMultiplier(ratio("riskQuality")),
  };
  const adjusted = Object.fromEntries(
    Object.entries(BASE_GROUP_WEIGHTS).map(([name, weight]) => [name, weight * multipliers[name]])
  );
  const total = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    Object.entries(adjusted).map(([name, weight]) => [name, Number((weight / total).toFixed(6))])
  );
}

function finiteScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function measuredAverage(parts, clampScore) {
  const measured = parts.filter((part) => finiteScore(part.score) !== null);
  const weight = measured.reduce((sum, part) => sum + part.weight, 0);
  if (!weight) return { score: null, coverage: 0 };
  const configured = parts.reduce((sum, part) => sum + part.weight, 0);
  return {
    score: clampScore(measured.reduce((sum, part) => sum + part.score * part.weight, 0) / weight),
    coverage: configured > 0 ? weight / configured : 0,
  };
}

export function calculateInstitutionalBlend(input = {}, { clampScore }) {
  const weights = { ...DEFAULT_REINFORCEMENT_WEIGHTS, ...(input.reinforcementWeights || {}) };
  const effectiveGroupWeights = resolveEffectiveGroupWeights(weights);
  const momentumKnown = finiteScore(input.momentum) !== null || finiteScore(input.volumeRatio) !== null;
  const momentumScore = momentumKnown ? clampScore(
    50 + Number(input.momentum || 0) * 1.5 + Number(input.volumeRatio || 0) * 8 -
    (Number(input.momentum || 0) > 35 ? (input.premarketContinuationRelief ? 5 : 15) : 0)
  ) : null;
  const fundamentalDataValid = input.fundamentalDataValid === true;
  const fundamentalBlend = fundamentalDataValid ? measuredAverage([
    { score: finiteScore(input.fundamentalScore), weight: 0.45 },
    { score: finiteScore(input.dcfValuationScore), weight: 0.2 },
    { score: finiteScore(input.earningsScore), weight: 0.15 },
    { score: finiteScore(input.moatScore), weight: 0.12 },
    { score: finiteScore(input.dividendScore), weight: 0.04 },
    { score: finiteScore(input.harvardDividendScore), weight: 0.04 },
  ], clampScore) : { score: null, coverage: 0 };
  const fundamentalBlendScore = fundamentalBlend.score;
  // Correlated momentum, technical, and statistical observations form one evidence
  // family. Risk and portfolio fit form another. This prevents a single market move
  // or liquidity fact from earning several independent full-weight votes.
  const marketEvidence = measuredAverage([
    { score: momentumScore, weight: 0.4 },
    { score: finiteScore(input.technicalScore), weight: 0.35 },
    { score: finiteScore(input.statisticalScore), weight: 0.25 },
  ], clampScore);
  const marketEvidenceScore = marketEvidence.score;
  const macroKnown = finiteScore(input.macroScore) !== null;
  const sectorKnown = finiteScore(input.sectorScore) !== null;
  const contextBlend = macroKnown || sectorKnown ? measuredAverage([
    { score: finiteScore(input.macroScore), weight: 0.7 },
    { score: finiteScore(input.sectorScore), weight: 0.3 },
  ], clampScore) : { score: null, coverage: 0 };
  const contextScore = contextBlend.score;
  const contextAvailable = contextScore !== null;
  const riskBlend = measuredAverage([
    { score: finiteScore(input.blendedRiskScore), weight: 0.7 },
    { score: finiteScore(input.portfolioScore), weight: 0.3 },
  ], clampScore);
  const riskPortfolioScore = riskBlend.score;
  const groups = [
    { name: "marketEvidence", score: marketEvidenceScore, weight: effectiveGroupWeights.marketEvidence, available: marketEvidenceScore !== null },
    { name: "fundamentals", score: fundamentalBlendScore, weight: effectiveGroupWeights.fundamentals, available: fundamentalDataValid && fundamentalBlendScore !== null },
    { name: "marketContext", score: contextScore, weight: effectiveGroupWeights.marketContext, available: contextAvailable },
    { name: "riskAndPortfolio", score: riskPortfolioScore, weight: effectiveGroupWeights.riskAndPortfolio, available: riskPortfolioScore !== null },
  ];
  const availableWeight = groups.filter((group) => group.available).reduce((sum, group) => sum + group.weight, 0);
  const institutionalScore = availableWeight > 0
    ? clampScore(groups.filter((group) => group.available).reduce((sum, group) => sum + group.score * group.weight, 0) / availableWeight)
    : null;
  const componentTelemetry = groups.map((group) => ({
    ...group,
    contribution: group.available && availableWeight > 0 ? Number(((group.score * group.weight) / availableWeight).toFixed(2)) : 0,
  }));
  return {
    momentumScore,
    marketEvidenceScore,
    fundamentalBlendScore,
    fundamentalCoverage: fundamentalBlend.coverage,
    contextScore,
    contextCoverage: contextBlend.coverage,
    riskPortfolioScore,
    riskCoverage: riskBlend.coverage,
    fundamentalDataValid,
    institutionalScore,
    reinforcementWeights: weights,
    effectiveGroupWeights,
    componentTelemetry,
  };
}

export function evaluateInstitutionalApproval(input = {}) {
  const hardSafetyPass = !input.fakeBreakout && !input.newsRisk &&
    Number(input.blendedRiskScore || 0) >= 55 &&
    Number(input.exhaustionRiskScore || 0) <= 82 &&
    Number(input.volume || 0) >= 5000 &&
    Number(input.percentChange || 0) <= Number(input.maxPercentChange || 0);
  const institutionalQualityPass =
    Number(input.institutionalScore || 0) >= Number(input.minScoreToBuy || 0) &&
    Number(input.institutionalEntryScore || 0) >= 55;
  const cryptoInput =
    input.assetClass === "crypto" ||
    input.asset_class === "crypto" ||
    String(input.symbol || "").includes("/");
  const researchDataUsed = !cryptoInput && input.fundamentalDataValid === true;
  const stockResearchPass = !researchDataUsed ||
    (Number(input.valuationRiskScore || 0) <= 90 &&
      input.earningsRiskMode !== "HIGH_EARNINGS_RISK" &&
      Number(input.earningsVolatilityRiskScore || 0) <= 85 &&
      Number(input.competitiveAdvantageScore || 0) >= 35);
  const autoTradeApproved = hardSafetyPass && institutionalQualityPass && stockResearchPass;
  return {
    hardSafetyPass,
    institutionalQualityPass,
    stockResearchPass,
    researchDataUsed,
    autoTradeApproved,
    decisionLevel: autoTradeApproved ? "Auto-Trade Approved" :
      Number(input.institutionalScore || 0) >= 55 ? "Qualified Setup" : "Visible Stock",
  };
}
