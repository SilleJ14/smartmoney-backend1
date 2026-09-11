export function canRefreshStockQuotes({ marketOpen = false, marketSession = "closed" } = {}) {
  // Research availability is not permission to trade. Keep after-hours quote
  // polling, Tradier subscriptions and early reassessment alive; order paths
  // still require the broker's regular-market-open clock independently.
  const session = String(marketSession).toLowerCase();
  return marketOpen === true || session === "premarket" || session === "afterhours" || session === "regular_research";
}

export function getStockMoverQuotePolicy({
  marketOpen = false,
  marketSession = "closed",
  regularMaxQuoteAgeSeconds = 5,
  regularMaxSpreadPercent = 2,
  regularMinDollarVolume = 100000,
  premarketMaxQuoteAgeSeconds = 30,
  premarketMaxSpreadPercent = 3,
  premarketMinDollarVolume = 25000,
} = {}) {
  const premarket = marketOpen !== true && String(marketSession).toLowerCase() === "premarket";
  if (premarket) {
    return {
      session: "premarket",
      discoveryOnly: true,
      maxQuoteAgeSeconds: premarketMaxQuoteAgeSeconds,
      maxSpreadPercent: premarketMaxSpreadPercent,
      minDollarVolume: premarketMinDollarVolume,
    };
  }
  return {
    session: marketOpen === true ? "regular" : String(marketSession || "closed"),
    discoveryOnly: marketOpen !== true,
    maxQuoteAgeSeconds: regularMaxQuoteAgeSeconds,
    maxSpreadPercent: regularMaxSpreadPercent,
    minDollarVolume: regularMinDollarVolume,
  };
}
