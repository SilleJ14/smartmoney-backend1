// Regime is independent of candidate selection, D/E/F and approval rates.
// SPY/QQQ are benchmark proxies, not a claim about exchange-wide breadth.
export function independentMarketRegime(observations = [], { now = Date.now(), config = {}, enabled = true } = {}) {
  const valid = observations.filter(row => ['SPY', 'QQQ'].includes(row.symbol) &&
    Number.isFinite(row.changePercent) && Number.isFinite(row.trendPercent) &&
    Number.isFinite(row.quoteAt) && now - row.quoteAt >= -5000 && now - row.quoteAt <= 60000 &&
    Number.isFinite(row.barAt) && now - row.barAt >= 300000 && now - row.barAt <= 900000);
  const unique = [...new Map(valid.map(row => [row.symbol, row])).values()];
  const available = enabled && unique.length === 2;
  let state = 'unavailable';
  if (available) {
    const avg = unique.reduce((sum, row) => sum + row.changePercent, 0) / 2;
    state = avg <= -2 ? 'panic/high volatility'
      : unique.every(row => row.changePercent > 0 && row.trendPercent > 0) ? 'aggressive bullish'
      : avg > 0 ? 'cautious bullish' : 'defensive';
  }
  const multipliers = { 'aggressive bullish': config.aggressiveBullishExposureMultiplier ?? 1,
    'cautious bullish': config.cautiousBullishExposureMultiplier ?? 0.75,
    defensive: config.defensiveExposureMultiplier ?? 0.5,
    'panic/high volatility': config.panicExposureMultiplier ?? 0.25,
    unavailable: config.defensiveExposureMultiplier ?? 0.5 };
  return { state, available, source: 'SPY_QQQ_INDEPENDENT_BENCHMARKS',
    label: state === 'unavailable' ? 'Unavailable' : state.replace(/\b\w/g, char => char.toUpperCase()),
    exposureMultiplier: multipliers[state], observations: unique,
    evaluatedAt: new Date(now).toISOString(),
    riskMessage: !available ? 'Independent benchmark evidence unavailable; conservative exposure retained.'
      : 'Measured from SPY and QQQ prices and completed-bar trends, not candidate scores.',
    missingEvidenceReasons: available ? [] : [enabled ? 'FRESH_BENCHMARK_EVIDENCE_REQUIRED' : 'MARKET_REGIME_DISABLED'] };
}
