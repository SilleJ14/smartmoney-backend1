const numberFrom = (signal, paths, fallback) => {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], signal);
    if (value !== undefined && value !== null) return Number(value);
  }
  return fallback;
};

export function calculateCryptoStrategySelection(cryptoSignals = [], { normalizeSymbol, clampScore, now = () => new Date() }) {
  const signals = Array.isArray(cryptoSignals) ? cryptoSignals : [];
  const selectedCryptoSignals = signals.map((signal) => {
    const symbol = normalizeSymbol(signal.symbol);
    const base = numberFrom(signal, ["score", "realismAdjustedScore"], 0);
    const liquidity = numberFrom(signal, ["liquiditySweep.liquidityScore", "cryptoLiquidityScore", "liquidityScore"], 50);
    const whale = numberFrom(signal, ["whaleSmartMoney.whaleAccumulationScore", "whaleScore", "smartMoneyWhaleScore"], 50);
    const stablecoin = numberFrom(signal, ["stablecoinPressure.stablecoinFlowScore", "stablecoinFlowScore", "exchangePressureScore"], 50);
    const correlation = numberFrom(signal, ["crossMarketCorrelation.cryptoCorrelationScore", "correlationScore"], 50);
    const timeframe = numberFrom(signal, ["cryptoMultiTimeframeParliament.multiTimeframeScore", "multiTimeframeScore", "timeframeScore"], 50);
    const execution = numberFrom(signal, ["cryptoExecutionTiming.executionTimingScore", "executionTimingScore"], 50);
    const sizing = numberFrom(signal, ["cryptoPositionSizing.positionSizingScore", "positionSizingScore"], 50);
    const exitRisk = numberFrom(signal, ["cryptoExitParliament.exitRiskScore", "exitRiskScore"], 35);
    const strategyRanking = [
      ["CRYPTO_MOMENTUM_CONTINUATION", base * .3 + liquidity * .18 + timeframe * .22 + execution * .15 + whale * .15 - exitRisk * .1],
      ["WHALE_ACCUMULATION_FOLLOW_THROUGH", whale * .3 + stablecoin * .2 + liquidity * .2 + timeframe * .2 + base * .1 - exitRisk * .08],
      ["DEFENSIVE_LIQUIDITY_PROTECTION", liquidity * .28 + sizing * .22 + correlation * .2 + stablecoin * .15 + execution * .15 - exitRisk * .18],
      ["MULTI_TIMEFRAME_BREAKOUT", base * .22 + liquidity * .2 + whale * .18 + timeframe * .25 + execution * .15 - exitRisk * .12],
    ].map(([strategy, score]) => ({ strategy, score: clampScore(score) }))
      .sort((a, b) => b.score - a.score);
    const selected = strategyRanking[0] || { strategy: "NO_CRYPTO_STRATEGY_EDGE", score: 0 };
    const strategyConfidence = clampScore(selected.score);
    const action = strategyConfidence >= 82 ? "DEPLOY_AGGRESSIVE_CRYPTO_STRATEGY"
      : strategyConfidence >= 72 ? "DEPLOY_SELECTIVE_CRYPTO_STRATEGY"
        : strategyConfidence >= 62 ? "WATCH_CRYPTO_STRATEGY" : "BLOCK_WEAK_CRYPTO_STRATEGY";
    return {
      symbol, selectedStrategy: selected.strategy, strategyConfidence, strategyRanking, action,
      shouldBoostCryptoScore: strategyConfidence >= 72,
      strategyScoreBoost: strategyConfidence >= 82 ? 6 : strategyConfidence >= 72 ? 3 : 0,
      reason: "APPLIED",
    };
  });
  const deployableStrategies = selectedCryptoSignals.filter(({ action }) =>
    action === "DEPLOY_AGGRESSIVE_CRYPTO_STRATEGY" || action === "DEPLOY_SELECTIVE_CRYPTO_STRATEGY");
  const average = selectedCryptoSignals.reduce((sum, item) => sum + item.strategyConfidence, 0) /
    Math.max(1, selectedCryptoSignals.length);
  return {
    updatedAt: now().toISOString(),
    phase: "52_AUTONOMOUS_CRYPTO_STRATEGY_SELECTOR",
    reviewedCryptoSignals: signals.length,
    deployableStrategyCount: deployableStrategies.length,
    averageStrategyConfidence: Number(average.toFixed(2)),
    selectedCryptoSignals,
    topCryptoStrategies: deployableStrategies.slice(0, 10),
    reason: `${deployableStrategies.length} deployable autonomous crypto strategies found.`,
  };
}
