// Detach durable-history work from large live candidate graphs before enqueueing.
// Keep every field read by quietCandidateOutcomeTracker, not live authorization,
// chart bars, raw provider responses, or previous central decision snapshots.
const scalarKeys = `symbol s T assetClass asset_class t evidenceDay d date c close
current livePrice price high h o liveQuoteUpdatedAt quoteUpdatedAt priceUpdatedAt
quoteFetchedAt dollarVolume24h dollarVolume averageDollarVolume marketCap market_cap
percentChange changePercent todaysChangePerc discoveryScore cryptoDiscoveryScore
preMoveScore discoveryTier cryptoDiscoveryTier tier scoringModelVersion marketRegime
cryptoRegime regime`.split(/\s+/);
export function outcomeInput(row = {}) {
  const result = {};
  for (const key of scalarKeys) if (row[key] !== undefined) result[key] = row[key];
  for (const key of ['discoveryScorecard', 'cryptoDiscoveryScorecard']) {
    if (row[key]) result[key] = { score: row[key].score, components: row[key].components,
      ...(key === 'cryptoDiscoveryScorecard' ? { extension: row[key].extension } : {}) };
  }
  for (const key of ['components', 'extension', 'extensionProfile', 'newsCatalyst', 'catalystRanking']) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  return structuredClone(result);
}
