export function calculateInstitutionalRiskScore(q = {}, { clampScore, premarketContinuationRelief = false }) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};
  const rsi = Number(q.technicals?.rsi || 50);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const drawdownRiskScore = clampScore(80 - (percentChange > 20 ? (premarketContinuationRelief ? 8 : 25) : 0) - (percentChange > 40 ? (premarketContinuationRelief ? 8 : 20) : 0) - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 10 : 30) : 0) - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 6 : 20) : 0));
  const volatilityShockScore = clampScore(75 - (Math.abs(percentChange) > 15 ? (premarketContinuationRelief ? 5 : 15) : 0) - (Math.abs(percentChange) > 30 ? (premarketContinuationRelief ? 7 : 20) : 0) - (rsi > 80 ? (premarketContinuationRelief ? 5 : 15) : 0) - (volumeRatio > 5 ? 10 : 0));
  const liquidityStressScore = clampScore(40 + (volume >= 1000000 ? 35 : volume >= 250000 ? 25 : volume >= 25000 ? 15 : -15) + (price >= 5 ? 10 : -10));
  const downsideExposureScore = clampScore(80 - (percentChange < -20 ? 20 : 0) - (percentChange > 30 ? (premarketContinuationRelief ? 7 : 20) : 0) - (confirmations.newsRisk ? 30 : 0) - (!confirmations.aboveVwap ? (premarketContinuationRelief ? 4 : 10) : 0));
  const crashSurvivabilityScore = clampScore(50 + (liquidityStressScore >= 70 ? 15 : 0) + (drawdownRiskScore >= 70 ? 15 : 0) + (price >= 10 ? 10 : 0) - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0));
  const institutionalRiskScore = clampScore(drawdownRiskScore * 0.22 + volatilityShockScore * 0.2 + liquidityStressScore * 0.2 + downsideExposureScore * 0.2 + crashSurvivabilityScore * 0.18);
  return {
    institutionalRiskScore, drawdownRiskScore, volatilityShockScore, liquidityStressScore,
    downsideExposureScore, crashSurvivabilityScore,
    institutionalRiskLabel: institutionalRiskScore >= 80 ? "Institutional Risk" : institutionalRiskScore >= 65 ? "Controlled Risk" : institutionalRiskScore >= 50 ? "Elevated Risk" : "High Stress Risk",
  };
}

export function calculatePortfolioFitScore(q = {}, { clampScore, premarketContinuationRelief = false }) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};
  const rsi = Number(q.technicals?.rsi || 50);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const liquidityFitScore = clampScore(45 + (volume >= 1000000 ? 25 : volume >= 250000 ? 18 : volume >= 25000 ? 10 : -20) + (price >= 5 ? 10 : -10));
  const volatilityBalanceScore = clampScore(75 - (Math.abs(percentChange) > 20 ? (premarketContinuationRelief ? 8 : 25) : 0) - (Math.abs(percentChange) > 12 ? (premarketContinuationRelief ? 4 : 12) : 0) - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 5 : 15) : 0) - (rsi > 80 ? (premarketContinuationRelief ? 5 : 15) : 0));
  const diversificationFitScore = clampScore(55 + (price >= 5 ? 8 : -8) + (volumeRatio >= 1 && volumeRatio <= 3 ? 10 : 0) - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0));
  const positionSizingQualityScore = clampScore(60 + (volume >= 250000 ? 10 : 0) + (percentChange >= 0 && percentChange <= 15 ? 10 : 0) - (confirmations.newsRisk ? 20 : 0) - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0));
  const portfolioRiskContributionScore = clampScore(80 - (percentChange > 20 ? (premarketContinuationRelief ? 7 : 20) : 0) - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 5 : 15) : 0) - (confirmations.newsRisk ? 25 : 0) - (volume < 25000 ? 25 : 0));
  const portfolioConstructionScore = clampScore(liquidityFitScore * 0.24 + volatilityBalanceScore * 0.22 + diversificationFitScore * 0.18 + positionSizingQualityScore * 0.2 + portfolioRiskContributionScore * 0.16);
  return {
    portfolioScore: portfolioConstructionScore, portfolioConstructionScore, liquidityFitScore,
    volatilityBalanceScore, diversificationFitScore, positionSizingQualityScore,
    portfolioRiskContributionScore,
    portfolioRole: portfolioConstructionScore >= 85 ? "Core Position Candidate" : portfolioConstructionScore >= 75 ? "Strong Portfolio Fit" : portfolioConstructionScore >= 65 ? "Satellite Position" : portfolioConstructionScore >= 50 ? "Small Tactical Position" : "Avoid Heavy Allocation",
    suggestedAllocationTier: portfolioConstructionScore >= 85 ? "High" : portfolioConstructionScore >= 70 ? "Medium" : portfolioConstructionScore >= 55 ? "Small" : "Watch Only",
  };
}
