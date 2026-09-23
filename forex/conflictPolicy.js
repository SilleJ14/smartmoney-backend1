export function resolveStrategyConflict(candidates = []) {
  const byPair = new Map();
  for (const row of candidates) {
    const key = `${row.identity}:${row.instrument || row.identity}`;
    const list = byPair.get(key) || [];
    list.push(row);
    byPair.set(key, list);
  }
  for (const list of byPair.values()) {
    // A range being watched in both directions is not two opposing trade signals.
    const live = list.filter((row) => ["TRIGGER_CONFIRMED", "EXECUTION_ELIGIBLE"].includes(row.state));
    const sides = new Set(live.map((row) => row.side));
    if (sides.size > 1) {
      for (const row of live) {
        row.state = "BLOCKED";
        row.lastReason = "STRATEGY_CONFLICT";
        row.blockers = [...(row.blockers || []), "STRATEGY_CONFLICT"];
        row.executionAuthorization = "None";
      }
    }
    const strategies = new Set(live.map((row) => row.strategyId));
    if (strategies.size > 1) {
      for (const row of live) {
        if (row.state === "EXECUTION_ELIGIBLE") {
          row.pending = [...(row.pending || []), "Independent strategy approval required"];
        }
      }
    }
  }
  return candidates;
}

export function oneOpenPerPair(openTrades = [], instrument) {
  return openTrades.some((trade) => trade.instrument === instrument && Number(trade.currentUnits) !== 0);
}
