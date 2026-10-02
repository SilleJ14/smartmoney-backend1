export const NUMERIC_CONFIG_KEYS = `minStockPrice maxStockPrice minScoreToBuy maxBotExposurePercent cryptoMaxExposureShareOfBotExposure stopLossPercent trailingStopPercent takeProfitPercent maxOpenTrades maxStockOpenTrades maxCryptoOpenTrades replaceWeakestMinScoreGap minAutonomousTradeAmount minCryptoTradeAmount pyramidMinProfitPercent pyramidMinScore pyramidMaxAddsPerSymbol pyramidAddSizePercent runnerTriggerPercent runnerTrailingStopPercent dailyLossLimitPercent profitLockTriggerPercent profitLockProtectPercent moversTop minVolume maxPercentChange maxSignalsToReturn topAutoTradeCandidates maxRotationsPerDay maxContinuationHoldStocks maxMorningTradesPerDay morningStrikeStartHourET morningStrikeEndHourET minPremarketGapPercent minPremarketRelativeVolume eliteMorningStrikeLimit aggressiveBullishExposureMultiplier cautiousBullishExposureMultiplier defensiveExposureMultiplier panicExposureMultiplier minVolumeSpikeRatio minCloseNearHighPercent fakeBreakoutMaxHighPullbackPercent maxGapUpPercent newsLookbackDays eliteConcentrationMinScore eliteConcentrationMaxMultiplier eliteConcentrationMinTradeAmount liveStarterBuyIntervalMs liveStarterBuyPercent liveStarterMinGateScore liveStarterMinFinalScore liveStarterMaxBuysPerCycle liveOrderMaxQuoteAgeSeconds liveOrderMaxSpreadPercent liveOrderLockMs liveDuplicateOrderWindowMs livePositionManagementIntervalMs liveProfitTrimTriggerPercent liveProfitTrimQtyPercent liveHardStopPercent liveTrailStopFromHighPercent liveScaleInIntervalMs liveScaleInMinProfitPercent liveScaleInMinFastScore liveScaleInPercentOfPlan liveScaleInMaxAddsPerSymbol liveScaleInMaxAddsPerCycle`.split(" ");
export const BOOLEAN_CONFIG_KEYS = `autoTradingEnabled tradingModeLocked enableMarketRegimeEngine enableAdvancedFilters requireAboveVwap enableNewsRiskFilter enableWeakestReplacement eliteCapitalConcentrationEnabled enableLiveStarterBuy enableLivePositionManagement enableLiveScaleIn liveOrderRequirePolygonConnected`.split(" ");

export const AUTOMATION_PREFERENCE_KEYS = Object.freeze([
  "minScoreToBuy",
  "maxOpenTrades",
  "maxStockOpenTrades",
  "maxCryptoOpenTrades",
  "maxBotExposurePercent",
  "cryptoMaxExposureShareOfBotExposure",
  "minAutonomousTradeAmount",
  "minCryptoTradeAmount",
  "stopLossPercent",
  "takeProfitPercent",
  "trailingStopPercent",
  "dailyLossLimitPercent",
  "profitLockTriggerPercent",
  "profitLockProtectPercent",
]);

const AUTOMATION_PREFERENCE_BOUNDS = Object.freeze({
  minScoreToBuy: [70, 100],
  maxOpenTrades: [0, 100],
  maxStockOpenTrades: [0, 100],
  maxCryptoOpenTrades: [0, 100],
  maxBotExposurePercent: [0, 100],
  cryptoMaxExposureShareOfBotExposure: [0, 100],
  minAutonomousTradeAmount: [0, 1_000_000],
  minCryptoTradeAmount: [0, 1_000_000],
  stopLossPercent: [0, 100],
  takeProfitPercent: [0, 1000],
  trailingStopPercent: [0, 100],
  dailyLossLimitPercent: [0, 100],
  profitLockTriggerPercent: [0, 100],
  profitLockProtectPercent: [0, 100],
});

const INTEGER_PREFERENCES = new Set([
  "maxOpenTrades",
  "maxStockOpenTrades",
  "maxCryptoOpenTrades",
]);

export function parseRemoteConfigUpdates(body = {}, emergencyStopActive = false) {
  const updates = {};
  for (const key of NUMERIC_CONFIG_KEYS) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value)) return { error: `Invalid number for ${key}`, received: body[key] };
    const bounds = AUTOMATION_PREFERENCE_BOUNDS[key];
    if (bounds && (value < bounds[0] || value > bounds[1])) {
      return { error: `${key} must be between ${bounds[0]} and ${bounds[1]}`, received: body[key] };
    }
    if (INTEGER_PREFERENCES.has(key) && !Number.isInteger(value)) {
      return { error: `${key} must be a whole number`, received: body[key] };
    }
    updates[key] = key === "minStockPrice" ? Math.max(0.5, value) : value;
  }
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (body[key] === undefined) continue;
    const value = body[key] === true || body[key] === "true" || body[key] === 1 || body[key] === "1";
    if (key === "autoTradingEnabled" && value && emergencyStopActive) {
      return { locked: true, error: "Emergency stop is active. Auto trading cannot be enabled." };
    }
    updates[key] = value;
  }
  if (body.tradingMode !== undefined) updates.tradingMode = String(body.tradingMode);
  return { updates };
}
