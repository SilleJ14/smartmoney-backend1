export function compactPersistedEngineStateSnapshot(snapshot = {}) {
  const compact = { ...snapshot };

  compact.liveMarketMemory = {};
  compact.liveQuoteCache = {};

  compact.analyticsSnapshots = (compact.analyticsSnapshots || []).slice(0, 50);
  compact.institutionalDashboardSnapshots = (compact.institutionalDashboardSnapshots || []).slice(0, 50);
  compact.aiDecisionHistory = (compact.aiDecisionHistory || []).slice(0, 150);

  for (const key of Object.keys(compact)) {
    if (key.endsWith("History") && Array.isArray(compact[key])) {
      compact[key] = compact[key].slice(0, 75);
    }
  }

  compact.sectorDominanceState =
    compact.sectorDominanceState || compact.sectorDominationState || null;

  compact.sectorDominanceHistory =
    compact.sectorDominanceHistory || compact.sectorDominationHistory || [];

  delete compact.sectorDominationState;
  delete compact.sectorDominationHistory;

  compact.autonomousCryptoStrategySelectorState =
    compact.autonomousCryptoStrategySelectorState ||
    compact.phase52CryptoStrategySelectorState ||
    null;

  compact.autonomousCryptoStrategySelectorHistory =
    compact.autonomousCryptoStrategySelectorHistory ||
    compact.phase52CryptoStrategyHistory ||
    compact.phase52CryptoStrategySelectorHistory ||
    [];

  delete compact.phase52CryptoStrategySelectorState;
  delete compact.phase52CryptoStrategySelectorHistory;

  return compact;
}