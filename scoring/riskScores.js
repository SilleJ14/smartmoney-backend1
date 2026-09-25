import { resolveRecentVolumeRatio } from '../market-data/volumeEvidence.js';

function knownNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function riskEvidence(q = {}) {
  const confirmations = q.confirmations || {};
  const inputs = {
    PRICE_CHANGE: knownNumber(q.percentChange),
    VOLUME: knownNumber(q.volume) || knownNumber(q.barVolume),
    RSI: knownNumber(q.technicals?.rsi),
    VWAP: typeof confirmations.aboveVwap === "boolean",
    PRICE: knownNumber(q.current) || knownNumber(q.price),
  };
  return {
    confirmations,
    inputs,
    measuredInputs: Object.keys(inputs).filter((name) => inputs[name]),
    missingInputs: Object.keys(inputs).filter((name) => !inputs[name]),
    coverage: Object.values(inputs).filter(Boolean).length / 5,
    percentChange: inputs.PRICE_CHANGE ? Number(q.percentChange) : null,
    volume: inputs.VOLUME ? Number(knownNumber(q.volume) ? q.volume : q.barVolume) : null,
    rsi: inputs.RSI ? Number(q.technicals.rsi) : null,
    price: inputs.PRICE ? Number(knownNumber(q.current) ? q.current : q.price) : null,
    aboveVwap: inputs.VWAP ? confirmations.aboveVwap === true : null,
  };
}

function unpublished(coverage, measuredInputs, missingInputs, extras = {}) {
  return {
    riskCoverage: Number(coverage.toFixed(4)),
    riskPublishable: false,
    measuredInputs,
    missingInputs,
    ...extras,
  };
}

export function calculateInstitutionalRiskScore(q = {}, { clampScore, premarketContinuationRelief = false } = {}) {
  const evidence = riskEvidence(q);
  const { confirmations } = evidence;
  const volumeRatio = resolveRecentVolumeRatio(q);
  const complete = evidence.missingInputs.length === 0;
  if (!complete && evidence.coverage + 1e-9 < 0.6) {
    return unpublished(evidence.coverage, evidence.measuredInputs, evidence.missingInputs, {
      institutionalRiskScore: null,
      drawdownRiskScore: null,
      volatilityShockScore: null,
      liquidityStressScore: null,
      downsideExposureScore: null,
      crashSurvivabilityScore: null,
      institutionalRiskLabel: "UNKNOWN",
    });
  }
  const percentChange = evidence.percentChange ?? 0;
  const volume = evidence.volume ?? 0;
  const rsi = evidence.rsi ?? 50;
  const price = evidence.price ?? 0;
  const drawdownRiskScore = evidence.inputs.PRICE_CHANGE ? clampScore(
    80
    - (percentChange > 20 ? (premarketContinuationRelief ? 8 : 25) : 0)
    - (percentChange > 40 ? (premarketContinuationRelief ? 8 : 20) : 0)
    - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 10 : 30) : 0)
    - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 6 : 20) : 0)
  ) : null;
  const volatilityShockScore = evidence.inputs.PRICE_CHANGE ? clampScore(
    75
    - (Math.abs(percentChange) > 15 ? (premarketContinuationRelief ? 5 : 15) : 0)
    - (Math.abs(percentChange) > 30 ? (premarketContinuationRelief ? 7 : 20) : 0)
    // This published blend still penalizes RSI. Entry shadow momentum owns that
    // reading. Removing it here would change F, so it waits for the risk-in-F audit.
    - (evidence.inputs.RSI && rsi > 80 ? (premarketContinuationRelief ? 5 : 15) : 0)
    - (volumeRatio > 5 ? 10 : 0)
  ) : null;
  const liquidityStressScore = evidence.inputs.VOLUME && evidence.inputs.PRICE ? clampScore(
    40
    + (volume >= 1000000 ? 35 : volume >= 250000 ? 25 : volume >= 25000 ? 15 : -15)
    + (price >= 5 ? 10 : -10)
  ) : null;
  const downsideExposureScore = evidence.inputs.PRICE_CHANGE ? clampScore(
    80
    - (percentChange < -20 ? 20 : 0)
    - (percentChange > 30 ? (premarketContinuationRelief ? 7 : 20) : 0)
    - (confirmations.newsRisk ? 30 : 0)
    - (evidence.aboveVwap === false ? (premarketContinuationRelief ? 4 : 10) : 0)
  ) : null;
  const crashSurvivabilityScore = evidence.inputs.PRICE ? clampScore(
    50
    + (Number(liquidityStressScore) >= 70 ? 15 : 0)
    + (Number(drawdownRiskScore) >= 70 ? 15 : 0)
    + (price >= 10 ? 10 : 0)
    - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0)
  ) : null;
  const pieces = [drawdownRiskScore, volatilityShockScore, liquidityStressScore, downsideExposureScore, crashSurvivabilityScore]
    .filter((score) => Number.isFinite(score));
  const institutionalRiskScore = complete
    ? clampScore(drawdownRiskScore * 0.22 + volatilityShockScore * 0.2 + liquidityStressScore * 0.2 + downsideExposureScore * 0.2 + crashSurvivabilityScore * 0.18)
    : pieces.length && evidence.coverage + 1e-9 >= 0.6
      ? clampScore(pieces.reduce((sum, score) => sum + score, 0) / pieces.length)
      : null;
  return {
    institutionalRiskScore,
    drawdownRiskScore,
    volatilityShockScore,
    liquidityStressScore,
    downsideExposureScore,
    crashSurvivabilityScore,
    riskCoverage: Number((complete ? 1 : evidence.coverage).toFixed(4)),
    riskPublishable: institutionalRiskScore !== null,
    measuredInputs: evidence.measuredInputs,
    missingInputs: evidence.missingInputs,
    institutionalRiskLabel: institutionalRiskScore === null
      ? "UNKNOWN"
      : institutionalRiskScore >= 80
        ? "Institutional Risk"
        : institutionalRiskScore >= 65
          ? "Controlled Risk"
          : institutionalRiskScore >= 50
            ? "Elevated Risk"
            : "High Stress Risk",
  };
}

export function calculatePortfolioFitScore(q = {}, { clampScore, premarketContinuationRelief = false } = {}) {
  const evidence = riskEvidence(q);
  const { confirmations } = evidence;
  const volumeRatio = resolveRecentVolumeRatio(q);
  const complete = evidence.missingInputs.length === 0;
  if (!complete && evidence.coverage + 1e-9 < 0.6) {
    return {
      portfolioScore: null,
      portfolioConstructionScore: null,
      portfolioCoverage: Number(evidence.coverage.toFixed(4)),
      portfolioPublishable: false,
      measuredInputs: evidence.measuredInputs,
      missingInputs: evidence.missingInputs,
      liquidityFitScore: null,
      volatilityBalanceScore: null,
      diversificationFitScore: null,
      positionSizingQualityScore: null,
      portfolioRiskContributionScore: null,
      portfolioRole: "UNKNOWN",
      suggestedAllocationTier: "UNKNOWN",
    };
  }
  const percentChange = evidence.percentChange ?? 0;
  const volume = evidence.volume ?? 0;
  const rsi = evidence.rsi ?? 50;
  const price = evidence.price ?? 0;
  const liquidityFitScore = evidence.inputs.VOLUME && evidence.inputs.PRICE ? clampScore(
    45 + (volume >= 1000000 ? 25 : volume >= 250000 ? 18 : volume >= 25000 ? 10 : -20) + (price >= 5 ? 10 : -10)
  ) : null;
  const volatilityBalanceScore = evidence.inputs.PRICE_CHANGE ? clampScore(
    75
    - (Math.abs(percentChange) > 20 ? (premarketContinuationRelief ? 8 : 25) : 0)
    - (Math.abs(percentChange) > 12 ? (premarketContinuationRelief ? 4 : 12) : 0)
    - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 5 : 15) : 0)
    - (evidence.inputs.RSI && rsi > 80 ? (premarketContinuationRelief ? 5 : 15) : 0)
  ) : null;
  const diversificationFitScore = evidence.inputs.PRICE ? clampScore(
    55 + (price >= 5 ? 8 : -8) + (volumeRatio >= 1 && volumeRatio <= 3 ? 10 : 0) - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0)
  ) : null;
  const positionSizingQualityScore = clampScore(
    60
    + (evidence.inputs.VOLUME && volume >= 250000 ? 10 : 0)
    + (evidence.inputs.PRICE_CHANGE && percentChange >= 0 && percentChange <= 15 ? 10 : 0)
    - (confirmations.newsRisk ? 20 : 0)
    - (confirmations.fakeBreakout ? (premarketContinuationRelief ? 8 : 25) : 0)
  );
  const portfolioRiskContributionScore = evidence.inputs.PRICE_CHANGE ? clampScore(
    80
    - (percentChange > 20 ? (premarketContinuationRelief ? 7 : 20) : 0)
    - (confirmations.gapTooHigh ? (premarketContinuationRelief ? 5 : 15) : 0)
    - (confirmations.newsRisk ? 25 : 0)
    - (evidence.inputs.VOLUME && volume < 25000 ? 25 : 0)
  ) : null;
  const pieces = [liquidityFitScore, volatilityBalanceScore, diversificationFitScore, positionSizingQualityScore, portfolioRiskContributionScore]
    .filter((score) => Number.isFinite(score));
  const portfolioConstructionScore = complete
    ? clampScore(liquidityFitScore * 0.24 + volatilityBalanceScore * 0.22 + diversificationFitScore * 0.18 + positionSizingQualityScore * 0.2 + portfolioRiskContributionScore * 0.16)
    : pieces.length && evidence.coverage + 1e-9 >= 0.6
      ? clampScore(pieces.reduce((sum, score) => sum + score, 0) / pieces.length)
      : null;
  return {
    portfolioScore: portfolioConstructionScore,
    portfolioConstructionScore,
    portfolioCoverage: Number((complete ? 1 : evidence.coverage).toFixed(4)),
    portfolioPublishable: portfolioConstructionScore !== null,
    measuredInputs: evidence.measuredInputs,
    missingInputs: evidence.missingInputs,
    liquidityFitScore,
    volatilityBalanceScore,
    diversificationFitScore,
    positionSizingQualityScore,
    portfolioRiskContributionScore,
    portfolioRole: portfolioConstructionScore === null
      ? "UNKNOWN"
      : portfolioConstructionScore >= 85
        ? "Core Position Candidate"
        : portfolioConstructionScore >= 75
          ? "Strong Portfolio Fit"
          : portfolioConstructionScore >= 65
            ? "Satellite Position"
            : portfolioConstructionScore >= 50
              ? "Small Tactical Position"
              : "Avoid Heavy Allocation",
    suggestedAllocationTier: portfolioConstructionScore === null
      ? "UNKNOWN"
      : portfolioConstructionScore >= 85
        ? "High"
        : portfolioConstructionScore >= 70
          ? "Medium"
          : portfolioConstructionScore >= 55
            ? "Small"
            : "Watch Only",
  };
}
