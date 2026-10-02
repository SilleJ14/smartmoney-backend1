function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

export function applyExecutionShock(model = {}, shock = {}) {
  return {
    ...model,
    spreadMultiplier: finite(model.spreadMultiplier ?? 1, "spreadMultiplier")
      * finite(shock.spreadMultiplier ?? 1, "shock spreadMultiplier"),
    slippageBps: finite(model.slippageBps ?? 0, "slippageBps") + finite(shock.slippageBps ?? 0, "shock slippageBps"),
    latencyMs: finite(model.latencyMs ?? 0, "latencyMs") + finite(shock.latencyMs ?? 0, "shock latencyMs"),
  };
}

export function shockedQuote(quote, spreadMultiplier = 1) {
  const bid = finite(quote.bid, "bid");
  const ask = finite(quote.ask, "ask");
  if (ask < bid) throw new Error("ask must be at least bid");
  const mid = (bid + ask) / 2;
  const halfSpread = (ask - bid) * finite(spreadMultiplier, "spreadMultiplier") / 2;
  return { ...quote, bid: mid - halfSpread, ask: mid + halfSpread };
}

export function simulateFill({
  side,
  units,
  submittedAt,
  quotes,
  model = {},
  holdHours = 0,
  longFinancingRate = 0,
  shortFinancingRate = 0,
  annualizationDays = 365,
} = {}) {
  if (!["buy", "sell"].includes(side)) throw new Error("side must be buy or sell");
  const quantity = Math.abs(finite(units, "units"));
  const readyAt = Number(submittedAt) + finite(model.latencyMs ?? 0, "latencyMs");
  const ordered = [...(quotes ?? [])].sort((a, b) => Number(a.at) - Number(b.at));
  const quote = ordered.find((row) => Number(row.at) >= readyAt);
  if (!quote) return { filled: false, reason: "NO_QUOTE_AFTER_LATENCY", readyAt };
  const adjusted = shockedQuote(quote, model.spreadMultiplier ?? 1);
  const touch = side === "buy" ? adjusted.ask : adjusted.bid;
  const adverse = touch * finite(model.slippageBps ?? 0, "slippageBps") / 10_000;
  const price = side === "buy" ? touch + adverse : touch - adverse;
  const mid = (adjusted.bid + adjusted.ask) / 2;
  const spreadCost = quantity * Math.abs(touch - mid);
  const slippageCost = quantity * adverse;
  const rate = side === "buy" ? finite(longFinancingRate, "longFinancingRate")
    : finite(shortFinancingRate, "shortFinancingRate");
  const financing = quantity * price * rate * (finite(holdHours, "holdHours") / 24) / annualizationDays;
  return Object.freeze({
    filled: true,
    side,
    units: quantity,
    submittedAt: Number(submittedAt),
    readyAt,
    filledAt: Number(quote.at),
    price,
    bid: adjusted.bid,
    ask: adjusted.ask,
    spreadCost,
    slippageCost,
    financing,
    totalCost: spreadCost + slippageCost + financing,
  });
}

export function roundTripPnL({ entry, exit, units, financing = 0 }) {
  const direction = entry.side === "buy" ? 1 : -1;
  return direction * (finite(exit.price, "exit.price") - finite(entry.price, "entry.price"))
    * Math.abs(finite(units, "units")) - finite(financing, "financing");
}
