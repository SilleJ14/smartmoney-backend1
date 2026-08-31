function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function buildRotatingScanUniverse({
  symbols = [],
  guaranteedSymbols = [],
  getWeight,
  maxSymbols = 60,
  cursor = 0,
  explorationRatio = 0.2,
} = {}) {
  const boundedMax = Math.max(1, Number(maxSymbols) || 60);
  const reviewed = unique(symbols)
    .map((symbol) => getWeight(symbol))
    .filter((item) => item?.symbol)
    .sort((left, right) => Number(right.scanWeight || 0) - Number(left.scanWeight || 0));
  const reviewedSymbols = reviewed.map((item) => item.symbol);
  const guaranteed = unique(guaranteedSymbols)
    .filter((symbol) => reviewedSymbols.includes(symbol) || symbol)
    .slice(0, Math.floor(boundedMax * 0.4));
  const remaining = reviewedSymbols.filter((symbol) => !guaranteed.includes(symbol));
  const explorationCount = Math.min(
    remaining.length,
    Math.max(1, Math.floor(boundedMax * explorationRatio))
  );
  const start = remaining.length > 0
    ? Math.abs(Math.trunc(Number(cursor) || 0)) % remaining.length
    : 0;
  const explorationSymbols = [];
  for (let offset = 0; offset < explorationCount; offset += 1) {
    explorationSymbols.push(remaining[(start + offset) % remaining.length]);
  }
  const selected = unique([
    ...guaranteed,
    ...explorationSymbols,
    ...remaining,
  ]).slice(0, boundedMax);

  return {
    symbols: selected,
    explorationSymbols,
    nextCursor: remaining.length > 0
      ? (start + explorationCount) % remaining.length
      : 0,
    reviewed,
  };
}
