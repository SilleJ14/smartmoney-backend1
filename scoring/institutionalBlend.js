export const DEFAULT_REINFORCEMENT_WEIGHTS = Object.freeze({
  momentum: 0.18,
  technicals: 0.25,
  fundamentals: 0.12,
  macro: 0.1,
  statisticalEdge: 0.2,
  riskQuality: 0.15,
});

export function calculateInstitutionalBlend(input = {}, { clampScore }) {
  const weights = input.reinforcementWeights || DEFAULT_REINFORCEMENT_WEIGHTS;
  const momentumScore = clampScore(
    50 + Number(input.momentum || 0) * 1.5 + Number(input.volumeRatio || 0) * 8 -
    (Number(input.momentum || 0) > 35 ? (input.premarketContinuationRelief ? 5 : 15) : 0)
  );
  const fundamentalBlendScore = clampScore(
    Number(input.fundamentalScore || 0) * 0.45 +
    Number(input.dcfValuationScore || 0) * 0.2 +
    Number(input.earningsScore || 0) * 0.15 +
    Number(input.moatScore || 0) * 0.12 +
    Number(input.dividendScore || 0) * 0.04 +
    Number(input.harvardDividendScore || 0) * 0.04
  );
  // Correlated momentum, technical, and statistical observations form one evidence
  // family. Risk and portfolio fit form another. This prevents a single market move
  // or liquidity fact from earning several independent full-weight votes.
  const marketEvidenceScore = clampScore(
    momentumScore * 0.4 + Number(input.technicalScore || 0) * 0.35 + Number(input.statisticalScore || 0) * 0.25
  );
  const contextScore = clampScore(Number(input.macroScore || 0) * 0.7 + Number(input.sectorScore || 0) * 0.3);
  const riskPortfolioScore = clampScore(Number(input.blendedRiskScore || 0) * 0.7 + Number(input.portfolioScore || 0) * 0.3);
  const fundamentalDataValid = input.fundamentalDataValid === true;
  const groups = [
    { name: "marketEvidence", score: marketEvidenceScore, weight: 0.44, available: true },
    { name: "fundamentals", score: fundamentalBlendScore, weight: 0.12, available: fundamentalDataValid },
    { name: "marketContext", score: contextScore, weight: 0.14, available: true },
    { name: "riskAndPortfolio", score: riskPortfolioScore, weight: 0.3, available: true },
  ];
  const availableWeight = groups.filter((group) => group.available).reduce((sum, group) => sum + group.weight, 0);
  const institutionalScore = clampScore(groups.filter((group) => group.available).reduce((sum, group) => sum + group.score * group.weight, 0) / availableWeight);
  const componentTelemetry = groups.map((group) => ({ ...group, contribution: group.available ? Number(((group.score * group.weight) / availableWeight).toFixed(2)) : 0 }));
  return { momentumScore, marketEvidenceScore, fundamentalBlendScore, contextScore, riskPortfolioScore, fundamentalDataValid, institutionalScore, reinforcementWeights: weights, componentTelemetry };
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
  const researchDataUsed = input.tradingMode !== "live_crypto" && input.fundamentalDataValid === true;
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
