export const NUMERIC_CONFIG_KEYS = `minStockPrice maxStockPrice minScoreToBuy maxBotExposurePercent cryptoMaxExposureShareOfBotExposure stopLossPercent trailingStopPercent takeProfitPercent maxOpenTrades maxStockOpenTrades maxCryptoOpenTrades replaceWeakestMinScoreGap targetCapitalSlots minAutonomousTradeAmount pyramidMinProfitPercent pyramidMinScore pyramidMaxAddsPerSymbol pyramidAddSizePercent runnerTriggerPercent runnerTrailingStopPercent dailyLossLimitPercent profitLockTriggerPercent profitLockProtectPercent moversTop minVolume maxPercentChange maxSignalsToReturn topAutoTradeCandidates maxRotationsPerDay maxContinuationHoldStocks maxMorningTradesPerDay morningStrikeStartHourET morningStrikeEndHourET minPremarketGapPercent minPremarketRelativeVolume eliteMorningStrikeLimit aggressiveBullishExposureMultiplier cautiousBullishExposureMultiplier defensiveExposureMultiplier panicExposureMultiplier minVolumeSpikeRatio minCloseNearHighPercent fakeBreakoutMaxHighPullbackPercent maxGapUpPercent newsLookbackDays eliteConcentrationMinScore eliteConcentrationMaxMultiplier eliteConcentrationMinTradeAmount liveStarterBuyIntervalMs liveStarterBuyPercent liveStarterMinGateScore liveStarterMinFinalScore liveStarterMaxBuysPerCycle liveOrderMaxQuoteAgeSeconds liveOrderMaxSpreadPercent liveOrderLockMs liveDuplicateOrderWindowMs livePositionManagementIntervalMs liveProfitTrimTriggerPercent liveProfitTrimQtyPercent liveHardStopPercent liveTrailStopFromHighPercent liveScaleInIntervalMs liveScaleInMinProfitPercent liveScaleInMinFastScore liveScaleInPercentOfPlan liveScaleInMaxAddsPerSymbol liveScaleInMaxAddsPerCycle`.split(" ");
export const BOOLEAN_CONFIG_KEYS = `autoTradingEnabled tradingModeLocked enableMarketRegimeEngine enableAdvancedFilters requireAboveVwap enableNewsRiskFilter enableWeakestReplacement eliteCapitalConcentrationEnabled enableLiveStarterBuy enableLivePositionManagement enableLiveScaleIn liveOrderRequirePolygonConnected`.split(" ");

export function parseRemoteConfigUpdates(body = {}, emergencyStopActive = false) {
  const updates = {};
  for (const key of NUMERIC_CONFIG_KEYS) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value)) return { error: `Invalid number for ${key}`, received: body[key] };
    updates[key] = key === "minScoreToBuy" ? Math.max(70, value) : value;
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
