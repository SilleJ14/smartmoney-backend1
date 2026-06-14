
const DEFAULT_LIMITS = {
  maxMovers: 250,
  maxCrypto: 250,
  maxAlpaca: 250,
  maxOpportunities: 300,
  maxHistoryPerSymbol: 50,
  maxNewsPerSymbol: 20,
  maxErrors: 100,
  maxTrades: 300,
};

function trimArray(value, max) {
  if (!Array.isArray(value)) return [];
  if (value.length <= max) return value;
  return value.slice(-max);
}

function pruneSymbolMap(map, maxHistoryPerSymbol, maxNewsPerSymbol) {
  if (!map || typeof map !== "object") return {};

  const next = {};

  for (const [symbol, data] of Object.entries(map)) {
    if (!data || typeof data !== "object") {
      next[symbol] = data;
      continue;
    }

    next[symbol] = {
      ...data,

      history: trimArray(data.history, maxHistoryPerSymbol),
      candles: trimArray(data.candles, maxHistoryPerSymbol),
      prices: trimArray(data.prices, maxHistoryPerSymbol),
      signals: trimArray(data.signals, maxHistoryPerSymbol),
      news: trimArray(data.news, maxNewsPerSymbol),
      events: trimArray(data.events, maxNewsPerSymbol),
    };
  }

  return next;
}

export function pruneEngineState(engineState = {}, limits = {}) {
  const cfg = {
    ...DEFAULT_LIMITS,
    ...limits,
  };

  const pruned = {
    ...engineState,
  };

  // Main scanner arrays
  pruned.movers = trimArray(engineState.movers, cfg.maxMovers);
  pruned.crypto = trimArray(engineState.crypto, cfg.maxCrypto);
  pruned.alpaca = trimArray(engineState.alpaca, cfg.maxAlpaca);
  pruned.opportunities = trimArray(
    engineState.opportunities,
    cfg.maxOpportunities
  );

  // Logs / memory-heavy arrays
  pruned.errors = trimArray(engineState.errors, cfg.maxErrors);
  pruned.trades = trimArray(engineState.trades, cfg.maxTrades);
  pruned.tradeHistory = trimArray(engineState.tradeHistory, cfg.maxTrades);
  pruned.autoTrades = trimArray(engineState.autoTrades, cfg.maxTrades);

  // Per-symbol memory control
  pruned.symbols = pruneSymbolMap(
    engineState.symbols,
    cfg.maxHistoryPerSymbol,
    cfg.maxNewsPerSymbol
  );

  pruned.priceHistory = pruneSymbolMap(
    engineState.priceHistory,
    cfg.maxHistoryPerSymbol,
    cfg.maxNewsPerSymbol
  );

  pruned.newsBySymbol = pruneSymbolMap(
    engineState.newsBySymbol,
    cfg.maxHistoryPerSymbol,
    cfg.maxNewsPerSymbol
  );

  pruned.lastPrunedAt = new Date().toISOString();

  return pruned;
}

export default pruneEngineState;