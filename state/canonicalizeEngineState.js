import { compareCanonicalSignals } from "../scoring/canonicalSignalRank.js";

export function canonicalizeEngineStateAliases(
  engineState,
  CONFIG
) {
  engineState.sectorDominanceState =
    engineState.sectorDominanceState ||
    engineState.sectorDominationState ||
    null;

  engineState.sectorDominanceHistory =
    engineState.sectorDominanceHistory ||
    engineState.sectorDominationHistory ||
    [];

  engineState.autonomousCryptoStrategySelectorState =
    engineState.autonomousCryptoStrategySelectorState ||
    engineState.phase52CryptoStrategySelectorState ||
    null;

  engineState.autonomousCryptoStrategySelectorHistory =
    engineState.autonomousCryptoStrategySelectorHistory ||
    engineState.phase52CryptoStrategySelectorHistory ||
    [];

  engineState.lastStockSignals = Array.isArray(
    engineState.lastStockSignals
  )
    ? engineState.lastStockSignals
    : [];

  engineState.lastCryptoSignals = Array.isArray(
    engineState.lastCryptoSignals
  )
    ? engineState.lastCryptoSignals
    : [];

  engineState.topStockSignals = [
    ...engineState.lastStockSignals,
  ]
    .sort(compareCanonicalSignals)
    .slice(0, 25);

  engineState.topCryptoSignals = [
    ...engineState.lastCryptoSignals,
  ]
    .sort(compareCanonicalSignals)
    .slice(0, 25);

  engineState.topSignals = [
    ...engineState.topStockSignals,
    ...engineState.topCryptoSignals,
  ]
    .sort(compareCanonicalSignals)
    .slice(
      0,
      CONFIG.maxSignalsToReturn || 75
    );

  return engineState;
}
