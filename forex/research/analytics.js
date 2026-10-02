function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function deviation(values, downside = false) {
  if (values.length < 2) return 0;
  const center = downside ? 0 : mean(values);
  const selected = downside ? values.map((value) => Math.min(0, value)) : values;
  return Math.sqrt(selected.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function performanceAnalytics(trades, { periodsPerYear = 252 } = {}) {
  const pnls = trades.map((trade) => Number(trade.pnl ?? trade.return ?? trade));
  const returns = trades.map((trade, index) => Number(trade.return ?? pnls[index]));
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = -losses.reduce((sum, value) => sum + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const risks = trades.map((trade) => Number(trade.risk ?? 0));
  const rMultiples = trades.map((trade, index) => Number(trade.rMultiple
    ?? (risks[index] > 0 ? pnls[index] / risks[index] : NaN))).filter(Number.isFinite);
  const scale = Math.sqrt(periodsPerYear);
  const standard = deviation(returns);
  const downside = deviation(returns, true);
  return Object.freeze({
    count: trades.length,
    netProfit: pnls.reduce((sum, value) => sum + value, 0),
    expectancy: mean(pnls),
    maxDrawdown,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    sharpe: standard ? mean(returns) / standard * scale : 0,
    sortino: downside ? mean(returns) / downside * scale : 0,
    winRate: wins.length / (trades.length || 1),
    averageR: mean(rMultiples),
  });
}

export function groupedAnalytics(trades, {
  keys = ["strategy", "regime", "session", "pair"],
  periodsPerYear = 252,
} = {}) {
  return Object.fromEntries(keys.map((key) => {
    const groups = new Map();
    for (const trade of trades) {
      const value = String(trade[key] ?? "UNKNOWN");
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(trade);
    }
    return [key, Object.fromEntries([...groups].map(([value, rows]) =>
      [value, performanceAnalytics(rows, { periodsPerYear })]))];
  }));
}
