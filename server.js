import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const CONFIG_FILE = path.resolve(process.cwd(), "runtime-config.json");
const ENGINE_STATE_FILE = path.resolve(process.cwd(), "engine-state.json");

console.log("ENV CHECK:", {
  ALPACA_LIVE_SECRET: process.env.ALPACA_LIVE_SECRET ? "FOUND" : "MISSING",
  ALPACA_LIVE_KEY: process.env.ALPACA_LIVE_KEY ? "FOUND" : "MISSING",
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ? "FOUND" : "MISSING",
});

const app = express();
app.use(cors());
app.use(express.json());

let runtimeAlpacaKeys = {
  liveKey: process.env.ALPACA_LIVE_KEY || "",
  liveSecret: process.env.ALPACA_LIVE_SECRET || "",
};

app.post("/alpaca-keys", (req, res) => {
  const { liveKey, liveSecret } = req.body;

  runtimeAlpacaKeys = {
    liveKey: liveKey || runtimeAlpacaKeys.liveKey,
    liveSecret: liveSecret || runtimeAlpacaKeys.liveSecret,
  };

  res.json({
    success: true,
    message: "Alpaca keys saved",
  });
});
app.get("/alpaca-keys-test", (req, res) => {
  res.json({
    ok: true,
    message: "Alpaca keys route is live",
  });
});
const PORT = Number(process.env.PORT || 10000);

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

function loadRuntimeConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveRuntimeConfig(updates = {}) {
  const current = loadRuntimeConfig();

  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ADDED CODE
function loadPersistedEngineState() {
  try {
    if (!fs.existsSync(ENGINE_STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(ENGINE_STATE_FILE, "utf8"));
  } catch (err) {
    console.error("Could not load engine-state.json:", err.message);
    return {};
  }
}

function getTodayKeyET() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

function resetDailySafetyStateIfNewDay(account) {
  const todayKey = getTodayKeyET();
  const equity = Number(account?.equity || 0);

  if (!equity || equity <= 0) return false;

  if (engineState.dailyDateKey !== todayKey) {
    engineState.dailyDateKey = todayKey;

    engineState.dailyStartEquity = equity;
    engineState.dailyPeakEquity = equity;

    engineState.profitLockFloorEquity = null;

    engineState.dailyLossLocked = false;
    engineState.profitLocked = false;

    saveRecentOrder("DAILY_SAFETY_RESET", "ACCOUNT", {
      todayKey,
      equity,
    });

    saveEngineState("DAILY_SAFETY_RESET");

    return true;
  }

  return false;
}
function saveEngineState(reason = "STATE_UPDATE") {
  try {
    const safeState = {
      reason,
      savedAt: new Date().toISOString(),

      dailyStartEquity: engineState.dailyStartEquity,
      dailyPeakEquity: engineState.dailyPeakEquity,
      profitLockFloorEquity: engineState.profitLockFloorEquity,
      dailyDateKey: engineState.dailyDateKey,

      dailyLossLocked: engineState.dailyLossLocked,
      profitLocked: engineState.profitLocked,
      dailyDateKey: engineState.dailyDateKey,
      dailyStartEquity: engineState.dailyStartEquity,
      dailyPeakEquity: engineState.dailyPeakEquity,
      profitLockFloorEquity: engineState.profitLockFloorEquity,

      highWaterMarks: engineState.highWaterMarks || {},
      tradeMemory: engineState.tradeMemory || {},
      aiEntryScores: engineState.aiEntryScores || {},
      runnerPositions: engineState.runnerPositions || {},
      lastSoldAt: engineState.lastSoldAt || {},
      peaksByMode: engineState.peaksByMode || {},
      aiManagedSymbols: engineState.aiManagedSymbols || [],
institutionalWatchlist:
  engineState.institutionalWatchlist || [],
  analyticsSnapshots:
  (engineState.analyticsSnapshots || []).slice(0, 300),
  apiHealth: engineState.apiHealth || {},
  apiFailureCounts:
  engineState.apiFailureCounts || {},
  apiCooldowns:
  engineState.apiCooldowns || {},
  signalHistory:
  (engineState.signalHistory || []).slice(0, 200),
marketRegimeHistory:
  (engineState.marketRegimeHistory || []).slice(0, 200),
sectorStrengthHistory:
  (engineState.sectorStrengthHistory || []).slice(0, 200),
  sectorRotationState:
  engineState.sectorRotationState || null,
sectorRotationHistory:
  (engineState.sectorRotationHistory || []).slice(0, 200),
  capitalRedistributionState:
  engineState.capitalRedistributionState || null,
capitalRedistributionHistory:
  (engineState.capitalRedistributionHistory || []).slice(0, 200),
  multiTimeframeState:
  engineState.multiTimeframeState || null,
multiTimeframeHistory:
  (engineState.multiTimeframeHistory || []).slice(0, 200),

signalQualityHistory:
  (engineState.signalQualityHistory || []).slice(0, 200),
marketBreadthHistory:
  (engineState.marketBreadthHistory || []).slice(0, 200),
marketMomentumHistory:
  (engineState.marketMomentumHistory || []).slice(0, 200),
marketVolatilityHistory:
  (engineState.marketVolatilityHistory || []).slice(0, 200),
institutionalExposureHistory:
  (engineState.institutionalExposureHistory || []).slice(0, 200),
  marketCrashProtectionState:
  engineState.marketCrashProtectionState || null,

marketCrashProtectionHistory:
  (engineState.marketCrashProtectionHistory || []).slice(0, 200),
aiDecisionHistory:
  (engineState.aiDecisionHistory || []).slice(0, 500),
      recentOrders: (engineState.recentOrders || []).slice(0, 100),
      failedOrders: (engineState.failedOrders || []).slice(0, 100),
      skippedSymbols: (engineState.skippedSymbols || []).slice(0, 150),
      lastScanAt: engineState.lastScanAt,
lastHeartbeatAt: engineState.lastHeartbeatAt,
lastTickStartedAt: engineState.lastTickStartedAt,
lastTickDurationMs: engineState.lastTickDurationMs,
lastSuccessfulCycleAt: engineState.lastSuccessfulCycleAt,
lastEngineStopReason: engineState.lastEngineStopReason,
totalEngineTicks: engineState.totalEngineTicks,

marketOpen: engineState.marketOpen,
marketStressLevel: engineState.marketStressLevel,
marketMomentumScore: engineState.marketMomentumScore,
marketVolatility: engineState.marketVolatility,
marketBreadth: engineState.marketBreadth,
marketRegime: engineState.marketRegime,
institutionalExposureMode: engineState.institutionalExposureMode,

engineFreezeDetected: engineState.engineFreezeDetected,
engineFreezeCount: engineState.engineFreezeCount,
      pendingExits: engineState.pendingExits || [],
    };

    fs.writeFileSync(ENGINE_STATE_FILE, JSON.stringify(safeState, null, 2));
    return safeState;
  } catch (err) {
    console.error("Could not save engine-state.json:", err.message);
    return null;
  }
}

const runtimeConfig = loadRuntimeConfig();
const persistedEngineState = loadPersistedEngineState();


// 🔥 Trading Mode (PERSISTED)
let TRADING_MODE = runtimeConfig.tradingMode || process.env.TRADING_MODE || "smart";

let tradingModeLocked =
  runtimeConfig.tradingModeLocked === true ||
  process.env.TRADING_MODE_LOCKED === "true";

function getEffectiveTradingMode(marketOpen) {
  if (TRADING_MODE === "smart") {
    return marketOpen ? "live_stock" : "live_crypto";
  }
  return TRADING_MODE;
}

function getAlpacaKeys() {
  return {
    key: runtimeAlpacaKeys.liveKey || process.env.ALPACA_LIVE_KEY,
    secret: runtimeAlpacaKeys.liveSecret || process.env.ALPACA_LIVE_SECRET,
  };
}
function getTradingBaseUrl() {
  return "https://api.alpaca.markets";
}

const ALPACA_DATA_BASE_URL =
  process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets";

let autoTradingEnabled = process.env.AUTO_TRADING === "true";

const AI_ORDER_PREFIX = "SM_AI";


const CONFIG = {
  maxOpenTrades: Number(process.env.MAX_OPEN_TRADES || 2),

  minStockPrice: Number(process.env.MIN_STOCK_PRICE || 1),
  maxStockPrice: 0,

  minScoreToBuy: Number(process.env.MIN_SCORE_TO_BUY || 70),
  replaceWeakestMinScoreGap: Number(process.env.REPLACE_SCORE_GAP || 5),

  maxBotExposurePercent: Number(process.env.MAX_BOT_EXPOSURE_PERCENT || 2),

  // EXIT SETTINGS
  takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT || 6),
  stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || -0.5),
  trailingStopPercent: Number(process.env.TRAILING_STOP_PERCENT || -0.5),

  // RUNNER STRATEGY
  runnerTriggerPercent: Number(process.env.RUNNER_TRIGGER_PERCENT || 6),
  runnerTrailingStopPercent: Number(
    process.env.RUNNER_TRAILING_STOP_PERCENT || 0.5
  ),

  dailyLossLimitPercent: Number(process.env.DAILY_LOSS_LIMIT_PERCENT || 2),

  profitLockTriggerPercent: Number(process.env.PROFIT_LOCK_TRIGGER_PERCENT || 2),
  profitLockProtectPercent: Number(process.env.PROFIT_LOCK_PROTECT_PERCENT || 50),

  moversTop: Number(process.env.MOVERS_TOP || 50),
  minVolume: Number(process.env.MIN_VOLUME || 5000),
  minScanVolume: Number(process.env.MIN_SCAN_VOLUME || 5000),
  maxPercentChange: Number(process.env.MAX_PERCENT_CHANGE || 80),
  maxSignalsToReturn: Number(process.env.MAX_SIGNALS_TO_RETURN || 80),

  topAutoTradeCandidates: Number(process.env.TOP_AUTO_TRADE_CANDIDATES || 5),
  enableMarketRegimeEngine:
    process.env.ENABLE_MARKET_REGIME_ENGINE !== "false",
  aggressiveBullishExposureMultiplier: Number(
    process.env.AGGRESSIVE_BULLISH_EXPOSURE_MULTIPLIER || 1
  ),
  cautiousBullishExposureMultiplier: Number(
    process.env.CAUTIOUS_BULLISH_EXPOSURE_MULTIPLIER || 0.75
  ),
  defensiveExposureMultiplier: Number(
    process.env.DEFENSIVE_EXPOSURE_MULTIPLIER || 0.4
  ),
  panicExposureMultiplier: Number(
    process.env.PANIC_EXPOSURE_MULTIPLIER || 0
  ),
  // ADVANCED FILTERS (FIXED)
  // ADVANCED FILTERS
  enableAdvancedFilters: process.env.ENABLE_ADVANCED_FILTERS !== "false",
  minVolumeSpikeRatio: Number(process.env.MIN_VOLUME_SPIKE_RATIO || 0.5),
  minCloseNearHighPercent: Number(process.env.MIN_CLOSE_NEAR_HIGH_PERCENT || 25),
  fakeBreakoutMaxHighPullbackPercent: Number(
    process.env.FAKE_BREAKOUT_MAX_HIGH_PULLBACK_PERCENT || 2
  ),
  maxGapUpPercent: Number(process.env.MAX_GAP_UP_PERCENT || 30),

  // 🔥 IMPORTANT FIX
  requireAboveVwap: process.env.REQUIRE_ABOVE_VWAP === "true",

  enableNewsRiskFilter: process.env.ENABLE_NEWS_RISK_FILTER === "true",
  newsLookbackDays: Number(process.env.NEWS_LOOKBACK_DAYS || 3),
};
// LINE BEFORE
let engineState = {
  running: false,

  lastScanAt: null,
  lastHeartbeatAt: null,

  lastTickStartedAt: null,
  lastTickDurationMs: null,
  lastScanDurationMs: null,
  lastSuccessfulCycleAt: null,
lastEngineStopReason: null,
engineFreezeDetected: false,
engineFreezeCount: 0,
  totalEngineTicks: 0,

  lastError: null,

  marketOpen: false,
  marketStressLevel: 0,
  averageSignalScore: 0,
  marketMomentumScore: 0,
  marketVolatility: 0,
  institutionalExposureMode: "NORMAL",
  marketBreadth: {
  advancing: 0,
  declining: 0,
},
  dailyDateKey: null,

  lastSignals: [],

  recentOrders: [],
  failedOrders: [],
  skippedSymbols: [],
  pendingExits: [],

  dailyStartEquity: null,
  dailyPeakEquity: null,
  profitLockFloorEquity: null,

  dailyLossLocked: false,
  profitLocked: false,

  highWaterMarks: {},
  tradeMemory: {},
  aiEntryScores: {},

  runnerPositions: {},
  lastSoldAt: {},
  symbolCooldowns: {},
  cooldownMinutes: 30,
  peaksByMode: {},

  cachedPositions: [],
  cachedAccount: null,

  aiManagedSymbols: [], 
  institutionalWatchlist: [],
  analyticsSnapshots: [],
  analyticsSnapshots: [],
  apiHealth: {},
  apiFailureCounts: {},
  apiCooldowns: {},
  signalHistory: [],
marketRegimeHistory: [],
sectorStrengthHistory: [],
sectorRotationState: null,
sectorRotationHistory: [],
capitalRedistributionState: null,
capitalRedistributionHistory: [],
multiTimeframeState: null,
multiTimeframeHistory: [],
signalQualityHistory: [],
marketBreadthHistory: [],
marketMomentumHistory: [],
marketVolatilityHistory: [],
institutionalExposureHistory: [],
marketCrashProtectionState: null,
marketCrashProtectionHistory: [],
aiDecisionHistory: [],
};

engineState = {
  ...engineState,
  ...persistedEngineState,

  // Never restore running/cached live broker data from disk.
  running: false,
  cachedPositions: [],
  cachedAccount: null,
  lastError: null,
};

const sellingNow = new Set();
const buyingNow = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function runInBatches(items, batchSize, worker) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map((item) => worker(item))
    );

    results.push(...batchResults.filter(Boolean));

    await sleep(500);
  }

  return results;
}
function updateAccountPeaks(account) {
  const mode = TRADING_MODE;
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);

  if (!engineState.peaksByMode[mode]) {
    engineState.peaksByMode[mode] = {
      peakEquity: equity,
      peakCash: cash,
    };
  }

  engineState.peaksByMode[mode].peakEquity = Math.max(
    Number(engineState.peaksByMode[mode].peakEquity || 0),
    equity
  );

  engineState.peaksByMode[mode].peakCash = Math.max(
    Number(engineState.peaksByMode[mode].peakCash || 0),
    cash
  );

  return engineState.peaksByMode[mode];
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function markAiManagedSymbol(symbol) {
  const clean = normalizeSymbol(symbol);

  if (!clean) return;

  if (!engineState.aiManagedSymbols.includes(clean)) {
    engineState.aiManagedSymbols.push(clean);
    saveEngineState("AI_MANAGED_SYMBOL_ADDED");
  }
}

function saveFailedOrder(type, symbol, reason, extra = {}) {
  engineState.failedOrders.unshift({
    type,
    symbol,
    reason,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.failedOrders = engineState.failedOrders.slice(0, 100);
  saveEngineState("FAILED_ORDER");
}

function rememberTradeResult(symbol, result) {

  const normalized = normalizeSymbol(symbol);

  if (!engineState.tradeMemory) {
    engineState.tradeMemory = {};
  }

  const current = engineState.tradeMemory[normalized] || {
    losses: 0,
    wins: 0,
    lastLossAt: 0,
    lastWinAt: 0,
    lastReason: "",
  };

  if (result.profitPercent < 0) {
    current.losses += 1;
    current.lastLossAt = Date.now();
    current.lastReason = result.reason || "LOSS";
  } else {
    current.wins += 1;
    current.lastWinAt = Date.now();
    current.lastReason = result.reason || "WIN";
  }

  engineState.tradeMemory[normalized] = current;
}

function shouldSkipFromTradeMemory(symbol) {
  const normalized = normalizeSymbol(symbol);
  const memory = engineState.tradeMemory?.[normalized];

  if (!memory) return false;

  const minutesSinceLoss = memory.lastLossAt
    ? (Date.now() - memory.lastLossAt) / 1000 / 60
    : Infinity;

  if (memory.losses >= 2 && minutesSinceLoss < 240) {
    return true;
  }

  return false;
}

function saveRecentOrder(type, symbol, extra = {}) {
  engineState.recentOrders.unshift({
    type,
    symbol,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.recentOrders = engineState.recentOrders.slice(0, 100);
  saveEngineState("RECENT_ORDER");
}


function getEngineFreshness() {
  const lastScanTime = engineState.lastScanAt
    ? new Date(engineState.lastScanAt).getTime()
    : 0;

  const ageSeconds = lastScanTime
    ? Math.round((Date.now() - lastScanTime) / 1000)
    : null;

  return {
    lastScanAt: engineState.lastScanAt,
    ageSeconds,
    stale: ageSeconds === null || ageSeconds > 180,
    staleAfterSeconds: 180,
  };
}
function saveSkippedSymbol(symbol, reason) {
  engineState.skippedSymbols.unshift({
    symbol,
    reason,
    at: new Date().toISOString(),
  });

  engineState.skippedSymbols = engineState.skippedSymbols.slice(0, 150);
  saveEngineState("SKIPPED_SYMBOL");
}

function getBotExposure(openPositions = []) {
  return openPositions.reduce((sum, position) => {
    return sum + Math.abs(Number(position.market_value || 0));
  }, 0);
}
function estimateSectorIntelligence(q) {
  const symbol = normalizeSymbol(q.symbol);
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};

  const techLike = ["AI", "NET", "HUBS", "UPWK", "FROG", "RKLB", "RXT"];
  const healthcareLike = ["AMPH", "SRTS", "AMN"];
  const industrialLike = ["KODK", "CORD", "ALTG"];
  const speculativeLike = ["TEAD", "FLUX", "KMLI", "SNDQ", "NETG"];

  let estimatedSector = "General Market";
  if (techLike.includes(symbol)) estimatedSector = "Technology / Innovation";
  if (healthcareLike.includes(symbol)) estimatedSector = "Healthcare";
  if (industrialLike.includes(symbol)) estimatedSector = "Industrial";
  if (speculativeLike.includes(symbol) || price < 5) estimatedSector = "Speculative Small Cap";

  const sectorMomentumScore = clampScore(
    50 +
    (percentChange > 0 && percentChange <= 20 ? 15 : 0) -
    (percentChange > 40 ? 20 : 0) +
    (confirmations.closeNearHigh ? 10 : 0)
  );

  const sectorRiskScore = clampScore(
    75 -
    (estimatedSector === "Speculative Small Cap" ? 25 : 0) -
    (confirmations.fakeBreakout ? 30 : 0) -
    (confirmations.newsRisk ? 25 : 0) -
    (volume < 25000 ? 10 : 0)
  );

  const sectorLiquidityScore = clampScore(
    40 +
    (volume >= 1000000 ? 35 : volume >= 250000 ? 25 : volume >= 25000 ? 15 : -10) +
    (price >= 5 ? 10 : -10)
  );

  const sectorLeadershipScore = clampScore(
    45 +
    (percentChange >= 2 && percentChange <= 20 ? 15 : 0) +
    (volume >= 250000 ? 10 : 0) +
    (confirmations.aboveVwap ? 8 : 0) -
    (percentChange > 50 ? 20 : 0)
  );

  const sectorScore = clampScore(
    sectorMomentumScore * 0.3 +
    sectorRiskScore * 0.3 +
    sectorLiquidityScore * 0.2 +
    sectorLeadershipScore * 0.2
  );

  const sectorRole =
    sectorScore >= 80
      ? "Sector Leader"
      : sectorScore >= 65
        ? "Strong Sector Candidate"
        : sectorScore >= 50
          ? "Sector Watchlist"
          : "Sector Risk Candidate";

  return {
    estimatedSector,
    sectorScore,
    sectorMomentumScore,
    sectorRiskScore,
    sectorLiquidityScore,
    sectorLeadershipScore,
    sectorRole,
  };
}

function updateInstitutionalWatchlist(signals = []) {
  const existing = Array.isArray(engineState.institutionalWatchlist)
    ? engineState.institutionalWatchlist
    : [];

  const now = new Date().toISOString();

  const strongSignals = (signals || [])
    .filter((signal) => Number(signal.score || 0) >= CONFIG.minScoreToBuy)
    .slice(0, 20);

  const mergedMap = new Map();

  for (const item of existing) {
    if (!item?.symbol) continue;

    mergedMap.set(normalizeSymbol(item.symbol), {
      ...item,
      symbol: normalizeSymbol(item.symbol),
    });
  }

  for (const signal of strongSignals) {
    const symbol = normalizeSymbol(signal.symbol);
    if (!symbol) continue;

    const previous = mergedMap.get(symbol);

    mergedMap.set(symbol, {
      symbol,
      score: Number(signal.score || 0),
      previousScore: Number(previous?.score || signal.score || 0),
      scoreChange: Number(signal.score || 0) - Number(previous?.score || signal.score || 0),
      price: Number(signal.current || signal.price || 0),
      assetClass: signal.assetClass || signal.asset_class || "stock",
      qualifiedToBuy: signal.qualifiedToBuy !== false,
      firstSeenAt: previous?.firstSeenAt || now,
      updatedAt: now,
    });
  }

  engineState.institutionalWatchlist = Array.from(mergedMap.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 50);

  return engineState.institutionalWatchlist;
}

function calculateAiSectorRotationEngine(stockSignals = []) {
  const sectorMap = {};

  for (const signal of stockSignals || []) {
    const sectorInfo =
      signal.estimatedSector
        ? signal
        : estimateSectorIntelligence(signal);

    const sector = sectorInfo.estimatedSector || "General Market";

    if (!sectorMap[sector]) {
      sectorMap[sector] = {
        sector,
        symbols: [],
        totalScore: 0,
        totalMomentum: 0,
        totalRisk: 0,
        totalLiquidity: 0,
        totalLeadership: 0,
        count: 0,
      };
    }

    sectorMap[sector].symbols.push(signal.symbol);
    sectorMap[sector].totalScore += Number(sectorInfo.sectorScore || signal.score || 0);
    sectorMap[sector].totalMomentum += Number(sectorInfo.sectorMomentumScore || 0);
    sectorMap[sector].totalRisk += Number(sectorInfo.sectorRiskScore || 0);
    sectorMap[sector].totalLiquidity += Number(sectorInfo.sectorLiquidityScore || 0);
    sectorMap[sector].totalLeadership += Number(sectorInfo.sectorLeadershipScore || 0);
    sectorMap[sector].count += 1;
  }

  const sectors = Object.values(sectorMap)
    .map((item) => {
      const count = Math.max(1, item.count);

      const averageScore = item.totalScore / count;
      const averageMomentum = item.totalMomentum / count;
      const averageRisk = item.totalRisk / count;
      const averageLiquidity = item.totalLiquidity / count;
      const averageLeadership = item.totalLeadership / count;

      const rotationScore = clampScore(
        averageScore * 0.35 +
          averageMomentum * 0.2 +
          averageRisk * 0.2 +
          averageLiquidity * 0.1 +
          averageLeadership * 0.15
      );

      const rotationBias =
        rotationScore >= 80
          ? "OVERWEIGHT"
          : rotationScore >= 65
          ? "ACCUMULATE"
          : rotationScore >= 50
          ? "NEUTRAL"
          : "AVOID";

      return {
        sector: item.sector,
        symbols: item.symbols.slice(0, 10),
        signalCount: item.count,
        averageScore: Number(averageScore.toFixed(2)),
        averageMomentum: Number(averageMomentum.toFixed(2)),
        averageRisk: Number(averageRisk.toFixed(2)),
        averageLiquidity: Number(averageLiquidity.toFixed(2)),
        averageLeadership: Number(averageLeadership.toFixed(2)),
        rotationScore: Number(rotationScore.toFixed(2)),
        rotationBias,
      };
    })
    .sort((a, b) => b.rotationScore - a.rotationScore);

  return {
    updatedAt: new Date().toISOString(),
    leadingSectors: sectors.filter((s) => ["OVERWEIGHT", "ACCUMULATE"].includes(s.rotationBias)).slice(0, 5),
    weakSectors: sectors.filter((s) => s.rotationBias === "AVOID").slice(0, 5),
    allSectors: sectors.slice(0, 12),
  };
}

function calculatePortfolioHeatEngine(signal, openBotPositions = []) {
  const symbol = normalizeSymbol(signal.symbol);
  const estimatedSector = signal.estimatedSector || "General Market";

  const openPositions = Array.isArray(openBotPositions) ? openBotPositions : [];

  const openSymbols = openPositions
    .map((position) => normalizeSymbol(position.symbol))
    .filter(Boolean);

  const duplicateSymbolRisk = openSymbols.includes(symbol);

  const sameSectorPositions = openPositions.filter((position) => {
    const positionSymbol = normalizeSymbol(position.symbol);

    const estimatedPositionSector = estimateSectorIntelligence({
      symbol: positionSymbol,
      current: Number(position.current_price || position.avg_entry_price || 0),
      price: Number(position.current_price || position.avg_entry_price || 0),
      volume: 0,
      percentChange: 0,
      confirmations: {},
    }).estimatedSector;

    return estimatedPositionSector === estimatedSector;
  });

  const openPositionCount = openPositions.length;
  const sameSectorCount = sameSectorPositions.length;

  const concentrationRiskScore = clampScore(
    100 -
    openPositionCount * 12 -
    sameSectorCount * 18 -
    (duplicateSymbolRisk ? 40 : 0)
  );

  const correlationRiskScore = clampScore(
    100 -
    sameSectorCount * 22 -
    (estimatedSector === "Speculative Small Cap" ? 20 : 0) -
    (duplicateSymbolRisk ? 35 : 0)
  );

  const portfolioHeatScore = clampScore(
    concentrationRiskScore * 0.55 + correlationRiskScore * 0.45
  );

  const portfolioHeatLabel =
    portfolioHeatScore >= 80
      ? "Low Portfolio Heat"
      : portfolioHeatScore >= 65
        ? "Moderate Portfolio Heat"
        : portfolioHeatScore >= 50
          ? "Elevated Portfolio Heat"
          : "High Portfolio Heat";

  const correlationAction =
    duplicateSymbolRisk
      ? "Block Duplicate Symbol"
      : portfolioHeatScore >= 65
        ? "Allow Allocation"
        : portfolioHeatScore >= 50
          ? "Reduce Allocation"
          : "Avoid Additional Exposure";

  return {
    portfolioHeatScore,
    portfolioHeatLabel,
    correlationRiskScore,
    concentrationRiskScore,
    sameSectorOpenPositions: sameSectorCount,
    totalOpenBotPositions: openPositionCount,
    duplicateSymbolRisk,
    correlationAction,
  };
}

function calculateSmartCapitalRedistributionEngine(
  account,
  openBotPositions = [],
  topSignals = [],
  sectorRotationState = null
) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);
  const maxBotBudget = equity * (CONFIG.maxBotExposurePercent / 100);
  const currentBotExposure = getBotExposure(openBotPositions);
  const remainingBotBudget = Math.max(0, maxBotBudget - currentBotExposure);

  const leadingSectors = sectorRotationState?.leadingSectors || [];
  const weakSectors = sectorRotationState?.weakSectors || [];

  const positionReviews = openBotPositions.map((position) => {
    const symbol = normalizeSymbol(position.symbol);
    const currentPrice = Number(position.current_price || 0);
    const entryPrice = Number(position.avg_entry_price || 0);
    const marketValue = Math.abs(Number(position.market_value || 0));
    const profitPercent = Number(position.unrealized_plpc || 0) * 100;

    const sectorInfo = estimateSectorIntelligence({
      symbol,
      current: currentPrice,
      price: currentPrice,
      volume: 0,
      percentChange: profitPercent,
      confirmations: {},
    });

    const sector = sectorInfo.estimatedSector || "General Market";

    const isLeadingSector = leadingSectors.some((item) => item.sector === sector);
    const isWeakSector = weakSectors.some((item) => item.sector === sector);

    const capitalEfficiencyScore = clampScore(
      50 +
        profitPercent * 3 +
        (isLeadingSector ? 15 : 0) -
        (isWeakSector ? 20 : 0) +
        (sectorInfo.sectorScore || 0) * 0.2
    );

    const redistributionAction =
      profitPercent <= -3 || capitalEfficiencyScore < 35
        ? "REDUCE_OR_EXIT"
        : profitPercent >= 5 && capitalEfficiencyScore >= 70
        ? "PROTECT_WINNER"
        : capitalEfficiencyScore >= 65
        ? "KEEP_ALLOCATED"
        : "MONITOR";

    return {
      symbol,
      entryPrice,
      currentPrice,
      marketValue,
      profitPercent: Number(profitPercent.toFixed(2)),
      sector,
      isLeadingSector,
      isWeakSector,
      capitalEfficiencyScore: Number(capitalEfficiencyScore.toFixed(2)),
      redistributionAction,
    };
  });

  const deployableSignals = topSignals
    .filter((signal) => signal.qualifiedToBuy !== false)
    .slice(0, CONFIG.topAutoTradeCandidates)
    .map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      price: signal.current || signal.price,
      sector: signal.estimatedSector || "General Market",
      suggestedAction:
        remainingBotBudget > 0 && Number(signal.score || 0) >= CONFIG.minScoreToBuy
          ? "ELIGIBLE_FOR_CAPITAL"
          : "WATCH_ONLY",
    }));

  const weakCapital = positionReviews
    .filter((item) => item.redistributionAction === "REDUCE_OR_EXIT")
    .reduce((sum, item) => sum + item.marketValue, 0);

  const protectedWinnerCapital = positionReviews
    .filter((item) => item.redistributionAction === "PROTECT_WINNER")
    .reduce((sum, item) => sum + item.marketValue, 0);

  const cashReserveTarget = equity * 0.15;
  const cashReserveStatus =
    cash >= cashReserveTarget ? "CASH_RESERVE_HEALTHY" : "LOW_CASH_RESERVE";

  return {
    updatedAt: new Date().toISOString(),
    equity,
    cash,
    maxBotBudget: Number(maxBotBudget.toFixed(2)),
    currentBotExposure: Number(currentBotExposure.toFixed(2)),
    remainingBotBudget: Number(remainingBotBudget.toFixed(2)),
    weakCapital: Number(weakCapital.toFixed(2)),
    protectedWinnerCapital: Number(protectedWinnerCapital.toFixed(2)),
    cashReserveTarget: Number(cashReserveTarget.toFixed(2)),
    cashReserveStatus,
    positionReviews,
    deployableSignals,
    redistributionSummary:
      `Weak capital: $${weakCapital.toFixed(2)} • ` +
      `Remaining bot budget: $${remainingBotBudget.toFixed(2)} • ` +
      `${cashReserveStatus}`,
  };
}

function calculateAiMarketCrashProtectionEngine(
  signals = [],
  marketRegime = {},
  account = {}
) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const totalSignals = analyzedSignals.length;

  const bearishSignals = analyzedSignals.filter(
    (signal) =>
      Number(signal.percentChange || 0) < -5 ||
      Number(signal.riskScore || 100) < 40
  ).length;

  const fakeBreakouts = analyzedSignals.filter(
    (signal) => signal.confirmations?.fakeBreakout
  ).length;

  const severeVolatilitySignals = analyzedSignals.filter(
    (signal) =>
      Math.abs(Number(signal.percentChange || 0)) >= 20
  ).length;

  const bearishRatio =
    totalSignals > 0 ? bearishSignals / totalSignals : 0;

  const fakeBreakoutRatio =
    totalSignals > 0 ? fakeBreakouts / totalSignals : 0;

  const severeVolatilityRatio =
    totalSignals > 0
      ? severeVolatilitySignals / totalSignals
      : 0;

  const crashRiskScore = clampScore(
    bearishRatio * 45 +
      fakeBreakoutRatio * 30 +
      severeVolatilityRatio * 25 +
      (marketRegime?.state === "panic/high volatility"
        ? 25
        : 0)
  );

  const crashProtectionMode =
    crashRiskScore >= 80
      ? "FULL_DEFENSE"
      : crashRiskScore >= 60
      ? "HIGH_RISK"
      : crashRiskScore >= 40
      ? "CAUTION"
      : "NORMAL";

  const exposureReductionMultiplier =
    crashProtectionMode === "FULL_DEFENSE"
      ? 0
      : crashProtectionMode === "HIGH_RISK"
      ? 0.25
      : crashProtectionMode === "CAUTION"
      ? 0.5
      : 1;

  const shouldBlockNewTrades =
    crashProtectionMode === "FULL_DEFENSE";

  return {
    updatedAt: new Date().toISOString(),
    totalSignals,
    bearishSignals,
    fakeBreakouts,
    severeVolatilitySignals,
    bearishRatio: Number(bearishRatio.toFixed(2)),
    fakeBreakoutRatio: Number(fakeBreakoutRatio.toFixed(2)),
    severeVolatilityRatio: Number(
      severeVolatilityRatio.toFixed(2)
    ),
    crashRiskScore,
    crashProtectionMode,
    exposureReductionMultiplier,
    shouldBlockNewTrades,
    accountEquity: Number(account?.equity || 0),
    accountCash: Number(account?.cash || 0),
  };
}

function calculateMultiTimeframeConfirmationEngine(signals = []) {
  const analyzedSignals = (signals || []).map((signal) => {
    const score = Number(signal.score || 0);
    const percentChange = Number(signal.percentChange || 0);
    const volumeRatio = Number(
      signal.confirmations?.volumeSpikeRatio ||
      signal.volumeRatio ||
      0
    );

    const microTrend =
      score >= 85 && percentChange > 1
        ? "BULLISH"
        : percentChange < -2
        ? "BEARISH"
        : "NEUTRAL";

    const intradayTrend =
      volumeRatio >= 1.5 && score >= 70
        ? "BULLISH"
        : score < 50
        ? "BEARISH"
        : "NEUTRAL";

    const higherTimeframeTrend =
      score >= 90
        ? "BULLISH"
        : score <= 35
        ? "BEARISH"
        : "NEUTRAL";

    const alignedBullish =
      microTrend === "BULLISH" &&
      intradayTrend === "BULLISH" &&
      higherTimeframeTrend === "BULLISH";

    const alignedBearish =
      microTrend === "BEARISH" &&
      intradayTrend === "BEARISH";

    const timeframeConflict =
      new Set([
        microTrend,
        intradayTrend,
        higherTimeframeTrend,
      ]).size >= 3;

    const timeframeConfidenceScore = clampScore(
      40 +
        (alignedBullish ? 40 : 0) -
        (alignedBearish ? 25 : 0) -
        (timeframeConflict ? 20 : 0) +
        score * 0.15
    );

    const timeframeDecision =
      timeframeConfidenceScore >= 80
        ? "FULL_ALIGNMENT"
        : timeframeConfidenceScore >= 65
        ? "PARTIAL_ALIGNMENT"
        : timeframeConflict
        ? "TIMEFRAME_CONFLICT"
        : "WEAK_CONFIRMATION";

    return {
      symbol: signal.symbol,
      score,
      microTrend,
      intradayTrend,
      higherTimeframeTrend,
      alignedBullish,
      alignedBearish,
      timeframeConflict,
      timeframeConfidenceScore:
        Number(timeframeConfidenceScore.toFixed(2)),
      timeframeDecision,
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    alignedSignals: analyzedSignals.filter(
      (s) => s.alignedBullish
    ).length,

    conflictedSignals: analyzedSignals.filter(
      (s) => s.timeframeConflict
    ).length,

    topAlignedSignals: analyzedSignals
      .sort(
        (a, b) =>
          b.timeframeConfidenceScore -
          a.timeframeConfidenceScore
      )
      .slice(0, 10),
  };
}

function calculateAiPortfolioManagerDecision(signal, account, openBotPositions = [], regime = {}) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);
  const buyingPower = Number(account?.buying_power || 0);

  const institutionalScore = Number(signal.institutionalScore || signal.score || 0);
  const riskScore = Number(signal.riskScore || 0);
  const statisticalScore = Number(signal.statisticalScore || 0);
  const fundamentalScore = Number(signal.fundamentalScore || 0);
  const earningsScore = Number(signal.earningsScore || 0);
  const moatScore = Number(signal.moatScore || 0);
  const wealthBuilderScore = Number(signal.wealthBuilderScore || signal.dividendScore || 0);
  const portfolioScore = Number(signal.portfolioScore || 0);
  const institutionalRiskScore = Number(signal.institutionalRiskScore || riskScore || 0);
  const portfolioHeat = calculatePortfolioHeatEngine(signal, openBotPositions);
  const currentBotExposure = getBotExposure(openBotPositions);
  const maxBotBudget = equity * (CONFIG.maxBotExposurePercent / 100);
  const remainingBotBudget = Math.max(0, maxBotBudget - currentBotExposure);
  const basePerTradeMax = maxBotBudget / Math.max(1, CONFIG.maxOpenTrades);

  const opportunityQualityScore = clampScore(
    institutionalScore * 0.3 +
    statisticalScore * 0.18 +
    riskScore * 0.18 +
    fundamentalScore * 0.1 +
    earningsScore * 0.08 +
    moatScore * 0.08 +
    wealthBuilderScore * 0.08
  );

  const portfolioFitScore = clampScore(
    portfolioScore * 0.35 +
    institutionalRiskScore * 0.25 +
    wealthBuilderScore * 0.15 +
    portfolioHeat.portfolioHeatScore * 0.25
  );

  const aiConvictionScore = clampScore(
    opportunityQualityScore * 0.55 + portfolioFitScore * 0.45
  );

  const regimeMultiplier =
    Number(regime.exposureMultiplier || 0) > 0
      ? Number(regime.exposureMultiplier || 1)
      : 0;

  const convictionMultiplier =
    aiConvictionScore >= 90
      ? 1
      : aiConvictionScore >= 80
        ? 0.8
        : aiConvictionScore >= 70
          ? 0.6
          : aiConvictionScore >= 60
            ? 0.4
            : 0.25;

  const riskMultiplier =
    institutionalRiskScore >= 80
      ? 1
      : institutionalRiskScore >= 65
        ? 0.75
        : institutionalRiskScore >= 50
          ? 0.45
          : 0.2;

  const heatMultiplier =
    portfolioHeat.correlationAction === "Allow Allocation"
      ? 1
      : portfolioHeat.correlationAction === "Reduce Allocation"
        ? 0.5
        : 0;
  const roleMultiplier =
    signal.portfolioRole === "Core Position Candidate"
      ? 1
      : signal.portfolioRole === "Strong Portfolio Fit"
        ? 0.85
        : signal.portfolioRole === "Satellite Position"
          ? 0.65
          : signal.portfolioRole === "Small Tactical Position"
            ? 0.45
            : 0.25;

  const aiAllocationPercentOfBotBudget = Number(
    (
      CONFIG.maxBotExposurePercent *
      convictionMultiplier *
      riskMultiplier *
      roleMultiplier *
      heatMultiplier *
      regimeMultiplier
    ).toFixed(2)
  );

  const recommendedTradeAmount = Math.max(
    0,
    Math.min(
      basePerTradeMax *
      convictionMultiplier *
      riskMultiplier *
      roleMultiplier *
      heatMultiplier *
      regimeMultiplier,
      remainingBotBudget,
      cash,
      buyingPower || cash
    )
  );

  const aiPortfolioAction =
    portfolioHeat.correlationAction === "Block Duplicate Symbol"
      ? "Blocked Duplicate"
      : portfolioHeat.correlationAction === "Avoid Additional Exposure"
        ? "Portfolio Heat Too High"
        : recommendedTradeAmount <= 0
          ? "No Capital Available"
          : aiConvictionScore >= 80 && institutionalRiskScore >= 65
            ? "Deploy Capital"
            : aiConvictionScore >= 65
              ? "Small Tactical Allocation"
              : "Watch Only";

  return {
    aiConvictionScore,
    opportunityQualityScore,
    portfolioFitScore,
    aiAllocationPercentOfBotBudget,
    recommendedTradeAmount: Number(recommendedTradeAmount.toFixed(2)),
    portfolioHeatScore: portfolioHeat.portfolioHeatScore,
    portfolioHeatLabel: portfolioHeat.portfolioHeatLabel,
    correlationRiskScore: portfolioHeat.correlationRiskScore,
    concentrationRiskScore: portfolioHeat.concentrationRiskScore,
    sameSectorOpenPositions: portfolioHeat.sameSectorOpenPositions,
    totalOpenBotPositions: portfolioHeat.totalOpenBotPositions,
    duplicateSymbolRisk: portfolioHeat.duplicateSymbolRisk,
    correlationAction: portfolioHeat.correlationAction,
    aiPortfolioAction,
    portfolioManagerReason:
      `${aiPortfolioAction} • Conviction ${aiConvictionScore}/100 • ` +
      `Risk ${institutionalRiskScore}/100 • Fit ${portfolioFitScore}/100`,
  };
}

function getDynamicTradeAmount(account, openBotPositions = [], signalScore = 80) {
  const cash = Number(account?.cash || 0);
  const equity = Number(account?.equity || 0);
  const buyingPower = Number(account?.buying_power || 0);

  if (!cash || cash <= 0 || !equity || equity <= 0) return 0;

  const maxBotBudget = equity * (CONFIG.maxBotExposurePercent / 100);
  const currentBotExposure = getBotExposure(openBotPositions);
  const remainingBotBudget = maxBotBudget - currentBotExposure;

  if (remainingBotBudget <= 0) return 0;

  const perTradeMax = maxBotBudget / CONFIG.maxOpenTrades;
  const scoreMultiplier =
    signalScore >= 95
      ? 1
      : signalScore >= 90
        ? 0.8
        : signalScore >= 85
          ? 0.6
          : 0.4;

  const scoreAdjustedTradeMax = perTradeMax * scoreMultiplier;

  return Math.max(
    1,
    Math.min(scoreAdjustedTradeMax, remainingBotBudget, cash, buyingPower || cash)
  );
}

function alpacaHeaders() {
  const { key, secret } = getAlpacaKeys();

  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}
function markApiHealth(name, ok, error = "") {
  engineState.apiHealth[name] = {
    ok,
    error,
    checkedAt: new Date().toISOString(),
  };
}
async function alpacaTradingRequest(path, options = {}) {
  const baseUrl = getTradingBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...alpacaHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
  engineState.apiFailureCounts.alpacaTrading =
    (engineState.apiFailureCounts.alpacaTrading || 0) + 1;
engineState.apiCooldowns.alpacaTrading =
  Date.now() + 1000 * 60 * 2;
  markApiHealth(
    "alpacaTrading",
    false,
    data?.message ||
      data?.error ||
      `HTTP ${res.status}`
  );

  throw new Error(
    data?.message ||
      data?.error ||
      `Alpaca trading error ${res.status}: ${JSON.stringify(data)}`
  );
}
markApiHealth("alpacaTrading", true);
  return data;

}
async function alpacaDataRequest(path, options = {}) {
  const res = await fetch(`${ALPACA_DATA_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...alpacaHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Alpaca data error ${res.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

function isNormalStockSymbol(symbol) {
  const s = normalizeSymbol(symbol);

  if (!s) return false;
  if (s.includes(".") || s.includes("-") || s.includes("/") || s.includes("^"))
    return false;
  if (s.length > 5) return false;
  const badEndings = ["W", "WS", "WT", "R", "RT", "U", "UN", "P", "PR", "Z"];

  for (const ending of badEndings) {
    if (s.endsWith(ending) && s.length >= 4) return false;
  }

  return /^[A-Z]{1,5}$/.test(s);
}

async function getAsset(symbol) {
  return alpacaTradingRequest(`/v2/assets/${encodeURIComponent(symbol)}`);
}

async function isAssetBuyEligible(symbol) {
  try {
    const asset = await getAsset(symbol);

    if (asset.status !== "active") {
      return { ok: false, reason: "Asset is not active" };
    }

    if (asset.tradable !== true) {
      return { ok: false, reason: "Asset is not tradable on Alpaca" };
    }

    // if (asset.fractionable !== true) {
    //  return { ok: false, reason: "Asset is not fractionable" };
    //}

    return { ok: true, asset };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
async function isAssetSellEligible(symbol) {
  try {
    const asset = await getAsset(symbol);

    if (asset.status !== "active") {
      return { ok: false, reason: "Asset is not active" };
    }

    if (asset.tradable !== true) {
      return { ok: false, reason: "Asset is not tradable on Alpaca" };
    }

    return { ok: true, asset };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function finnhubQuote(symbol) {
  if (
  engineState.apiCooldowns.finnhubQuote &&
  Date.now() <
    engineState.apiCooldowns.finnhubQuote
) {
  throw new Error(
    "Finnhub quote API cooling down"
  );
}
if (
  engineState.apiCooldowns.finnhubQuote &&
  Date.now() <
    engineState.apiCooldowns.finnhubQuote
) {
  throw new Error(
    "Finnhub quote API cooling down"
  );
}
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    symbol
  )}&token=${FINNHUB_API_KEY}`;

  const res = await fetch(url);

  markApiHealth("finnhubQuote", true);

  const data = await res.json();

  if (!res.ok || !data || typeof data.c !== "number") {
    engineState.apiFailureCounts.finnhubQuote =
      (engineState.apiFailureCounts.finnhubQuote || 0) + 1;
engineState.apiCooldowns.finnhubNews =
  Date.now() + 1000 * 60;
    markApiHealth(
      "finnhubQuote",
      false,
      `Quote failed for ${symbol}`
    );
engineState.apiFailureCounts.finnhubQuote =
  (engineState.apiFailureCounts.finnhubQuote || 0) + 1;

markApiHealth("finnhubQuote", false, `Quote failed for ${symbol}`);
    throw new Error(`Finnhub quote failed for ${symbol}`);
  }

  return {
    symbol,
    current: Number(data.c || 0),
    change: Number(data.d || 0),
    percentChange: Number(data.dp || 0),
    high: Number(data.h || 0),
    low: Number(data.l || 0),
    open: Number(data.o || 0),
    previousClose: Number(data.pc || 0),
    volume: Number(data.v || data.volume || 0),
  };
}
async function getCombinedStockQuote(symbol) {
  let finnhub = null;
  let finnhubError = "";

  try {
    finnhub = await finnhubQuote(symbol);
  } catch (err) {
    finnhubError = err.message;
  }

  const bars = await getRecentBars(symbol, "5Min", 30);
  const barStats = calculateBarStats(bars);

  const latestBar = bars[bars.length - 1] || {};
  const firstBar = bars[0] || {};

  const alpacaCurrent = Number(latestBar.c || 0);
  const alpacaOpen = Number(firstBar.o || latestBar.o || 0);
  const alpacaHigh = Math.max(...bars.map((b) => Number(b.h || 0)), 0);
  const alpacaLow = Math.min(
    ...bars.map((b) => Number(b.l || Infinity))
  );

  const safeAlpacaLow = Number.isFinite(alpacaLow) ? alpacaLow : 0;

  const current = Number(finnhub?.current || alpacaCurrent || 0);
  const open = Number(finnhub?.open || alpacaOpen || 0);
  const previousClose = Number(finnhub?.previousClose || alpacaOpen || 0);

  const percentChange =
    Number(finnhub?.percentChange || 0) ||
    (previousClose > 0 ? ((current - previousClose) / previousClose) * 100 : 0);

  const volume = Math.max(
    Number(finnhub?.volume || 0),
    Number(barStats.lastVolume || 0),
    Number(barStats.avgVolume || 0)
  );

  if (!current || current <= 0) {
    throw new Error(finnhubError || `No valid price from Finnhub or Alpaca for ${symbol}`);
  }

  return {
    symbol,
    current,
    price: current,
    change: Number(finnhub?.change || 0),
    percentChange,
    high: Number(finnhub?.high || alpacaHigh || current),
    low: Number(finnhub?.low || safeAlpacaLow || current),
    open,
    previousClose,
    volume,
    barVolume: Number(barStats.lastVolume || 0),
    avgBarVolume: Math.round(Number(barStats.avgVolume || 0)),
    volumeRatio: Number(barStats.volumeSpikeRatio || 0),
    dataSource: finnhub ? "Finnhub + Alpaca" : "Alpaca fallback",
  };
}
async function getRecentBars(symbol, timeframe = "5Min", limit = 30) {
  const data = await alpacaDataRequest(
    `/v2/stocks/${encodeURIComponent(
      symbol
    )}/bars?timeframe=${encodeURIComponent(
      timeframe
    )}&limit=${limit}&adjustment=raw`
  );

  return Array.isArray(data.bars) ? data.bars : [];
}

function calculateBarStats(bars = []) {
  if (!bars.length) {
    return {
      avgVolume: 0,
      lastVolume: 0,
      volumeSpikeRatio: 0,
      vwap: 0,
      latestClose: 0,
      latestHigh: 0,
      latestLow: 0,
      highOfBars: 0,
    };
  }

  const totalVolume = bars.reduce((sum, b) => sum + Number(b.v || 0), 0);
  const avgVolume = totalVolume / bars.length;

  let vwapNumerator = 0;
  let vwapVolume = 0;

  for (const b of bars) {
    const high = Number(b.h || 0);
    const low = Number(b.l || 0);
    const close = Number(b.c || 0);
    const volume = Number(b.v || 0);
    const typicalPrice = (high + low + close) / 3;

    vwapNumerator += typicalPrice * volume;
    vwapVolume += volume;
  }

  const latest = bars[bars.length - 1];

  return {
    avgVolume,
    lastVolume: Number(latest.v || 0),
    volumeSpikeRatio: avgVolume > 0 ? Number(latest.v || 0) / avgVolume : 0,
    vwap: vwapVolume > 0 ? vwapNumerator / vwapVolume : 0,
    latestClose: Number(latest.c || 0),
    latestHigh: Number(latest.h || 0),
    latestLow: Number(latest.l || 0),
    highOfBars: Math.max(...bars.map((b) => Number(b.h || 0))),
  };
}

async function getNewsRisk(symbol) {
  if (!CONFIG.enableNewsRiskFilter) {
    return {
      risk: false,
      reason: "News risk filter disabled",
      headlines: [],
    }
  }

  const today = new Date();
  const from = new Date();

  from.setDate(today.getDate() - CONFIG.newsLookbackDays);

  const toDate = today.toISOString().slice(0, 10);
  const fromDate = from.toISOString().slice(0, 10);
  if (
  engineState.apiCooldowns.finnhubNews &&
  Date.now() <
    engineState.apiCooldowns.finnhubNews
) {
  return {
    risk: false,
    reason: "News API cooling down",
    headlines: [],
  };
}

if (
  engineState.apiCooldowns.finnhubNews &&
  Date.now() <
    engineState.apiCooldowns.finnhubNews
) {
  return {
    risk: false,
    reason: "News API cooling down",
    headlines: [],
  };
}
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(
    symbol
  )}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;

  try {
    const res = await fetch(url);

    markApiHealth("finnhubNews", true);

    const data = await res.json();

    if (!res.ok || !Array.isArray(data)) {
      engineState.apiFailureCounts.finnhubNews =
        (engineState.apiFailureCounts.finnhubNews || 0) + 1;
engineState.apiCooldowns.finnhubNews =
  Date.now() + 1000 * 60;
      markApiHealth(
        "finnhubNews",
        false,
        `News failed for ${symbol}`
      );

      return {
        risk: false,
        reason: "News check failed, allowed",
        headlines: [],
      };
    }

    const riskyWords = [
      "offering",
      "dilution",
      "bankruptcy",
      "investigation",
      "sec",
      "lawsuit",
      "fraud",
      "delisting",
      "downgrade",
      "short report",
      "halt",
      "halted",
      "reverse split",
    ];

    const riskyNews = data.filter((item) => {
      const text = `${item.headline || ""} ${
        item.summary || ""
      }`.toLowerCase();

      return riskyWords.some((word) =>
        text.includes(word)
      );
    });

    return {
      risk: riskyNews.length > 0,
      reason:
        riskyNews.length > 0
          ? "Risky news detected"
          : "No major risky news detected",
      headlines: riskyNews
        .slice(0, 3)
        .map((item) => item.headline),
    };
  } catch {
    engineState.apiFailureCounts.finnhubNews =
      (engineState.apiFailureCounts.finnhubNews || 0) + 1;

    markApiHealth(
      "finnhubNews",
      false,
      `News exception for ${symbol}`
    );

    return {
      risk: false,
      reason: "News check error, allowed",
      headlines: [],
    };
  }
}
async function getAdvancedConfirmations(q) {
  const bars = await getRecentBars(q.symbol, "5Min", 30);
  const stats = calculateBarStats(bars);

  const closeNearHighPercent =
    q.high > q.low ? ((q.current - q.low) / (q.high - q.low)) * 100 : 0;

  const gapUpPercent =
    q.previousClose > 0
      ? ((q.open - q.previousClose) / q.previousClose) * 100
      : 0;

  const pullbackFromHighPercent =
    q.high > 0 ? ((q.high - q.current) / q.high) * 100 : 0;

  const volumeSpike =
    stats.volumeSpikeRatio >= CONFIG.minVolumeSpikeRatio ||
    q.volume >= CONFIG.minVolume;

  const aboveVwap = stats.vwap > 0 ? q.current >= stats.vwap : true;

  const closeNearHigh =
    closeNearHighPercent >= CONFIG.minCloseNearHighPercent;


  const fakeBreakout =
    q.percentChange > 5 &&
    pullbackFromHighPercent >
    (engineState.marketOpen
      ? CONFIG.fakeBreakoutMaxHighPullbackPercent * 1.5
      : CONFIG.fakeBreakoutMaxHighPullbackPercent);

  const gapTooHigh = gapUpPercent > CONFIG.maxGapUpPercent;

  const newsRisk = await getNewsRisk(q.symbol);

  return {
    barsFound: bars.length,
    avgVolume: Math.round(stats.avgVolume),
    lastVolume: Math.round(stats.lastVolume),
    volumeSpikeRatio: Number(stats.volumeSpikeRatio.toFixed(2)),
    vwap: Number(stats.vwap.toFixed(4)),
    closeNearHighPercent: Number(closeNearHighPercent.toFixed(2)),
    gapUpPercent: Number(gapUpPercent.toFixed(2)),
    pullbackFromHighPercent: Number(pullbackFromHighPercent.toFixed(2)),

    volumeSpike,
    aboveVwap,
    closeNearHigh,
    fakeBreakout,
    gapTooHigh,

    newsRisk: newsRisk.risk,
    newsRiskReason: newsRisk.reason,
    riskyNewsHeadlines: newsRisk.headlines,
  };
}
function scoreStock(q) {
  let score = 0;

  // 🔥 LARGE CAP / INSTITUTIONAL BIAS
  if (q.current >= 5) score += 5;
  if (q.volume >= 1000000) score += 10;

  if (
    q.current >= CONFIG.minStockPrice &&
    (CONFIG.maxStockPrice <= 0 || q.current <= CONFIG.maxStockPrice)
  ) {
    score += 18;
  }

  if (q.percentChange > 0) score += 12;
  if (q.percentChange >= 1) score += 10;
  if (q.percentChange >= 2 && q.percentChange <= 20) score += 20;

  if (q.percentChange > 20 && q.percentChange <= CONFIG.maxPercentChange) {
    score += 10;
  }

  if (q.open > 0 && q.current > q.open) score += 15;
  if (q.previousClose > 0 && q.current > q.previousClose) score += 15;

  if (q.high > q.low && q.current > 0) {
    const closeNearHigh = ((q.current - q.low) / (q.high - q.low)) * 100;

    if (closeNearHigh >= 85) score += 10;
    else if (closeNearHigh >= 70) score += 6;
  }

  if (q.volume >= CONFIG.minVolume) score += 10;

  // 📈 RSI / EMA / MACD TECHNICAL SCORING
  if (q.technicals) {
    const rsi = Number(q.technicals.rsi || 0);
    const ema9 = Number(q.technicals.ema9 || 0);
    const ema20 = Number(q.technicals.ema20 || 0);
    const macd = Number(q.technicals.macd || 0);
    const macdSignal = Number(q.technicals.macdSignal || 0);

    if (rsi >= 45 && rsi <= 70) score += 12;
    else if (rsi > 70 && rsi <= 80) score += 5;
    else if (rsi > 80) score -= 10;
    else if (rsi < 35) score -= 10;

    if (ema9 > ema20) score += 12;
    if (q.current > ema9 && ema9 > ema20) score += 10;

    if (macd > macdSignal) score += 12;
    if (macd > 0 && macdSignal > 0) score += 6;
  }

  if (q.confirmations) {
    if (q.confirmations.volumeSpike) score += 12;
    if (q.confirmations.aboveVwap) score += 10;
    if (q.confirmations.closeNearHigh) score += 10;
    if (!q.confirmations.fakeBreakout) score += 8;
    if (!q.confirmations.gapTooHigh) score += 6;

    if (q.confirmations.fakeBreakout) score -= 25;
    if (q.confirmations.gapTooHigh) score -= 20;
    if (q.confirmations.newsRisk) score -= 30;
  }

  return Math.min(100, Math.max(0, Math.round(score)));

}
function clampScore(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value || 0))));
}

function getRiskLevel(score) {
  if (score >= 80) return "Low";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Elevated";
  return "High";
}

function getTradeQuality(score) {
  if (score >= 90) return "Institutional Grade";
  if (score >= 80) return "High Quality";
  if (score >= 70) return "Qualified Setup";
  if (score >= 55) return "Watchlist";
  return "Weak";
}

function getSuggestedHoldTime(score) {
  if (score >= 90) return "5–15 days";
  if (score >= 80) return "3–10 days";
  if (score >= 70) return "2–7 days";
  return "Watch only";
}

function calculateEarningsIntelligenceEngine(q) {
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const rsi = Number(technicals.rsi || 50);

  const revenueQualityScore = clampScore(
    50 +
    (percentChange > 0 && percentChange <= 12 ? 15 : 0) +
    (volume >= 25000 ? 10 : -10)
  );

  const guidanceScore = clampScore(
    50 +
    (percentChange > 2 && percentChange <= 15 ? 15 : 0) -
    (percentChange > 25 ? 20 : 0)
  );

  const marginExpansionScore = clampScore(
    50 +
    (percentChange > 0 && percentChange <= 10 ? 10 : 0) -
    (rsi > 80 ? 10 : 0)
  );

  const epsSurpriseQualityScore = clampScore(
    50 +
    (volumeRatio >= 1.3 ? 15 : 0) +
    (percentChange > 0 ? 10 : -10) -
    (confirmations.fakeBreakout ? 25 : 0)
  );

  const institutionalEarningsSentiment = clampScore(
    50 +
    (volumeRatio >= 1.5 ? 15 : 0) +
    (confirmations.closeNearHigh ? 10 : 0) +
    (confirmations.aboveVwap ? 10 : 0) -
    (confirmations.newsRisk ? 25 : 0)
  );

  const earningsCashFlowStrength = clampScore(
    50 +
    (volume >= 100000 ? 15 : volume >= 25000 ? 8 : -10) -
    (percentChange > 30 ? 15 : 0)
  );

  const earningsScore = clampScore(
    revenueQualityScore * 0.18 +
    guidanceScore * 0.18 +
    marginExpansionScore * 0.16 +
    epsSurpriseQualityScore * 0.16 +
    institutionalEarningsSentiment * 0.17 +
    earningsCashFlowStrength * 0.15
  );

  return {
    earningsScore,
    revenueQualityScore,
    guidanceScore,
    marginExpansionScore,
    epsSurpriseQualityScore,
    institutionalEarningsSentiment,
    earningsCashFlowStrength,
  };
}

function calculateFundamentalDcfEngine(q) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};

  // Starter DCF proxy.
  // Later we can replace these assumptions with real revenue, FCF, debt, and growth data.
  const estimatedGrowthRate =
    percentChange > 0 && percentChange <= 10 ? 0.08 : percentChange > 20 ? 0.02 : 0.05;

  const discountRate = confirmations.fakeBreakout ? 0.14 : 0.10;
  const terminalGrowthRate = 0.025;

  const estimatedBaseCashFlow = Math.max(0.1, price * 0.08);

  let projectedCashFlowValue = 0;

  for (let year = 1; year <= 5; year += 1) {
    const projectedCashFlow =
      estimatedBaseCashFlow * Math.pow(1 + estimatedGrowthRate, year);

    projectedCashFlowValue += projectedCashFlow / Math.pow(1 + discountRate, year);
  }

  const yearFiveCashFlow =
    estimatedBaseCashFlow * Math.pow(1 + estimatedGrowthRate, 5);

  const terminalValue =
    (yearFiveCashFlow * (1 + terminalGrowthRate)) /
    Math.max(0.01, discountRate - terminalGrowthRate);

  const discountedTerminalValue = terminalValue / Math.pow(1 + discountRate, 5);

  const intrinsicValue = Number(
    (projectedCashFlowValue + discountedTerminalValue).toFixed(2)
  );

  const valuationGapPercent =
    price > 0 ? Number((((intrinsicValue - price) / price) * 100).toFixed(2)) : 0;

  const valuationLabel =
    valuationGapPercent >= 20
      ? "Undervalued"
      : valuationGapPercent <= -20
        ? "Overvalued"
        : "Fairly Valued";

  const valuationScore = clampScore(
    55 +
    (valuationGapPercent >= 20 ? 20 : 0) -
    (valuationGapPercent <= -20 ? 20 : 0)
  );

  const balanceSheetHealthScore = clampScore(
    50 +
    (price >= 5 ? 10 : -10) +
    (volume >= 25000 ? 10 : -10)
  );

  const cashFlowScore = clampScore(
    50 +
    (estimatedGrowthRate >= 0.08 ? 15 : 0) +
    (discountRate <= 0.1 ? 10 : -10)
  );

  const revenueGrowthScore = clampScore(
    50 + estimatedGrowthRate * 300 - (percentChange > 25 ? 15 : 0)
  );

  const marginScore = clampScore(
    55 +
    (percentChange > 0 && percentChange <= 15 ? 10 : 0) -
    (percentChange > 25 ? 15 : 0)
  );

  const debtRiskScore = clampScore(
    70 -
    (price < 2 ? 20 : 0) -
    (volume < 25000 ? 10 : 0)
  );

  const fundamentalScore = clampScore(
    valuationScore * 0.25 +
    balanceSheetHealthScore * 0.2 +
    cashFlowScore * 0.2 +
    revenueGrowthScore * 0.15 +
    marginScore * 0.1 +
    debtRiskScore * 0.1
  );

  return {
    intrinsicValue,
    valuationGapPercent,
    valuationLabel,
    valuationScore,
    balanceSheetHealthScore,
    cashFlowScore,
    revenueGrowthScore,
    marginScore,
    debtRiskScore,
    fundamentalScore,
  };
}
function calculateStatisticalEdge(q) {
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const percentChange = Number(q.percentChange || 0);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const closeNearHighPercent = Number(confirmations.closeNearHighPercent || 0);
  const pullbackFromHighPercent = Number(
    confirmations.pullbackFromHighPercent || 0
  );

  const rsi = Number(technicals.rsi || 50);
  const ema9 = Number(technicals.ema9 || 0);
  const ema20 = Number(technicals.ema20 || 0);
  const macd = Number(technicals.macd || 0);
  const macdSignal = Number(technicals.macdSignal || 0);

  const relativeStrengthPercentile = clampScore(
    50 +
    percentChange * 2 +
    (volumeRatio >= 1.5 ? 10 : 0) +
    (closeNearHighPercent >= 70 ? 10 : 0)
  );

  const breakoutProbability = clampScore(
    35 +
    (percentChange > 0 ? 10 : -10) +
    (percentChange >= 2 ? 15 : 0) +
    (volumeRatio >= 1.5 ? 15 : 0) +
    (closeNearHighPercent >= 70 ? 15 : 0) -
    (pullbackFromHighPercent > 4 ? 20 : 0) -
    (confirmations.fakeBreakout ? 35 : 0)
  );

  const continuationProbability = clampScore(
    40 +
    (ema9 > ema20 ? 15 : 0) +
    (macd > macdSignal ? 15 : 0) +
    (rsi >= 45 && rsi <= 70 ? 15 : 0) +
    (percentChange >= 1 && percentChange <= 12 ? 10 : 0) -
    (rsi > 80 ? 20 : 0)
  );

  const volumeConfirmationQuality = clampScore(
    40 +
    volumeRatio * 20 +
    (Number(q.volume || 0) >= CONFIG.minVolume ? 15 : 0)
  );

  const momentumPersistence = clampScore(
    45 +
    (percentChange > 0 ? 10 : -10) +
    (ema9 > ema20 ? 15 : 0) +
    (macd > macdSignal ? 10 : 0) +
    (confirmations.aboveVwap ? 10 : 0)
  );

  const volatilityQuality = clampScore(
    75 -
    (percentChange > 20 ? 20 : 0) -
    (pullbackFromHighPercent > 5 ? 20 : 0) -
    (confirmations.gapTooHigh ? 15 : 0)
  );

  const statisticalEdgeScore = clampScore(
    breakoutProbability * 0.25 +
    continuationProbability * 0.25 +
    relativeStrengthPercentile * 0.15 +
    volumeConfirmationQuality * 0.15 +
    momentumPersistence * 0.1 +
    volatilityQuality * 0.1
  );

  return {
    breakoutProbability,
    continuationProbability,
    relativeStrengthPercentile,
    volumeConfirmationQuality,
    momentumPersistence,
    volatilityQuality,
    statisticalEdgeScore,
  };
}
function detectMarketRegime(stockSignals = []) {
  if (!CONFIG.enableMarketRegimeEngine) {
    return {
      state: "cautious bullish",
      label: "Cautious Bullish",
      exposureMultiplier: 0.75,
      riskMessage: "Market regime engine disabled. Using cautious default.",
    };
  }

  const signals = Array.isArray(stockSignals) ? stockSignals : [];

  if (!signals.length) {
    return {
      state: "defensive",
      label: "Defensive",
      exposureMultiplier: CONFIG.defensiveExposureMultiplier,
      riskMessage: "No strong market signal. Reducing exposure.",
    };
  }

  const avgScore =
    signals.reduce((sum, s) => sum + Number(s.institutionalScore || s.score || 0), 0) /
    signals.length;

  const positiveCount = signals.filter((s) => Number(s.percentChange || 0) > 0).length;
  const positiveRatio = positiveCount / signals.length;

  const fakeBreakoutCount = signals.filter(
    (s) => s.confirmations?.fakeBreakout === true
  ).length;

  const riskCount = signals.filter(
    (s) =>
      s.confirmations?.newsRisk === true ||
      Number(s.riskScore || 100) < 50
  ).length;

  const riskRatio = riskCount / signals.length;
  const fakeBreakoutRatio = fakeBreakoutCount / signals.length;

  if (riskRatio >= 0.35 || fakeBreakoutRatio >= 0.25) {
    return {
      state: "panic/high volatility",
      label: "Panic / High Volatility",
      exposureMultiplier: CONFIG.panicExposureMultiplier,
      riskMessage: "High risk detected. New auto-buys should be blocked or heavily reduced.",
    };
  }

  if (avgScore >= 80 && positiveRatio >= 0.65) {
    return {
      state: "aggressive bullish",
      label: "Aggressive Bullish",
      exposureMultiplier: CONFIG.aggressiveBullishExposureMultiplier,
      riskMessage: "Strong opportunity environment. Normal exposure allowed.",
    };
  }

  if (avgScore >= 65 && positiveRatio >= 0.5) {
    return {
      state: "cautious bullish",
      label: "Cautious Bullish",
      exposureMultiplier: CONFIG.cautiousBullishExposureMultiplier,
      riskMessage: "Good but not perfect conditions. Reduced exposure.",
    };
  }

  return {
    state: "defensive",
    label: "Defensive",
    exposureMultiplier: CONFIG.defensiveExposureMultiplier,
    riskMessage: "Weak or choppy conditions. Exposure reduced.",
  };
}
function calculateAdvancedRiskEngine(q) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const rsi = Number(technicals.rsi || 50);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);

  const drawdownRiskScore = clampScore(
    80 -
    (percentChange > 20 ? 25 : 0) -
    (percentChange > 40 ? 20 : 0) -
    (confirmations.fakeBreakout ? 30 : 0) -
    (confirmations.gapTooHigh ? 20 : 0)
  );

  const volatilityShockScore = clampScore(
    75 -
    (Math.abs(percentChange) > 15 ? 15 : 0) -
    (Math.abs(percentChange) > 30 ? 20 : 0) -
    (rsi > 80 ? 15 : 0) -
    (volumeRatio > 5 ? 10 : 0)
  );

  const liquidityStressScore = clampScore(
    40 +
    (volume >= 1000000 ? 35 : volume >= 250000 ? 25 : volume >= 25000 ? 15 : -15) +
    (price >= 5 ? 10 : -10)
  );

  const downsideExposureScore = clampScore(
    80 -
    (percentChange < -20 ? 20 : 0) -
    (percentChange > 30 ? 20 : 0) -
    (confirmations.newsRisk ? 30 : 0) -
    (!confirmations.aboveVwap ? 10 : 0)
  );

  const crashSurvivabilityScore = clampScore(
    50 +
    (liquidityStressScore >= 70 ? 15 : 0) +
    (drawdownRiskScore >= 70 ? 15 : 0) +
    (price >= 10 ? 10 : 0) -
    (confirmations.fakeBreakout ? 25 : 0)
  );

  const institutionalRiskScore = clampScore(
    drawdownRiskScore * 0.22 +
    volatilityShockScore * 0.2 +
    liquidityStressScore * 0.2 +
    downsideExposureScore * 0.2 +
    crashSurvivabilityScore * 0.18
  );

  const institutionalRiskLabel =
    institutionalRiskScore >= 80
      ? "Institutional Risk"
      : institutionalRiskScore >= 65
        ? "Controlled Risk"
        : institutionalRiskScore >= 50
          ? "Elevated Risk"
          : "High Stress Risk";

  return {
    institutionalRiskScore,
    drawdownRiskScore,
    volatilityShockScore,
    liquidityStressScore,
    downsideExposureScore,
    crashSurvivabilityScore,
    institutionalRiskLabel,
  };
}
function calculatePortfolioConstructionEngine(q) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const rsi = Number(technicals.rsi || 50);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);

  const liquidityFitScore = clampScore(
    45 +
    (volume >= 1000000 ? 25 : volume >= 250000 ? 18 : volume >= 25000 ? 10 : -20) +
    (price >= 5 ? 10 : -10)
  );

  const volatilityBalanceScore = clampScore(
    75 -
    (Math.abs(percentChange) > 20 ? 25 : 0) -
    (Math.abs(percentChange) > 12 ? 12 : 0) -
    (confirmations.gapTooHigh ? 15 : 0) -
    (rsi > 80 ? 15 : 0)
  );

  const diversificationFitScore = clampScore(
    55 +
    (price >= 5 ? 8 : -8) +
    (volumeRatio >= 1 && volumeRatio <= 3 ? 10 : 0) -
    (confirmations.fakeBreakout ? 25 : 0)
  );

  const positionSizingQualityScore = clampScore(
    60 +
    (volume >= 250000 ? 10 : 0) +
    (percentChange >= 0 && percentChange <= 15 ? 10 : 0) -
    (confirmations.newsRisk ? 20 : 0) -
    (confirmations.fakeBreakout ? 25 : 0)
  );

  const portfolioRiskContributionScore = clampScore(
    80 -
    (percentChange > 20 ? 20 : 0) -
    (confirmations.gapTooHigh ? 15 : 0) -
    (confirmations.newsRisk ? 25 : 0) -
    (volume < 25000 ? 25 : 0)
  );

  const portfolioConstructionScore = clampScore(
    liquidityFitScore * 0.24 +
    volatilityBalanceScore * 0.22 +
    diversificationFitScore * 0.18 +
    positionSizingQualityScore * 0.2 +
    portfolioRiskContributionScore * 0.16
  );

  const portfolioRole =
    portfolioConstructionScore >= 85
      ? "Core Position Candidate"
      : portfolioConstructionScore >= 75
        ? "Strong Portfolio Fit"
        : portfolioConstructionScore >= 65
          ? "Satellite Position"
          : portfolioConstructionScore >= 50
            ? "Small Tactical Position"
            : "Avoid Heavy Allocation";

  const suggestedAllocationTier =
    portfolioConstructionScore >= 85
      ? "High"
      : portfolioConstructionScore >= 70
        ? "Medium"
        : portfolioConstructionScore >= 55
          ? "Small"
          : "Watch Only";

  return {
    portfolioScore: portfolioConstructionScore,
    portfolioConstructionScore,
    liquidityFitScore,
    volatilityBalanceScore,
    diversificationFitScore,
    positionSizingQualityScore,
    portfolioRiskContributionScore,
    portfolioRole,
    suggestedAllocationTier,
  };
}
function calculateDividendWealthEngine(q) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);

  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const rsi = Number(technicals.rsi || 50);
  const volumeRatio = Number(
    confirmations.volumeSpikeRatio || q.volumeRatio || 0
  );

  const dividendSafetyScore = clampScore(
    50 +
    (price >= 10 ? 12 : 0) +
    (volume >= 1000000 ? 15 : volume >= 100000 ? 8 : -8) +
    (confirmations.newsRisk ? -25 : 0) +
    (confirmations.fakeBreakout ? -20 : 0)
  );

  const dividendGrowthScore = clampScore(
    50 +
    (percentChange >= 0 && percentChange <= 12 ? 12 : 0) +
    (rsi >= 45 && rsi <= 70 ? 10 : 0) -
    (percentChange > 25 ? 20 : 0)
  );

  const shareholderYieldScore = clampScore(
    50 +
    (volumeRatio >= 1.5 ? 10 : 0) +
    (confirmations.aboveVwap ? 8 : 0) +
    (confirmations.closeNearHigh ? 8 : 0)
  );

  const compoundingPotentialScore = clampScore(
    45 +
    (price >= 5 ? 10 : -5) +
    (volume >= 250000 ? 10 : 0) +
    (percentChange >= 1 && percentChange <= 15 ? 12 : 0) +
    (confirmations.fakeBreakout ? -25 : 0)
  );

  const incomeStabilityScore = clampScore(
    55 +
    (volume >= 1000000 ? 15 : volume >= 250000 ? 10 : 0) +
    (confirmations.newsRisk ? -25 : 0) +
    (confirmations.gapTooHigh ? -15 : 0)
  );

  const wealthBuilderScore = clampScore(
    dividendSafetyScore * 0.22 +
    dividendGrowthScore * 0.18 +
    shareholderYieldScore * 0.16 +
    compoundingPotentialScore * 0.26 +
    incomeStabilityScore * 0.18
  );

  let wealthProfile = "Momentum Only";

  if (wealthBuilderScore >= 85) {
    wealthProfile = "Elite Compounder";
  } else if (wealthBuilderScore >= 75) {
    wealthProfile = "Institutional Compounder";
  } else if (wealthBuilderScore >= 65) {
    wealthProfile = "Growth Compounder";
  } else if (wealthBuilderScore >= 50) {
    wealthProfile = "Speculative Growth";
  } else if (wealthBuilderScore < 35) {
    wealthProfile = "High Risk Income Trap";
  }

  return {
    dividendSafetyScore,
    dividendGrowthScore,
    shareholderYieldScore,
    compoundingPotentialScore,
    incomeStabilityScore,
    wealthBuilderScore,
    wealthProfile,
  };
}


function calculateMoatEngine(q) {
  const price = Number(q.current || q.price || 0);
  const volume = Number(q.volume || 0);
  const percentChange = Number(q.percentChange || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const rsi = Number(technicals.rsi || 50);
  const ema9 = Number(technicals.ema9 || 0);
  const ema20 = Number(technicals.ema20 || 0);

  const brandStrengthScore = clampScore(
    45 +
    (price >= 10 ? 15 : price >= 5 ? 8 : -8) +
    (volume >= 1000000 ? 15 : volume >= 100000 ? 8 : 0)
  );

  const pricingPowerScore = clampScore(
    50 +
    (percentChange > 0 && percentChange <= 12 ? 12 : 0) +
    (rsi >= 45 && rsi <= 70 ? 10 : 0) -
    (percentChange > 25 ? 20 : 0)
  );

  const marketPositionScore = clampScore(
    45 +
    (volume >= 1000000 ? 18 : volume >= 250000 ? 12 : volume >= 25000 ? 6 : -10) +
    (volumeRatio >= 1.5 ? 10 : 0)
  );

  const durabilityScore = clampScore(
    55 +
    (ema9 > ema20 ? 12 : -8) +
    (confirmations.aboveVwap ? 8 : 0) -
    (confirmations.fakeBreakout ? 25 : 0) -
    (confirmations.newsRisk ? 20 : 0)
  );

  const reinvestmentQualityScore = clampScore(
    50 +
    (price >= 5 ? 10 : -10) +
    (percentChange >= 1 && percentChange <= 15 ? 10 : 0) +
    (confirmations.closeNearHigh ? 8 : 0)
  );

  const competitiveAdvantageScore = clampScore(
    brandStrengthScore * 0.2 +
    pricingPowerScore * 0.2 +
    marketPositionScore * 0.22 +
    durabilityScore * 0.23 +
    reinvestmentQualityScore * 0.15
  );

  const moatLabel =
    competitiveAdvantageScore >= 80
      ? "Wide Moat"
      : competitiveAdvantageScore >= 65
        ? "Developing Moat"
        : competitiveAdvantageScore >= 50
          ? "Weak Moat"
          : "No Clear Moat";

  return {
    moatScore: competitiveAdvantageScore,
    competitiveAdvantageScore,
    brandStrengthScore,
    pricingPowerScore,
    marketPositionScore,
    durabilityScore,
    reinvestmentQualityScore,
    moatLabel,
  };
}

function calculateInstitutionalScores(q) {
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const momentum = Number(q.percentChange || 0);
  const volumeRatio = Number(confirmations.volumeSpikeRatio || q.volumeRatio || 0);
  const rsi = Number(technicals.rsi || 50);
  const ema9 = Number(technicals.ema9 || 0);
  const ema20 = Number(technicals.ema20 || 0);
  const macd = Number(technicals.macd || 0);
  const macdSignal = Number(technicals.macdSignal || 0);
  const dcf = calculateFundamentalDcfEngine(q);
  const earnings = calculateEarningsIntelligenceEngine(q);
  const edge = calculateStatisticalEdge(q);
  const moat = calculateMoatEngine(q);
  const wealth = calculateDividendWealthEngine(q);
  const portfolio = calculatePortfolioConstructionEngine(q);
  const sector = estimateSectorIntelligence(q);
  const advancedRisk = calculateAdvancedRiskEngine(q);
  const technicalScore = clampScore(
    45 +
    (momentum > 0 ? 10 : -10) +
    (momentum >= 2 ? 10 : 0) +
    (volumeRatio >= 1.5 ? 10 : 0) +
    (ema9 > ema20 ? 10 : 0) +
    (macd > macdSignal ? 10 : 0) +
    (rsi >= 45 && rsi <= 70 ? 10 : rsi > 80 ? -15 : 0)
  );

  const riskScore = clampScore(
    80 -
    (confirmations.fakeBreakout ? 35 : 0) -
    (confirmations.gapTooHigh ? 20 : 0) -
    (confirmations.newsRisk ? 30 : 0) -
    (momentum > 25 ? 15 : 0) -
    (volumeRatio < 0.8 ? 10 : 0)
  );

  const blendedRiskScore = clampScore(
    riskScore * 0.55 +
    advancedRisk.institutionalRiskScore * 0.45
  );

  const statisticalScore = edge.statisticalEdgeScore;

  const regime = engineState.marketRegime || detectMarketRegime([]);

  const macroScore = clampScore(
    regime.state === "aggressive bullish"
      ? 85
      : regime.state === "cautious bullish"
        ? 70
        : regime.state === "defensive"
          ? 50
          : 25
  );

  const fundamentalScore = dcf.fundamentalScore;

  const earningsScore = earnings.earningsScore;
  const moatScore = moat.moatScore;
  const dividendScore = wealth.wealthBuilderScore;
  const portfolioScore = portfolio.portfolioScore;

  const institutionalScore = clampScore(
    technicalScore * 0.25 +
    blendedRiskScore * 0.2 +
    statisticalScore * 0.2 +
    macroScore * 0.1 +
    fundamentalScore * 0.1 +
    earningsScore * 0.05 +
    moatScore * 0.04 +
    dividendScore * 0.02 +
    portfolioScore * 0.04 +
    sector.sectorScore * 0.03
  );

  const autoTradeApproved =
    institutionalScore >= CONFIG.minScoreToBuy &&
    blendedRiskScore >= 65 &&
    Number(q.volume || 0) >= 25000 &&
    Number(q.percentChange || 0) <= 20 &&
    confirmations.fakeBreakout !== true &&
    confirmations.newsRisk !== true;
  const decisionLevel = autoTradeApproved
    ? "Auto-Trade Approved"
    : institutionalScore >= 60
      ? "Qualified Setup"
      : "Visible Stock";

  return {
    technicalScore,
    macroScore,
    riskScore: blendedRiskScore,
    legacyRiskScore: riskScore,
    institutionalRiskScore: advancedRisk.institutionalRiskScore,
    drawdownRiskScore: advancedRisk.drawdownRiskScore,
    volatilityShockScore: advancedRisk.volatilityShockScore,
    liquidityStressScore: advancedRisk.liquidityStressScore,
    downsideExposureScore: advancedRisk.downsideExposureScore,
    crashSurvivabilityScore: advancedRisk.crashSurvivabilityScore,
    institutionalRiskLabel: advancedRisk.institutionalRiskLabel,
    statisticalScore,
    ...edge,
    fundamentalScore,
    intrinsicValue: dcf.intrinsicValue,
    valuationGapPercent: dcf.valuationGapPercent,
    valuationLabel: dcf.valuationLabel,
    valuationScore: dcf.valuationScore,
    balanceSheetHealthScore: dcf.balanceSheetHealthScore,
    cashFlowScore: dcf.cashFlowScore,
    revenueGrowthScore: dcf.revenueGrowthScore,
    marginScore: dcf.marginScore,
    debtRiskScore: dcf.debtRiskScore,
    earningsScore,
    revenueQualityScore: earnings.revenueQualityScore,
    guidanceScore: earnings.guidanceScore,
    marginExpansionScore: earnings.marginExpansionScore,
    epsSurpriseQualityScore: earnings.epsSurpriseQualityScore,
    institutionalEarningsSentiment: earnings.institutionalEarningsSentiment,
    earningsCashFlowStrength: earnings.earningsCashFlowStrength,
    moatScore,
    competitiveAdvantageScore: moat.competitiveAdvantageScore,
    brandStrengthScore: moat.brandStrengthScore,
    pricingPowerScore: moat.pricingPowerScore,
    marketPositionScore: moat.marketPositionScore,
    durabilityScore: moat.durabilityScore,
    reinvestmentQualityScore: moat.reinvestmentQualityScore,
    moatLabel: moat.moatLabel,
    dividendScore,
    dividendSafetyScore: wealth.dividendSafetyScore,
    dividendGrowthScore: wealth.dividendGrowthScore,
    shareholderYieldScore: wealth.shareholderYieldScore,
    compoundingPotentialScore: wealth.compoundingPotentialScore,
    incomeStabilityScore: wealth.incomeStabilityScore,
    wealthBuilderScore: wealth.wealthBuilderScore,
    wealthProfile: wealth.wealthProfile,
    portfolioScore,
    portfolioConstructionScore: portfolio.portfolioConstructionScore,
    liquidityFitScore: portfolio.liquidityFitScore,
    volatilityBalanceScore: portfolio.volatilityBalanceScore,
    diversificationFitScore: portfolio.diversificationFitScore,
    positionSizingQualityScore: portfolio.positionSizingQualityScore,
    portfolioRiskContributionScore: portfolio.portfolioRiskContributionScore,
    portfolioRole: portfolio.portfolioRole,
    suggestedAllocationTier: portfolio.suggestedAllocationTier,
    estimatedSector: sector.estimatedSector,
    sectorScore: sector.sectorScore,
    sectorMomentumScore: sector.sectorMomentumScore,
    sectorRiskScore: sector.sectorRiskScore,
    sectorLiquidityScore: sector.sectorLiquidityScore,
    sectorLeadershipScore: sector.sectorLeadershipScore,
    sectorRole: sector.sectorRole,
    institutionalScore,
    aiConfidence: institutionalScore,
    riskLevel: getRiskLevel(riskScore),
    tradeQuality: getTradeQuality(institutionalScore),
    marketRegime: regime.label || "Unknown",
    suggestedHoldTime: getSuggestedHoldTime(institutionalScore),
    decisionLevel,
    autoTradeApproved,
  };
}

function calculateEMA(values = [], period = 9) {
  if (values.length < period) return 0;

  const multiplier = 2 / (period + 1);

  let ema =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateRSI(closes = [], period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];

    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;

  const rs = gains / losses;

  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes = []) {
  if (closes.length < 26) {
    return {
      macd: 0,
      signal: 0,
    };
  }

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macd = ema12 - ema26;

  return {
    macd,
    signal: macd * 0.8,
  };
}

function calculateTechnicals(bars = []) {
  const closes = bars.map((b) => Number(b.c || 0)).filter(Boolean);

  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);

  const rsi = calculateRSI(closes, 14);

  const macdData = calculateMACD(closes);

  return {
    ema9,
    ema20,
    rsi,
    macd: macdData.macd,
    macdSignal: macdData.signal,
  };
} function passesQualityFilters(q) {
  if (!q.current || q.current <= 0) {
    return { ok: false, reason: "No valid price" };
  }

  // Hard block only extremely low liquidity.
  // Weak volume should score lower, not disappear from the scanner.
  if (CONFIG.minScanVolume > 0 && q.volume < CONFIG.minScanVolume) {
    return {
      ok: false,
      reason: `Extremely low volume (<${CONFIG.minScanVolume})`,
    };
  }

  if (
    q.current < CONFIG.minStockPrice ||
    (CONFIG.maxStockPrice > 0 && q.current > CONFIG.maxStockPrice)
  ) {
    return { ok: false, reason: `Price outside range: $${q.current}` };
  }

  if (q.percentChange > CONFIG.maxPercentChange) {
    return {
      ok: false,
      reason: `Dangerously extended: ${q.percentChange.toFixed(2)}%`,
    };
  }

  if (CONFIG.enableAdvancedFilters && q.confirmations) {
    if (q.confirmations.fakeBreakout) {
      return {
        ok: false,
        reason: `Fake breakout risk. Pulled back ${q.confirmations.pullbackFromHighPercent}% from high`,
      };
    }

    if (q.confirmations.newsRisk) {
      return {
        ok: false,
        reason: `News risk: ${q.confirmations.newsRiskReason}`,
      };
    }
  }

  return { ok: true };
}
async function getAccount() {
  return alpacaTradingRequest("/v2/account");
}

async function getPositions() {
  return alpacaTradingRequest("/v2/positions");
}

async function getOrders() {
  return alpacaTradingRequest(
    "/v2/orders?status=all&limit=100&direction=desc"
  );
}
// ===== CRYPTO FUNCTIONS START =====

async function getCryptoAssets() {
  const assets = await alpacaTradingRequest(
    "/v2/assets?status=active&asset_class=crypto"
  );

  return assets
    .filter((asset) => asset.tradable === true)
    .map((asset) => asset.symbol)
    .filter(Boolean);
}

async function getCryptoLatestQuote(symbol) {
  const data = await alpacaDataRequest(
    `/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(symbol)}`
  );

  const quote = data?.quotes?.[symbol];

  if (!quote) {
    throw new Error(`No crypto quote found for ${symbol}`);
  }

  const price = Number(quote.ap || quote.bp || 0);

  if (!price || price <= 0) {
    throw new Error(`Invalid crypto price for ${symbol}`);
  }

  return {
    symbol,
    current: price,
    bid: Number(quote.bp || 0),
    ask: Number(quote.ap || 0),
    assetClass: "crypto",
  };
}

async function getCryptoRecentBars(symbol, timeframe = "5Min", limit = 30) {
  const data = await alpacaDataRequest(
    `/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(
      symbol
    )}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`
  );

  const bars = data?.bars?.[symbol];

  return Array.isArray(bars) ? bars : [];
}

function scoreCrypto(quote, bars = []) {
  if (!bars.length) return 0;

  const latest = bars[bars.length - 1];
  const first = bars[0];

  const current = Number(latest.c || quote.current || 0);
  const open = Number(first.o || 0);
  const high = Math.max(...bars.map((b) => Number(b.h || 0)));
  const low = Math.min(...bars.map((b) => Number(b.l || 0)));

  const momentumPercent =
    open > 0 ? ((current - open) / open) * 100 : 0;

  const closeNearHigh =
    high > low ? ((current - low) / (high - low)) * 100 : 0;

  let score = 0;

  if (momentumPercent > 0) score += 25;
  if (momentumPercent >= 0.25) score += 20;
  if (momentumPercent >= 0.5) score += 20;
  if (momentumPercent >= 1) score += 10;

  if (closeNearHigh >= 70) score += 15;
  if (closeNearHigh >= 85) score += 10;

  if (momentumPercent < -0.25) score -= 25;
  if (closeNearHigh < 40) score -= 15;

  return Math.min(100, Math.max(0, Math.round(score)));
}

async function scanCryptoMarket() {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) {
    throw new Error("Crypto scanner is only available in live modes");
  }

  const symbols = await getCryptoAssets();
  const results = [];

  engineState.skippedSymbols = [];

  for (const symbol of symbols) {
    try {
      const quote = await getCryptoLatestQuote(symbol);
      const bars = await getCryptoRecentBars(symbol, "5Min", 30);
      const score = scoreCrypto(quote, bars);

      results.push({
        ...quote,
        score,
        barsFound: bars.length,
        qualifiedToBuy: score >= 45,
      });
    } catch (err) {
      saveSkippedSymbol(symbol, err.message);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

async function placeCryptoMarketBuy(symbol, dollars) {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) {
    throw new Error("Crypto buying is only allowed in live modes");
  }

  return alpacaTradingRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: normalizeSymbol(symbol),
      notional: Math.max(25, Number(dollars.toFixed(2))),
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      client_order_id: `${AI_ORDER_PREFIX}_CRYPTO_BUY_${normalizeSymbol(
        symbol
      )}_${Date.now()}`,
    }),
  });
}

async function placeCryptoMarketSell(symbol, qty, reason = "CRYPTO_EXIT") {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) {
    throw new Error("Crypto selling is only allowed in live modes");
  }

  return alpacaTradingRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: normalizeSymbol(symbol),
      qty: String(qty),
      side: "sell",
      type: "market",
      time_in_force: "gtc",
      client_order_id: `${AI_ORDER_PREFIX}_${reason}_${normalizeSymbol(
        symbol
      )}_${Date.now()}`,
    }),
  });
}

// ===== CRYPTO FUNCTIONS END =====

async function getClock() {
  return alpacaTradingRequest("/v2/clock");
}

function isAiOrder(order) {
  return String(order.client_order_id || "").startsWith(AI_ORDER_PREFIX);
}

async function getAiOwnedSymbols() {
  const orders = await getOrders();

  const aiFilledBuys = orders.filter((order) => {
    const side = String(order.side || "").toLowerCase();
    const status = String(order.status || "").toLowerCase();

    return side === "buy" && status === "filled" && isAiOrder(order);
  });

  return new Set(aiFilledBuys.map((order) => normalizeSymbol(order.symbol)));
}

async function getAiEntryScores() {
  const orders = await getOrders();
  const scoreMap = {};

  for (const order of orders) {
    const symbol = normalizeSymbol(order.symbol);
    const side = String(order.side || "").toLowerCase();
    const status = String(order.status || "").toLowerCase();

    if (side !== "buy") continue;
    if (status !== "filled") continue;
    if (!isAiOrder(order)) continue;

    if (!scoreMap[symbol]) {
      scoreMap[symbol] = engineState.aiEntryScores[symbol] || 0;
    }
  }

  return scoreMap;
}

async function getTopMovers() {
  let moverSymbols = [];

  try {
    const top = Math.min(Math.max(CONFIG.moversTop, 1), 100);

    const data = await alpacaDataRequest(
      `/v1beta1/screener/stocks/movers?top=${top}`
    );

    const gainers = Array.isArray(data.gainers) ? data.gainers : [];
    const losers = Array.isArray(data.losers) ? data.losers : [];

    moverSymbols = [...gainers, ...losers]
      .map((item) => item.symbol)
      .filter(Boolean)
      .map(normalizeSymbol)
      .filter(isNormalStockSymbol);

    moverSymbols = [...new Set(moverSymbols)];

    console.log(`Alpaca movers found: ${moverSymbols.length}`);
  } catch (err) {
    console.log("Alpaca movers failed. Using assets fallback:", err.message);
  }

  const minSymbolsNeeded = Number(process.env.MIN_SYMBOLS_NEEDED || 1);
  const maxAssetsFallback = Number(process.env.MAX_ASSETS_FALLBACK || 300);

  if (moverSymbols.length >= minSymbolsNeeded) {
    return moverSymbols;
  }

  console.log(
    `Only ${moverSymbols.length} movers found. Adding Alpaca assets fallback...`
  );

  const assets = await alpacaTradingRequest(
    "/v2/assets?status=active&asset_class=us_equity"
  );

  const fallbackSymbols = assets
    .filter((asset) => asset.tradable === true)
    .filter((asset) => asset.fractionable === true)
    .map((asset) => asset.symbol)
    .filter(Boolean)
    .map(normalizeSymbol)
    .filter(isNormalStockSymbol)
    .slice(0, maxAssetsFallback);

  const combinedSymbols = [
    ...new Set([...moverSymbols, ...fallbackSymbols]),
  ];

  console.log(`Combined scan symbols: ${combinedSymbols.length}`);

  return combinedSymbols;
}
async function scanMarket() {
  const symbols = await getTopMovers();

  const maxSymbolsToScan = Number(process.env.MAX_SYMBOLS_TO_SCAN || 100);

  // 🔥 Dynamic scan size from Render env
  const limitedSymbols = symbols.slice(0, maxSymbolsToScan);

  engineState.skippedSymbols = [];

  console.log(`Scanning ${limitedSymbols.length} of ${symbols.length} symbols...`);
  console.log("Advanced filters enabled:", CONFIG.enableAdvancedFilters);

  const batchSize = 5; // safe for now (can increase later)

  const results = await runInBatches(limitedSymbols, batchSize, async (symbol) => {
    try {
      const assetCheck = await isAssetBuyEligible(symbol);

      if (!assetCheck.ok) {
        saveSkippedSymbol(symbol, assetCheck.reason);
        return null;
      }

      const quote = await getCombinedStockQuote(symbol);

      const technicalBars = await getRecentBars(symbol, "5Min", 60);
      quote.technicals = calculateTechnicals(technicalBars);

      if (CONFIG.enableAdvancedFilters) {
        quote.confirmations = await getAdvancedConfirmations(quote);
      }
      const quality = passesQualityFilters(quote);

      if (!quality.ok) {
        saveSkippedSymbol(symbol, quality.reason);
        return null;
      }

      const score = scoreStock(quote);
      const institutional = calculateInstitutionalScores({
        ...quote,
        score,
      });

      const portfolioManager = calculateAiPortfolioManagerDecision(
        institutional,
        engineState.cachedAccount || {},
        engineState.cachedPositions || [],
        engineState.marketRegime || detectMarketRegime([])
      );

      return {
        ...quote,
        score: institutional.institutionalScore,
        legacyMomentumScore: score,
        ...institutional,
        ...portfolioManager,
        qualifiedToBuy: institutional.decisionLevel !== "Visible Stock",
      };
    } catch (err) {
      saveSkippedSymbol(symbol, err.message);
      return null;
    }
  });

  console.log(`Scan finished. Found ${results.length} stocks.`);

  return results
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.percentChange - a.percentChange;
    })
    .slice(0, CONFIG.maxSignalsToReturn);
}

async function placeMarketBuy(symbol, dollars, score = 0) {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (buyingNow.has(normalizedSymbol)) {
    throw new Error(`${normalizedSymbol} already has a buy in progress`);
  }

  buyingNow.add(normalizedSymbol);

  try {
    const assetCheck = await isAssetBuyEligible(normalizedSymbol);

    if (!assetCheck.ok) {
      throw new Error(assetCheck.reason);
    }

    const safeDollars = Number(dollars || 0);

    if (!safeDollars || safeDollars <= 0) {
      throw new Error(`Invalid buy amount for ${normalizedSymbol}`);
    }

    const order = await alpacaTradingRequest("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: normalizedSymbol,
        notional: Number(safeDollars.toFixed(2)),
        side: "buy",
        type: "market",
        time_in_force: "day",
        client_order_id: `${AI_ORDER_PREFIX}_BUY_${normalizedSymbol}_${Date.now()}`,
      }),
    });

    engineState.aiEntryScores[normalizedSymbol] = score;
    markAiManagedSymbol(normalizedSymbol);
    saveEngineState("BUY_ORDER_SENT");

    return order;
  } finally {
    setTimeout(() => buyingNow.delete(normalizedSymbol), 30000);
  }
}

async function placeMarketSell(symbol, qty, reason = "AI_EXIT") {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (sellingNow.has(normalizedSymbol)) {
    throw new Error(`${normalizedSymbol} already has a sell in progress`);
  }

  sellingNow.add(normalizedSymbol);

  try {
    const assetCheck = await isAssetSellEligible(normalizedSymbol);

    if (!assetCheck.ok) {
      throw new Error(assetCheck.reason);
    }

    return await alpacaTradingRequest("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: normalizedSymbol,
        qty: String(qty),
        side: "sell",
        type: "market",
        time_in_force: "day",
        client_order_id: `${AI_ORDER_PREFIX}_${reason}_${normalizedSymbol}_${Date.now()}`,
      }),
    });
  } finally {
    setTimeout(() => sellingNow.delete(normalizedSymbol), 10000);
  }
}
async function closePosition(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);

  const assetCheck = await isAssetSellEligible(normalizedSymbol);

  if (!assetCheck.ok) {
    throw new Error(assetCheck.reason);
  }

  return alpacaTradingRequest(`/v2/positions/${normalizedSymbol}`, {
    method: "DELETE",

  });
}


function addPendingExit(symbol, qty, reason, extra = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);

  const alreadyPending = engineState.pendingExits.some(
    (exit) => normalizeSymbol(exit.symbol) === normalizedSymbol
  );

  if (alreadyPending) {
    return false;
  }

  engineState.pendingExits.unshift({
    symbol: normalizedSymbol,
    qty,
    reason,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.pendingExits = engineState.pendingExits.slice(0, 100);

  return true;
}

function minutesUntil(dateString) {
  const target = new Date(dateString).getTime();
  const now = Date.now();

  return (target - now) / 1000 / 60;
}

async function flattenStocksAndCryptoBeforeMarketClose(clock) {
  if (!clock?.is_open || !clock?.next_close) return false;

  const minsUntilClose = minutesUntil(clock.next_close);
  const todayKey = new Date().toISOString().slice(0, 10);

  if (minsUntilClose > 60 || minsUntilClose <= 0) return false;

  engineState.stockTradingStoppedForDay = true;
  engineState.cryptoTradingStoppedForDay = true;

  if (engineState.lastFlattenAllBeforeCloseAt === todayKey) {
    return true;
  }

  engineState.lastFlattenAllBeforeCloseAt = todayKey;

  // Cancel all open orders first
  try {
    const orders = await getOrders();

    const openOrders = orders.filter((order) => {
      const status = String(order.status || "").toLowerCase();

      return (
        status === "new" ||
        status === "accepted" ||
        status === "partially_filled" ||
        status === "pending_new"
      );
    });

    for (const order of openOrders) {
      try {
        await alpacaTradingRequest(`/v2/orders/${order.id}`, {
          method: "DELETE",
        });

        saveRecentOrder("ORDER_CANCELLED_1_HOUR_BEFORE_CLOSE", order.symbol, {
          orderId: order.id,
          status: order.status,
          minutesUntilClose: Number(minsUntilClose.toFixed(2)),
        });
      } catch (err) {
        saveFailedOrder(
          "ORDER_CANCEL_1_HOUR_BEFORE_CLOSE_FAILED",
          order.symbol,
          err.message,
          { orderId: order.id }
        );
      }
    }
  } catch (err) {
    saveFailedOrder("ORDER_CANCEL_SCAN_1_HOUR_BEFORE_CLOSE_FAILED", "ALL", err.message);
  }

  // Sell all filled/open positions: stocks and crypto
  const positions = await getPositions();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);
    const qty = Number(pos.qty);

    if (!qty || qty <= 0) continue;

    const isCrypto = symbol.includes("/") || symbol.endsWith("USD");

    try {
      const order = isCrypto
        ? await placeCryptoMarketSell(
          symbol,
          qty,
          "CRYPTO_FLATTEN_1_HOUR_BEFORE_MARKET_CLOSE"
        )
        : await placeMarketSell(
          symbol,
          qty,
          "STOCK_FLATTEN_1_HOUR_BEFORE_MARKET_CLOSE"
        );

      saveRecentOrder("POSITION_CLOSED_1_HOUR_BEFORE_CLOSE", symbol, {
        qty,
        assetClass: isCrypto ? "crypto" : "stock",
        minutesUntilClose: Number(minsUntilClose.toFixed(2)),
        order,
      });

      delete engineState.highWaterMarks[symbol];
      delete engineState.aiEntryScores[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {
      saveFailedOrder(
        "POSITION_CLOSE_1_HOUR_BEFORE_CLOSE_FAILED",
        symbol,
        err.message,
        {
          qty,
          assetClass: isCrypto ? "crypto" : "stock",
        }
      );
    }
  }

  return true;
}

async function autoCloseCryptoBeforeMarketOpen(clock) {
  const nextOpen = clock?.next_open;

  if (!nextOpen) return;

  const minsUntilOpen = minutesUntil(nextOpen);

  if (minsUntilOpen > 60 || minsUntilOpen <= 0) return;

  const todayKey = new Date().toISOString().slice(0, 10);

  if (engineState.lastCryptoCloseAllBeforeOpenAt === todayKey) return;

  engineState.lastCryptoCloseAllBeforeOpenAt = todayKey;
  engineState.cryptoTradingStoppedForDay = true;

  const positions = await getPositions();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);

    if (!symbol.endsWith("USD")) continue;

    const qty = Number(pos.qty);

    if (!qty || qty <= 0) continue;

    try {
      const order = await placeCryptoMarketSell(
        symbol,
        qty,
        "CRYPTO_CLOSE_5_MIN_BEFORE_MARKET_OPEN"
      );

      saveRecentOrder("CRYPTO_CLOSED_BEFORE_MARKET_OPEN", symbol, {
        qty,
        minutesUntilOpen: Number(minsUntilOpen.toFixed(2)),
        order,
      });

      delete engineState.highWaterMarks[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {
      saveFailedOrder(
        "CRYPTO_CLOSE_BEFORE_MARKET_OPEN_FAILED",
        symbol,
        err.message,
        { qty }
      );
    }
  }
}

async function forceCloseAllPositions(reason, marketOpen) {
  const positions = await getPositions();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);
    const qty = Number(pos.qty);

    if (!qty || qty <= 0) continue;

    const isCrypto = symbol.includes("/") || symbol.endsWith("USD");

    if (!marketOpen && !isCrypto) {
      addPendingExit(symbol, qty, reason, {
        message: "Market closed. Stock exit queued for next market open.",
      });

      saveRecentOrder("FORCE_CLOSE_PENDING_MARKET_CLOSED", symbol, {
        qty,
        reason,
      });

      continue;
    }

    try {
      const order = isCrypto
        ? await placeCryptoMarketSell(symbol, qty, reason)
        : await placeMarketSell(symbol, qty, reason);

      saveRecentOrder("FORCE_CLOSE_EXECUTED", symbol, {
        qty,
        reason,
        assetClass: isCrypto ? "crypto" : "stock",
        order,
      });

      delete engineState.highWaterMarks[symbol];
      delete engineState.aiEntryScores[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {
      saveFailedOrder("FORCE_CLOSE_FAILED", symbol, err.message, {
        qty,
        reason,
        assetClass: isCrypto ? "crypto" : "stock",
      });
    }
  }
}

async function checkDailyLossAndProfitLock(account, marketOpen) {
  const equity = Number(account.equity || 0);
  const currentMode = TRADING_MODE;

  if (engineState.lastMode !== currentMode) {
    engineState.dailyStartEquity = equity;
    engineState.dailyPeakEquity = equity;
    engineState.profitLockFloorEquity = null;
    engineState.dailyLossLocked = false;
    engineState.profitLocked = false;
    engineState.lastMode = currentMode;

    console.log("🔄 Daily baseline reset due to mode change:", currentMode);
    return false;
  }

  if (!engineState.dailyStartEquity) {
    engineState.dailyStartEquity = equity;
    engineState.dailyPeakEquity = equity;
    engineState.lastMode = currentMode;
    return false;
  }

  engineState.dailyPeakEquity = Math.max(
    Number(engineState.dailyPeakEquity || engineState.dailyStartEquity),
    equity
  );

  const dailyStart = Number(engineState.dailyStartEquity || equity);
  const dailyPeak = Number(engineState.dailyPeakEquity || equity);

  const lossPercent = ((dailyStart - equity) / dailyStart) * 100;
  const profitPercent = ((equity - dailyStart) / dailyStart) * 100;
  const peakProfitPercent = ((dailyPeak - dailyStart) / dailyStart) * 100;

  if (
    lossPercent >= CONFIG.dailyLossLimitPercent &&
    !engineState.dailyLossLocked
  ) {
    engineState.dailyLossLocked = true;
    saveEngineState("DAILY_LOSS_LOCKED");
    autoTradingEnabled = false;

    saveRecentOrder("DAILY_LOSS_LOCKED", "ACCOUNT", {
      equity,
      dailyStart,
      lossPercent,
      dailyLossLimitPercent: CONFIG.dailyLossLimitPercent,
    });

    await forceCloseAllPositions("DAILY_LOSS_LIMIT", marketOpen);

    return true;
  }

  if (
    peakProfitPercent >= CONFIG.profitLockTriggerPercent &&
    !engineState.profitLockFloorEquity
  ) {
    const profitDollars = dailyPeak - dailyStart;
    const protectedProfit =
      profitDollars * (CONFIG.profitLockProtectPercent / 100);

    engineState.profitLockFloorEquity = dailyStart + protectedProfit;

    saveRecentOrder("PROFIT_LOCK_ACTIVATED", "ACCOUNT", {
      dailyStart,
      dailyPeak,
      profitDollars,
      protectedProfit,
      profitLockFloorEquity: engineState.profitLockFloorEquity,
      dailyDateKey: engineState.dailyDateKey,

      profitLockTriggerPercent: CONFIG.profitLockTriggerPercent,
      profitLockProtectPercent: CONFIG.profitLockProtectPercent,
    });
  }

  if (
    engineState.profitLockFloorEquity &&
    equity <= Number(engineState.profitLockFloorEquity) &&
    !engineState.profitLocked
  ) {
    engineState.profitLocked = true;
    saveEngineState("PROFIT_LOCKED");
    autoTradingEnabled = false;

    saveRecentOrder("PROFIT_LOCK_HIT", "ACCOUNT", {
      equity,
      dailyStart,
      dailyPeak,
      profitPercent,
      peakProfitPercent,
      profitLockFloorEquity: engineState.profitLockFloorEquity,
    });

    await forceCloseAllPositions("PROFIT_LOCK_EXIT", marketOpen);

    return true;
  }

  return false;
}

async function executePendingExits() {
  if (engineState.pendingExits.length === 0) return;

  const pending = [...engineState.pendingExits];

  for (const exit of pending) {
    try {
      const order = await placeMarketSell(
        exit.symbol,
        Number(exit.qty),
        exit.reason
      );

      saveRecentOrder("PENDING_EXIT_EXECUTED", exit.symbol, {
        qty: exit.qty,
        reason: exit.reason,
        order,
      });

      engineState.pendingExits = engineState.pendingExits.filter(
        (item) => normalizeSymbol(item.symbol) !== normalizeSymbol(exit.symbol)
      );

      delete engineState.highWaterMarks[normalizeSymbol(exit.symbol)];
      delete engineState.aiEntryScores[normalizeSymbol(exit.symbol)];
      delete engineState.runnerPositions[normalizeSymbol(exit.symbol)];
    } catch (err) {
      saveFailedOrder("PENDING_EXIT_FAILED", exit.symbol, err.message, exit);
    }
  }
}

async function autoExitPositions(marketOpen) {
  const positions = engineState.cachedPositions || (await getPositions());
  const aiOwnedSymbols = await getAiOwnedSymbols();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);
    if (symbol.includes("/") || symbol.endsWith("USD")) continue;


    const isAiOwned = aiOwnedSymbols.has(symbol);
    const isManualManaged = engineState.aiManagedSymbols?.includes(symbol);


    const qty = Number(pos.qty);
    const currentPrice = Number(pos.current_price);
    const unrealizedPercent = Number(pos.unrealized_plpc) * 100;

    if (!qty || !currentPrice) continue;

    const previousHigh = Number(engineState.highWaterMarks[symbol] || 0);
    const highWater = Math.max(previousHigh, currentPrice);

    engineState.highWaterMarks[symbol] = highWater;

    const dropFromHigh =
      highWater > 0 ? ((highWater - currentPrice) / highWater) * 100 : 0;

    const alreadyRunner = Boolean(engineState.runnerPositions[symbol]);
    const shouldActivateRunner =
      unrealizedPercent >= CONFIG.runnerTriggerPercent;

    if (shouldActivateRunner && !alreadyRunner) {
      engineState.runnerPositions[symbol] = {
        activatedAt: new Date().toISOString(),
        activatedProfitPercent: unrealizedPercent,
        activatedPrice: currentPrice,
        highWater,
      };

      saveRecentOrder("RUNNER_ACTIVATED", symbol, {
        dynamicRunnerTrailingStopPercent:
          unrealizedPercent >= 15
            ? 2
            : unrealizedPercent >= 10
              ? 1.5
              : CONFIG.runnerTrailingStopPercent,
        qty,
        price: currentPrice,
        profitPercent: unrealizedPercent,
        runnerTriggerPercent: CONFIG.runnerTriggerPercent,
        runnerTrailingStopPercent: CONFIG.runnerTrailingStopPercent,
      });
    }

    const isRunner = Boolean(engineState.runnerPositions[symbol]);

    const shouldStopLoss = unrealizedPercent <= -CONFIG.stopLossPercent;
    const shouldProtectProfit =
      unrealizedPercent >= 2 &&
      dropFromHigh >= 0.8;

    const shouldNormalTrailingExit =
      !isRunner &&
      unrealizedPercent > 0 &&
      dropFromHigh >= CONFIG.trailingStopPercent;

    const dynamicRunnerTrailingStopPercent =
      unrealizedPercent >= 15
        ? 2
        : unrealizedPercent >= 10
          ? 1.5
          : CONFIG.runnerTrailingStopPercent;

    const shouldRunnerTrailingExit =
      isRunner && dropFromHigh >= dynamicRunnerTrailingStopPercent;
    if (
      !shouldStopLoss &&
      !shouldProtectProfit &&
      !shouldNormalTrailingExit &&
      !shouldRunnerTrailingExit
    ) {
      continue;
    }

    let reason = "AI_EXIT";

    if (shouldStopLoss) reason = "STOP_LOSS";
    else if (shouldRunnerTrailingExit) reason = "RUNNER_TRAILING_STOP";
    else if (shouldProtectProfit) reason = "PROFIT_PROTECTION";
    else if (shouldNormalTrailingExit) reason = "TRAILING_STOP";

    if (!marketOpen) {
      addPendingExit(symbol, qty, reason, {
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        isRunner,
      });

      saveRecentOrder("EXIT_PENDING_MARKET_CLOSED", symbol, {
        dynamicRunnerTrailingStopPercent,
        qty,
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        reason,
        isRunner,
      });

      continue;
    }

    try {
      const order = await placeMarketSell(symbol, qty, reason);

      saveRecentOrder(reason, symbol, {
        dynamicRunnerTrailingStopPercent,
        qty,
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        isRunner,
        order,
      });

      rememberTradeResult(symbol, {
        profitPercent: unrealizedPercent,
        reason,
      });
      delete engineState.highWaterMarks[symbol];
      engineState.lastSoldAt[symbol] = Date.now();
      delete engineState.aiEntryScores[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {
      saveFailedOrder(`${reason}_FAILED`, symbol, err.message, {
        dynamicRunnerTrailingStopPercent,
        qty,
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        isRunner,
      });
    }
  }
}
async function autoExitCryptoPositions() {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) return;
  const positions = await getPositions();

  for (const pos of positions) {

    const symbol = normalizeSymbol(pos.symbol);

    if (!symbol.endsWith("USD")) continue;

    const qty = Number(pos.qty);
    const currentPrice = Number(pos.current_price);
    const profitPercent = Number(pos.unrealized_plpc) * 100;

    if (!qty || qty <= 0 || !currentPrice) continue;

    const previousHigh = Number(engineState.highWaterMarks[symbol] || 0);
    const highWater = Math.max(previousHigh, currentPrice);
    engineState.highWaterMarks[symbol] = highWater;

    const dropFromHigh =
      highWater > 0 ? ((highWater - currentPrice) / highWater) * 100 : 0;

    const TAKE_PROFIT_ACTIVATE = 3;
    const HARD_STOP_LOSS = -1.2;
    const TRAILING_STOP = 1;
    const MIN_PROFIT_TO_TRAIL = 1.5;

    const trailingActive = profitPercent >= TAKE_PROFIT_ACTIVATE;
    const shouldStopLoss = profitPercent <= HARD_STOP_LOSS;
    const shouldTrailingStop =
      trailingActive &&
      profitPercent >= MIN_PROFIT_TO_TRAIL &&
      dropFromHigh >= TRAILING_STOP;

    if (!shouldStopLoss && !shouldTrailingStop) continue;

    let reason = "CRYPTO_EXIT";

    if (shouldStopLoss) reason = "CRYPTO_STOP_LOSS";
    else if (shouldTrailingStop) reason = "CRYPTO_TRAILING_STOP";


    try {
      const order = await placeCryptoMarketSell(symbol, qty, reason);

      saveRecentOrder("AUTO_CRYPTO_SELL", symbol, {
        qty,
        currentPrice,
        profitPercent,
        highWater,
        dropFromHigh,
        reason,
        order,
      });
      rememberTradeResult(symbol, {
        profitPercent,
        reason,
      });
      delete engineState.highWaterMarks[symbol];
      engineState.lastSoldAt[symbol] = Date.now();
    } catch (err) {
      saveFailedOrder("AUTO_CRYPTO_SELL_FAILED", symbol, err.message, {
        qty,
        currentPrice,
        profitPercent,
        reason,
      });
    }
  }
}
async function replaceWeakestIfBetter(signals, positions, aiOwnedSymbols) {
  if (positions.length < CONFIG.maxOpenTrades) return false;

  const aiEntryScores = await getAiEntryScores();

  const aiPositions = positions.filter((p) =>
    aiOwnedSymbols.has(normalizeSymbol(p.symbol))
  );

  if (aiPositions.length === 0) return false;

  const topCandidate = signals
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => s.score >= CONFIG.minScoreToBuy)
    .filter((s) => !aiOwnedSymbols.has(normalizeSymbol(s.symbol)))
    .slice(0, CONFIG.topAutoTradeCandidates)[0];

  if (!topCandidate) return false;

  const weakest = aiPositions.reduce((weak, pos) => {
    const weakScore =
      aiEntryScores[normalizeSymbol(weak.symbol)] ||
      engineState.aiEntryScores[normalizeSymbol(weak.symbol)] ||
      0;

    const posScore =
      aiEntryScores[normalizeSymbol(pos.symbol)] ||
      engineState.aiEntryScores[normalizeSymbol(pos.symbol)] ||
      0;

    return posScore < weakScore ? pos : weak;
  });

  const weakestSymbol = normalizeSymbol(weakest.symbol);
  const weakestScore =
    aiEntryScores[weakestSymbol] ||
    engineState.aiEntryScores[weakestSymbol] ||
    0;

  const scoreGap = topCandidate.score - weakestScore;

  if (scoreGap < CONFIG.replaceWeakestMinScoreGap) return false;

  try {
    const qty = Number(weakest.qty);

    if (!qty || qty <= 0) return false;

    const sellOrder = await placeMarketSell(
      weakestSymbol,
      qty,
      `ROTATE_TO_${topCandidate.symbol}`
    );

    saveRecentOrder("ROTATED_OUT_WEAK_POSITION", weakestSymbol, {
      weakestScore,
      replacementSymbol: topCandidate.symbol,
      replacementScore: topCandidate.score,
      scoreGap,
      sellOrder,
    });

    delete engineState.highWaterMarks[weakestSymbol];
    delete engineState.aiEntryScores[weakestSymbol];
    delete engineState.runnerPositions[weakestSymbol];

    setTimeout(async () => {
      try {
        const account = engineState.cachedAccount || (await getAccount());
        const freshPositions =
          engineState.cachedPositions || (await getPositions());
        const freshAiOwnedSymbols = await getAiOwnedSymbols();

        const freshAiPositions = freshPositions.filter((p) =>
          freshAiOwnedSymbols.has(normalizeSymbol(p.symbol))
        );

        const portfolioManager = calculateAiPortfolioManagerDecision(
          topCandidate,
          account,
          freshAiPositions,
          engineState.marketRegime || detectMarketRegime([])
        );

        const tradeAmount = portfolioManager.recommendedTradeAmount;

        if (tradeAmount <= 0) {
          saveFailedOrder(
            "ROTATION_BUY_FAILED",
            topCandidate.symbol,
            "Bot budget used up or no cash available"
          );
          return;
        }

        const buyOrder = await placeMarketBuy(
          topCandidate.symbol,
          tradeAmount,
          topCandidate.score
        );
      saveRecentOrder("AUTO_BUY_INSTITUTIONAL_ALLOCATOR", stock.symbol, {
        price: stock.current,
        score: stock.score,
        confirmations: stock.confirmations || null,
        tradeAmount,
        maxBotExposurePercent: CONFIG.maxBotExposurePercent,
        portfolioManager: refreshedPortfolioManager,
        buyOrder,
      });
      
      } catch (err) {
        saveFailedOrder("ROTATION_BUY_FAILED", topCandidate.symbol, err.message, {
          replacedSymbol: weakestSymbol,
          score: topCandidate.score,
        });
      }
    }, 2500);

    return true;
  } catch (err) {
    saveFailedOrder("ROTATION_SELL_FAILED", weakestSymbol, err.message, {
      replacementSymbol: topCandidate.symbol,
      replacementScore: topCandidate.score,
    });

    return false;
  }
}


async function autoBuySignals(signals) {
  const regime = engineState.marketRegime || detectMarketRegime(signals);

  if (regime.state === "panic/high volatility" || regime.exposureMultiplier <= 0) {
    saveRecentOrder("BUY_SKIPPED_MARKET_REGIME", "ALL", {
      marketRegime: regime.label,
      riskMessage: regime.riskMessage,
    });
    return;
  }
  const positions = await getPositions();
  const aiOwnedSymbols = await getAiOwnedSymbols();

  const openSymbols = new Set(positions.map((p) => normalizeSymbol(p.symbol)));

  const aiPositions = positions.filter((p) =>
    aiOwnedSymbols.has(normalizeSymbol(p.symbol))
  );

  if (aiPositions.length >= CONFIG.maxOpenTrades) {
    await replaceWeakestIfBetter(signals, positions, aiOwnedSymbols);
    return;
  }

  const openSlots = CONFIG.maxOpenTrades - aiPositions.length;
  const buyCandidates = signals
    .filter((s) => s.autoTradeApproved === true)
    .filter((s) => s.decisionLevel === "Auto-Trade Approved")
    .filter((s) => s.score >= CONFIG.minScoreToBuy)
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => s.confirmations?.fakeBreakout !== true)
    .filter((s) => s.confirmations?.newsRisk !== true)
    .filter((s) => !openSymbols.has(normalizeSymbol(s.symbol)))
  .filter((s) => {
  const cooldown =
    engineState.symbolCooldowns[
      normalizeSymbol(s.symbol)
    ];

  if (!cooldown) return true;

  return (
    Date.now() - new Date(cooldown).getTime() >
    engineState.cooldownMinutes * 60 * 1000
  );
})  
    .filter((s) => !shouldSkipFromTradeMemory(s.symbol))
    .filter((s) => isNormalStockSymbol(s.symbol))
    .slice(0, Math.min(openSlots, CONFIG.topAutoTradeCandidates));

  for (const stock of buyCandidates) {

    const portfolioManager = calculateAiPortfolioManagerDecision(
      stock,
      engineState.cachedAccount || (await getAccount()),
      aiPositions,
      regime
    );

    if (
      portfolioManager.aiPortfolioAction === "Watch Only" ||
      portfolioManager.aiPortfolioAction === "No Capital Available"
    ) {
    saveRecentOrder("BUY_SKIPPED_AI_PORTFOLIO_MANAGER", stock.symbol, {
  portfolioManager,
  message: "Skipped by AI Portfolio Manager",
});
      continue;
    }
    const pullback = Number(
      stock.confirmations?.pullbackFromHighPercent || 0
    );

    // Skip weak pullbacks
    if (pullback > 3) {
      saveRecentOrder("BUY_SKIPPED_PULLBACK", stock.symbol, {
        pullback,
        message: "Skipped — too much pullback from high",
      });
      continue;
    }
    const symbol = normalizeSymbol(stock.symbol);

    // 🧠 STOCK TRADE MEMORY FILTER
    if (shouldSkipFromTradeMemory(symbol)) {
      saveRecentOrder("BUY_SKIPPED_TRADE_MEMORY", symbol, {
        message: "Skipped because this stock recently produced repeated losses.",
        memory: engineState.tradeMemory?.[symbol],
      });
      continue;
    }

    // 🧠 STOCK COOLDOWN — no rebuy for 30 minutes after selling
    const lastSoldAt = Number(engineState.lastSoldAt?.[symbol] || 0);
    const minutesSinceSold = lastSoldAt
      ? (Date.now() - lastSoldAt) / 1000 / 60
      : Infinity;

    if (minutesSinceSold < 30) {
      saveRecentOrder("BUY_SKIPPED_COOLDOWN", symbol, {
        minutesSinceSold: Number(minutesSinceSold.toFixed(1)),
        message: "Skipped stock rebuy during cooldown.",
      });
      continue;
    }
    try {
      const account = engineState.cachedAccount || (await getAccount());
      const freshPositions =
        engineState.cachedPositions || (await getPositions());
      const freshAiOwnedSymbols = await getAiOwnedSymbols();

      const freshAiPositions = freshPositions.filter((p) =>
        freshAiOwnedSymbols.has(normalizeSymbol(p.symbol))
      );
      const refreshedPortfolioManager = calculateAiPortfolioManagerDecision(
  stock,
  account,
  aiPositions,
  regime
);

const tradeAmount = Number(
  refreshedPortfolioManager.recommendedTradeAmount || 0
);

engineState.aiDecisionHistory.unshift({
  type: "INSTITUTIONAL_PORTFOLIO_ALLOCATOR",
  symbol: stock.symbol,
  at: new Date().toISOString(),
  score: stock.score,
  tradeAmount,
  portfolioManager: refreshedPortfolioManager,
});

engineState.aiDecisionHistory = engineState.aiDecisionHistory.slice(0, 500);
saveEngineState("INSTITUTIONAL_PORTFOLIO_ALLOCATOR_DECISION");

      if (tradeAmount <= 0) {
        saveFailedOrder(
          "AUTO_BUY_FAILED",
          stock.symbol,
          "Bot budget used up or no cash available",
          {
            price: stock.current,
            score: stock.score,
            maxBotExposurePercent: CONFIG.maxBotExposurePercent,
          }
        );
        continue;
      }
const buyOrder = await placeMarketBuy(
  stock.symbol,
  tradeAmount,
  stock.score
);

saveRecentOrder("AUTO_BUY_INSTITUTIONAL_ALLOCATOR", stock.symbol, {
  price: stock.current,
  score: stock.score,
  confirmations: stock.confirmations || null,
  tradeAmount,
  maxBotExposurePercent: CONFIG.maxBotExposurePercent,
  portfolioManager: refreshedPortfolioManager,
  buyOrder,
});
    } catch (err) {
      saveFailedOrder("AUTO_BUY_FAILED", stock.symbol, err.message, {
        price: stock.current,
        score: stock.score,
      });
    }
  }
}
async function rotateWeakCryptoIfBetter(signals, positions) {
  if (!["live_crypto", "smart"].includes(TRADING_MODE)) return false;

  const cryptoPositions = positions.filter((p) =>
    normalizeSymbol(p.symbol).endsWith("USD")
  );

  if (cryptoPositions.length < CONFIG.maxOpenTrades) return false;

  const openSymbols = new Set(
    cryptoPositions.map((p) => normalizeSymbol(p.symbol))
  );

  const topCandidate = signals
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => Number(s.score || 0) >= 85)
    .filter((s) => !openSymbols.has(normalizeSymbol(s.symbol)))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

  if (!topCandidate) return false;

  const weakest = cryptoPositions.reduce((weak, pos) => {
    const weakProfit = Number(weak.unrealized_plpc || 0);
    const posProfit = Number(pos.unrealized_plpc || 0);
    return posProfit < weakProfit ? pos : weak;
  });

  const weakestSymbol = normalizeSymbol(weakest.symbol);
  const weakestQty = Number(weakest.qty);

  if (!weakestQty || weakestQty <= 0) return false;

  try {
    const sellOrder = await placeCryptoMarketSell(
      weakestSymbol,
      weakestQty,
      `CRYPTO_ROTATE_TO_${normalizeSymbol(topCandidate.symbol)}`
    );

    saveRecentOrder("CRYPTO_ROTATED_OUT", weakestSymbol, {
      replacementSymbol: topCandidate.symbol,
      replacementScore: topCandidate.score,
      weakestProfitPercent: Number(weakest.unrealized_plpc || 0) * 100,
      sellOrder,
    });

    delete engineState.highWaterMarks[weakestSymbol];

    setTimeout(async () => {
      try {
        const account = await getAccount();
        const cash = Number(account.cash || 0);
        const tradeAmount = Math.min(cash, 10);

        if (tradeAmount < 5) {
          saveFailedOrder(
            "CRYPTO_ROTATION_BUY_SKIPPED",
            topCandidate.symbol,
            "Not enough cash after rotation"
          );
          return;
        }

        const buyOrder = await placeCryptoMarketBuy(
          topCandidate.symbol,
          tradeAmount
        );

        saveRecentOrder("CRYPTO_ROTATED_IN", topCandidate.symbol, {
          score: topCandidate.score,
          tradeAmount,
          replacedSymbol: weakestSymbol,
          buyOrder,
        });
      } catch (err) {
        saveFailedOrder("CRYPTO_ROTATION_BUY_FAILED", topCandidate.symbol, err.message);
      }
    }, 2500);

    return true;
  } catch (err) {
    saveFailedOrder("CRYPTO_ROTATION_SELL_FAILED", weakestSymbol, err.message);
    return false;
  }
}
// ===== CRYPTO AUTO BUY START =====

async function autoBuyCryptoSignals(signals) {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) return;

  const account = await getAccount();
  const positions = await getPositions();
  const openSymbols = new Set(positions.map((p) => normalizeSymbol(p.symbol)));
  const cash = Number(account.cash || 0);
  const maxCryptoPositions = CONFIG.maxOpenTrades;

  const cryptoPositions = positions.filter((p) =>
    normalizeSymbol(p.symbol).endsWith("USD")
  );

  if (cryptoPositions.length >= maxCryptoPositions) {
    const rotated = await rotateWeakCryptoIfBetter(signals, positions);

    if (!rotated) {
      saveRecentOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", {
        reason: "Max crypto positions reached, no stronger rotation found",
        maxCryptoPositions,
      });
    }

    return;
  }

  const openSlots = maxCryptoPositions - cryptoPositions.length;
  const baseTradeAmount = getDynamicTradeAmount(account, cryptoPositions);

  const bestCandidateScore = Math.max(
    ...signals
      .filter((s) => s.qualifiedToBuy === true)
      .map((s) => Number(s.score || 0)),
    0
  );

  let scoreMultiplier = 0.5;

  if (bestCandidateScore >= 95) scoreMultiplier = 1;
  else if (bestCandidateScore >= 90) scoreMultiplier = 0.85;
  else if (bestCandidateScore >= 85) scoreMultiplier = 0.7;
  else if (bestCandidateScore >= 75) scoreMultiplier = 0.55;

  const tradeAmount = baseTradeAmount * scoreMultiplier;

  if (tradeAmount < 1) {
    saveFailedOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", "Not enough budget");
    return;
  }
  const buyCandidates = signals
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => Number(s.score || 0) >= 70)
    .filter((s) => {
      const sym = normalizeSymbol(s.symbol);
      const lastSold = engineState.lastSoldAt[sym] || 0;

      return !openSymbols.has(sym) && Date.now() - lastSold > 120000;
    })
    .slice(0, openSlots);

  for (const crypto of buyCandidates) {
    const symbol = normalizeSymbol(crypto.symbol);

    // 🧠 APPROVED CRYPTO LIST
    const allowedCryptoSymbols = new Set([
      "BTCUSD",
      "ETHUSD",
      "SOLUSD",
      "DOGEUSD",
      "ADAUSD",
      "AVAXUSD",
      "LINKUSD",
      "LTCUSD",
    ]);

    if (!allowedCryptoSymbols.has(symbol)) {
      saveRecentOrder("CRYPTO_SKIPPED_SYMBOL_FILTER", symbol, {
        message: "Skipped non-approved crypto pair",
      });
      continue;
    }

    // 🧠 TRADE MEMORY FILTER
    if (shouldSkipFromTradeMemory(symbol)) {
      saveRecentOrder("CRYPTO_SKIPPED_TRADE_MEMORY", symbol, {
        memory: engineState.tradeMemory?.[symbol],
      });
      continue;
    }
    try {
      const order = await placeCryptoMarketBuy(crypto.symbol, tradeAmount);

      saveRecentOrder("AUTO_CRYPTO_BUY", crypto.symbol, {
        price: crypto.current,
        tradeAmount,
        order,
      });
    } catch (err) {
      saveFailedOrder("AUTO_CRYPTO_BUY_FAILED", crypto.symbol, err.message);
    }
  }
}

// ===== CRYPTO AUTO BUY END =====


// 👇 THIS LINE MUST STAY BELOW

async function engineTick() {
  if (engineState.running) return;

  engineState.running = true;
  engineState.engineFreezeDetected = false;
  engineState.lastHeartbeatAt = new Date().toISOString();
  engineState.totalEngineTicks =
  (engineState.totalEngineTicks || 0) + 1;
  engineState.lastTickStartedAt = Date.now();
  engineState.lastError = null;
  engineState.cachedPositions = await getPositions();
  engineState.cachedAccount = await getAccount();
  engineState.lastSuccessfulCycleAt = new Date().toISOString();

  try {
    const { key, secret } = getAlpacaKeys();

    if (!key || !secret || !FINNHUB_API_KEY) {
      throw new Error("Missing API keys in environment variables");
    }

    const account = await getAccount();
    const clock = await getClock();
    const marketOpen = Boolean(clock.is_open);
    const effectiveMode = getEffectiveTradingMode(marketOpen);
    const todayKey = new Date().toISOString().slice(0, 10);

    if (engineState.lastTradingDayKey !== todayKey) {
      engineState.lastTradingDayKey = todayKey;
      engineState.stockTradingStoppedForDay = false;
      engineState.cryptoTradingStoppedForDay = false;

      saveRecentOrder("TRADING_FLAGS_RESET_FOR_NEW_DAY", "SYSTEM", {
        todayKey,
      });
    }
    engineState.effectiveMode = effectiveMode;
    engineState.marketOpen = marketOpen;
    if (engineState.lastMarketOpen === true && marketOpen === false) {
      engineState.marketClosedAt = Date.now();

      // Stock session ended, crypto session can start again
      engineState.cryptoTradingStoppedForDay = false;

      saveRecentOrder("MARKET_CLOSED_DETECTED", "MARKET", {
        marketClosedAt: new Date(engineState.marketClosedAt).toISOString(),
        cryptoTradingStoppedForDay: false,
      });
    }

    engineState.lastMarketOpen = marketOpen;

    console.log("SMART MODE:", {
      selected: TRADING_MODE,
      effective: effectiveMode,
      marketOpen,
    });


    const riskLocked = await checkDailyLossAndProfitLock(account, marketOpen);

    if (marketOpen) {
      await executePendingExits();
    }

    const tradingStoppedForDay =
      await flattenStocksAndCryptoBeforeMarketClose(clock);

    await autoCloseCryptoBeforeMarketOpen(clock);

    await autoExitPositions(marketOpen);

    const cryptoEnabled = effectiveMode === "live_crypto";

    if (cryptoEnabled) {
      await autoExitCryptoPositions();
    }

    let stockSignals = [];
    let cryptoSignals = [];

    if (effectiveMode === "live_crypto") {
      cryptoSignals = await scanCryptoMarket();
    }

    if (effectiveMode === "live_stock") {
      stockSignals = await scanMarket();
    }
const scanStartedAt = Date.now();

engineState.marketBreadth = {
  advancing: stockSignals.filter(
    (s) => Number(s.percentChange || 0) > 0
  ).length,

  declining: stockSignals.filter(
    (s) => Number(s.percentChange || 0) < 0
  ).length,
};

engineState.marketStressLevel =
  stockSignals.filter(
    (s) => Number(s.percentChange || 0) <= -10
  ).length;

engineState.marketMomentumScore =
  stockSignals.reduce(
    (sum, s) =>
      sum + Number(s.percentChange || 0),
    0
  ) / Math.max(1, stockSignals.length);

engineState.marketVolatility =
  stockSignals.reduce(
    (sum, s) =>
      sum + Math.abs(Number(s.percentChange || 0)),
    0
  ) / Math.max(1, stockSignals.length);

engineState.institutionalExposureMode =
  engineState.marketVolatility >= 12
    ? "DEFENSIVE"
    : engineState.marketMomentumScore >= 8
    ? "AGGRESSIVE"
    : "NORMAL";

    stockSignals.forEach((signal) => {
  signal.institutionalGrade =
    signal.score >= 95
      ? "ELITE"
      : signal.score >= 90
      ? "HIGH"
      : signal.score >= 85
      ? "GOOD"
      : "NORMAL";
});

const signals = [...stockSignals, ...cryptoSignals];

    engineState.marketRegime = detectMarketRegime(stockSignals);
    engineState.marketRegimeHistory.unshift({
  timestamp: new Date().toISOString(),
  regime: engineState.marketRegime,
});

engineState.marketRegimeHistory =
  engineState.marketRegimeHistory.slice(0, 200);
  signals.sort(
  (a, b) => Number(b.score || 0) - Number(a.score || 0)
);
    engineState.lastSignals = signals;
    engineState.lastSuccessfulCycleAt =
  new Date().toISOString();
  engineState.marketMomentumScore =
  stockSignals.reduce(
    (sum, s) =>
      sum + Number(s.percentChange || 0),
    0
  ) / Math.max(1, stockSignals.length);
  engineState.averageSignalScore =
  signals.reduce(
    (sum, s) => sum + Number(s.score || 0),
    0
  ) / Math.max(1, signals.length);
    engineState.lastStockSignals = stockSignals;
    engineState.lastCryptoSignals = cryptoSignals;
    engineState.lastScanAt = new Date().toISOString();
    engineState.signalHistory.unshift({
  timestamp: new Date().toISOString(),
  signalCount: signals.length,
  topSignals: signals.slice(0, 10),
  averageTopScore:
  signals.slice(0, 10).reduce(
    (sum, s) => sum + Number(s.score || 0),
    0
  ) / Math.max(1, signals.slice(0, 10).length),
});

engineState.signalHistory =
  engineState.signalHistory.slice(0, 200);
  engineState.aiDecisionHistory.unshift({
  timestamp: new Date().toISOString(),
  marketRegime: engineState.marketRegime,
  marketStressLevel:
    engineState.marketStressLevel,
  totalSignals: signals.length,
  stockSignals: stockSignals.length,
  cryptoSignals: cryptoSignals.length,
});

engineState.aiDecisionHistory =
  engineState.aiDecisionHistory.slice(0, 500);

  const sectorRotation = calculateAiSectorRotationEngine(stockSignals);

engineState.sectorRotationState = sectorRotation;

engineState.sectorRotationHistory.unshift(sectorRotation);
engineState.sectorRotationHistory =
  engineState.sectorRotationHistory.slice(0, 200);
 const analyticsPositions = Array.isArray(engineState.cachedPositions)
  ? engineState.cachedPositions
  : [];

const analyticsAiPositions = analyticsPositions.filter((position) => {
  const symbol = normalizeSymbol(position.symbol);

  if (!symbol) return false;

  if (
    Array.isArray(engineState.aiManagedSymbols) &&
    engineState.aiManagedSymbols.includes(symbol)
  ) {
    return true;
  }

  return String(position.asset_class || "").toLowerCase() === "us_equity";
});

const allSignalsForAnalytics =
  Array.isArray(stockSignals) && stockSignals.length > 0
    ? stockSignals
    : Array.isArray(cryptoSignals) && cryptoSignals.length > 0
    ? cryptoSignals
    : Array.isArray(engineState.lastSignals)
    ? engineState.lastSignals
    : [];
const updatedInstitutionalWatchlist =
  updateInstitutionalWatchlist(allSignalsForAnalytics);

engineState.institutionalWatchlist = updatedInstitutionalWatchlist;
const capitalRedistribution = calculateSmartCapitalRedistributionEngine(
  account,
  analyticsAiPositions,
  allSignalsForAnalytics,
  engineState.sectorRotationState
);

engineState.capitalRedistributionState = capitalRedistribution;

engineState.capitalRedistributionHistory.unshift(capitalRedistribution);
engineState.capitalRedistributionHistory =
  engineState.capitalRedistributionHistory.slice(0, 200);

const multiTimeframeAnalysis =
  calculateMultiTimeframeConfirmationEngine(allSignalsForAnalytics);

engineState.multiTimeframeState = multiTimeframeAnalysis;

engineState.multiTimeframeHistory.unshift(multiTimeframeAnalysis);
engineState.multiTimeframeHistory =
  engineState.multiTimeframeHistory.slice(0, 200);
const marketCrashProtection =
  calculateAiMarketCrashProtectionEngine(
    allSignalsForAnalytics,
    engineState.marketRegime,
    account
  );

engineState.marketCrashProtectionState =
  marketCrashProtection;

engineState.marketCrashProtectionHistory.unshift(
  marketCrashProtection
);

engineState.marketCrashProtectionHistory =
  engineState.marketCrashProtectionHistory.slice(0, 200);

if (marketCrashProtection.shouldBlockNewTrades) {
  autoTradingEnabled = false;
}
engineState.sectorStrengthHistory =
  engineState.sectorStrengthHistory.slice(0, 200);
  engineState.lastScanDurationMs =
  Date.now() - scanStartedAt;
  engineState.signalQualityHistory.unshift({
  timestamp: new Date().toISOString(),
  averageSignalScore:
    engineState.averageSignalScore,
  signalCount: signals.length,
});

engineState.signalQualityHistory =
  engineState.signalQualityHistory.slice(0, 200);
  engineState.marketBreadthHistory.unshift({
  timestamp: new Date().toISOString(),
  breadth: engineState.marketBreadth,
});

engineState.marketBreadthHistory =
  engineState.marketBreadthHistory.slice(0, 200);
  engineState.marketMomentumHistory.unshift({
  timestamp: new Date().toISOString(),
  score: engineState.marketMomentumScore,
});

engineState.marketMomentumHistory =
  engineState.marketMomentumHistory.slice(0, 200);
  engineState.marketVolatilityHistory.unshift({
  timestamp: new Date().toISOString(),
  volatility: engineState.marketVolatility,
});

engineState.marketVolatilityHistory =
  engineState.marketVolatilityHistory.slice(0, 200);
  engineState.institutionalExposureHistory.unshift({
  timestamp: new Date().toISOString(),
  mode: engineState.institutionalExposureMode,
  volatility: engineState.marketVolatility,
  momentum: engineState.marketMomentumScore,
  stress: engineState.marketStressLevel,
});

engineState.institutionalExposureHistory =
  engineState.institutionalExposureHistory.slice(0, 200);
  engineState.institutionalWatchlist =
  signals
    .filter((s) => Number(s.score || 0) >= 85)
    .slice(0, 25)
    .map((s) => ({
      symbol: s.symbol,
      score: s.score,
      price: s.current,
      percentChange: s.percentChange,
      institutionalGrade:
  s.institutionalGrade,
      updatedAt: new Date().toISOString(),
    }));
    engineState.analyticsSnapshots.unshift({
  timestamp: new Date().toISOString(),
  marketRegime: engineState.marketRegime,
  institutionalExposureMode:
    engineState.institutionalExposureMode,
  marketStressLevel:
    engineState.marketStressLevel,
  marketMomentumScore:
    engineState.marketMomentumScore,
  marketVolatility:
    engineState.marketVolatility,
  averageSignalScore:
    engineState.averageSignalScore,
  signalCount: signals.length,
  stockSignalCount: stockSignals.length,
  cryptoSignalCount: cryptoSignals.length,
});

engineState.analyticsSnapshots =
  engineState.analyticsSnapshots.slice(0, 300);
    saveEngineState("SCAN_COMPLETED");

       const marketStressLocked =
      engineState.marketStressLevel >= 25;

    const volatilityLocked =
      engineState.marketVolatility >= 18;

    if (
      autoTradingEnabled &&
      !engineState.dailyLossLocked &&
      !engineState.profitLocked &&
      !marketStressLocked &&
      !volatilityLocked &&
      !riskLocked
    ) {
      if (
        effectiveMode === "live_crypto" &&
        !tradingStoppedForDay &&
        !engineState.cryptoTradingStoppedForDay
      ) {
        await autoBuyCryptoSignals(cryptoSignals);
      }

      if (
        effectiveMode === "live_stock" &&
        marketOpen &&
        !tradingStoppedForDay &&
        !engineState.stockTradingStoppedForDay
      ) {
        await autoBuySignals(stockSignals);

        engineState.aiDecisionHistory.unshift({
          timestamp: new Date().toISOString(),
          type: "AUTO_BUY_EXECUTED",
          signalCount: stockSignals.length,
          tradingMode: TRADING_MODE,
          effectiveMode,
        });

        engineState.aiDecisionHistory =
          engineState.aiDecisionHistory.slice(0, 300);
      }
    }

    if (autoTradingEnabled && !marketOpen && TRADING_MODE !== "smart") {
      saveRecentOrder("BUY_SKIPPED_MARKET_CLOSED", "ALL", {
        message: "Market closed. Stock buys skipped.",
      });
    }
  } catch (err) {
    engineState.lastError = err.message;
    engineState.lastEngineStopReason = "ENGINE_ERROR";
    console.error("Engine error:", err.message);
  } finally {
    engineState.lastTickDurationMs =
      Date.now() - engineState.lastTickStartedAt;

    engineState.lastEngineStopReason = "ENGINE_TICK_COMPLETED";
    engineState.engineFreezeDetected = false;
    engineState.running = false;
  }
}

setInterval(() => {
  if (
    engineState.running &&
    engineState.lastTickStartedAt &&
    Date.now() - engineState.lastTickStartedAt > 1000 * 60 * 5
  ) {
    engineState.engineFreezeDetected = true;

    engineState.engineFreezeCount =
      (engineState.engineFreezeCount || 0) + 1;

    engineState.running = false;

    engineState.lastEngineStopReason =
      "ENGINE_FREEZE_RECOVERY";

    saveEngineState("ENGINE_FREEZE_RECOVERY");
  }
}, 30000);



app.get("/", (req, res) => {
  res.json({


    app: "SmartMoney Pro Backend",
    status: "online",
    autoTradingEnabled,
    config: CONFIG,
    freshness: getEngineFreshness(),
    marketStressLevel:
  engineState.marketStressLevel,
  apiHealth: engineState.apiHealth || {},
    engineState,
  });
});


app.get("/infra-status", (req, res) => {
  res.json({
    ok: true,
    phase: "13A",
    backendAuthority: true,
    tradingMode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
    files: {
      runtimeConfigFile: CONFIG_FILE,
      engineStateFile: ENGINE_STATE_FILE,
      engineStatePersisted: fs.existsSync(ENGINE_STATE_FILE),
      runtimeConfigPersisted: fs.existsSync(CONFIG_FILE),
    },
    locks: {
      buyingNow: Array.from(buyingNow),
      sellingNow: Array.from(sellingNow),
      engineRunning: engineState.running,
    },
    memory: {
      recentOrders: engineState.recentOrders?.length || 0,
      failedOrders: engineState.failedOrders?.length || 0,
      skippedSymbols: engineState.skippedSymbols?.length || 0,
      pendingExits: engineState.pendingExits?.length || 0,
      highWaterMarks: Object.keys(engineState.highWaterMarks || {}).length,
      tradeMemory: Object.keys(engineState.tradeMemory || {}).length,
      aiEntryScores: Object.keys(engineState.aiEntryScores || {}).length,
      runnerPositions: Object.keys(engineState.runnerPositions || {}).length,
      aiManagedSymbols: engineState.aiManagedSymbols?.length || 0,
    },
    lastScanAt: engineState.lastScanAt,
    freshness: getEngineFreshness(),
    lastError: engineState.lastError,
    savedAt: new Date().toISOString(),
  });
});

  app.get("/debug", async (req, res) => {
    try {
      const account = await getAccount();
      const clock = await getClock();

      const symbols = await getTopMovers();
      const maxSymbolsToScan = Number(process.env.MAX_SYMBOLS_TO_SCAN || 300);
      const limitedSymbols = symbols.slice(0, maxSymbolsToScan);

      const positions = await getPositions();
      const aiOwnedSymbols = await getAiOwnedSymbols();

      const aiPositions = positions.filter((p) =>
        aiOwnedSymbols.has(normalizeSymbol(p.symbol))
      );

      res.json({
        ok: true,
        accountStatus: account.status,
        marketOpen: clock.is_open,

        symbolsCount: symbols.length,
        maxSymbolsToScan,
        symbolsThatWouldScan: limitedSymbols.length,
        firstSymbols: limitedSymbols.slice(0, 30),

        lastSignalsCount: engineState.lastSignals.length,
        skippedSymbolsCount: engineState.skippedSymbols.length,
        recentSkippedSymbols: engineState.skippedSymbols.slice(0, 20),

        config: CONFIG,
        risk: {
          equity: Number(account.equity || 0),
          cash: Number(account.cash || 0),
          maxBotBudget:
            Number(account.equity || 0) * (CONFIG.maxBotExposurePercent / 100),
          currentBotExposure: getBotExposure(aiPositions),
          perTradeMax:
            (Number(account.equity || 0) *
              (CONFIG.maxBotExposurePercent / 100)) /
            CONFIG.maxOpenTrades,
        },
        engineState,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
        engineState,
      });
    }
  });

app.get("/health", async (req, res) => {
  try {
    const clock = await getClock().catch((err) => ({
      error: err.message,
    }));

    res.json({
      online: true,
      service: "SmartMoney Backend",
      mode: TRADING_MODE,
      autoTradingEnabled,

      env: {
        hasFinnhubKey: Boolean(process.env.FINNHUB_API_KEY),
        hasLiveAlpacaKey: Boolean(process.env.ALPACA_LIVE_KEY),
        hasLiveAlpacaSecret: Boolean(process.env.ALPACA_LIVE_SECRET),
      },

      engine: {
        running: engineState.running,
        lastScanAt: engineState.lastScanAt,
        lastHeartbeatAt: engineState.lastHeartbeatAt,
        uptimeSeconds: Math.floor(process.uptime()),
        lastTickDurationMs: engineState.lastTickDurationMs,
        lastScanDurationMs:
  engineState.lastScanDurationMs,
        lastTickStartedAt: engineState.lastTickStartedAt,
        engineFreezeDetected: engineState.engineFreezeDetected,
engineFreezeCount: engineState.engineFreezeCount,
        totalEngineTicks: engineState.totalEngineTicks,
        lastError: engineState.lastError,

        dailyLossLocked: engineState.dailyLossLocked,
        profitLocked: engineState.profitLocked,
      },

      clock,
      serverTime: Date.now(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      online: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

  app.get("/status", async (req, res) => {
    try {
      const account = await getAccount();
      const peaks = updateAccountPeaks(account);

      const clock = await getClock();
      const positions = await getPositions();
      const aiOwnedSymbols = await getAiOwnedSymbols();

      const aiPositions = positions.filter((p) =>
        aiOwnedSymbols.has(normalizeSymbol(p.symbol))
      );

      res.json({
        online: true,
        mode: TRADING_MODE,
        effectiveMode: engineState.effectiveMode,
        tradingModeLocked,
        autoTradingEnabled,
        config: CONFIG,
        account: {
          ...account,
          peakEquity: peaks.peakEquity,
          peakCash: peaks.peakCash,
        },
        clock,
        risk: {
          maxBotExposurePercent: CONFIG.maxBotExposurePercent,
          maxBotBudget:
            Number(account.equity || 0) * (CONFIG.maxBotExposurePercent / 100),
          currentBotExposure: getBotExposure(aiPositions),
          perTradeMax:
            (Number(account.equity || 0) *
              (CONFIG.maxBotExposurePercent / 100)) /
            CONFIG.maxOpenTrades,

          currentEquity: Number(account.equity || 0),
          currentCash: Number(account.cash || 0),
          peakEquity: peaks.peakEquity,
          peakCash: peaks.peakCash,
        },
        engineState,
      });
    } catch (err) {
      res.status(500).json({
        online: false,
        error: err.message,
        engineState,
      });
    }
  });

  app.get("/stock-quote/:symbol", async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.params.symbol);
      const q = await finnhubQuote(symbol);
      const asset = await getAsset(symbol).catch(() => null);

      if (!q || !q.current) {
        return res.status(404).json({
          ok: false,
          error: "No quote found",
          symbol,
        });
      }

      res.json({
        ok: true,
        stock: {
          symbol,
          current: q.current,
          price: q.current,
          previousClose: q.previousClose,
          changePercent: q.previousClose
            ? ((q.current - q.previousClose) / q.previousClose) * 100
            : 0,
          percentChange: q.percentChange,
          source: "manual_search",
          autoTradeAllowed: false,
          manuallyBuyable: true,
          fractionable: asset?.fractionable === true,
          assetClass: asset?.asset_class || "us_equity",
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });

  app.get("/signals", (req, res) => {
    res.json({
      lastScanAt: engineState.lastScanAt,
      signals: engineState.lastSignals,
      skippedSymbols: engineState.skippedSymbols,
    });
  });
  // ===== CRYPTO ROUTE START =====

  app.get("/crypto-signals", async (req, res) => {
    try {
      if (!["live_crypto", "smart"].includes(TRADING_MODE)) {
        return res.status(403).json({
          error: "Crypto signals are available in live_crypto or smart mode.",
          mode: TRADING_MODE,
        });
      }

      const signals = await scanCryptoMarket();

      res.json({
        mode: TRADING_MODE,
        liveOnly: true,
        signals,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }); app.get("/all-positions-test", async (req, res) => {
    try {
      const positions = await getPositions();

      res.json({
        ok: true,
        count: positions.length,
        positions,
        aiManagedSymbols: engineState.aiManagedSymbols,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });

  // ===== CRYPTO ROUTE END =====

  app.get("/positions", async (req, res) => {
    try {
      const positions = await getPositions();
      const aiOwnedSymbols = await getAiOwnedSymbols();

      const aiPositions = positions.filter((position) =>
        aiOwnedSymbols.has(normalizeSymbol(position.symbol))
      );

      res.json({
        positions: aiPositions,
        allAlpacaPositions: positions,
        highWaterMarks: engineState.highWaterMarks,
        aiEntryScores: engineState.aiEntryScores,
        runnerPositions: engineState.runnerPositions,
        currentBotExposure: getBotExposure(aiPositions),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/orders", async (req, res) => {
    try {
      const orders = await getOrders();

      const aiOrders = orders.filter(isAiOrder);

      const activeStatuses = new Set([
        "new",
        "accepted",
        "pending_new",
        "partially_filled",
        "pending_replace",
        "pending_cancel",
      ]);

      const closedStatuses = new Set([
        "filled",
        "canceled",
        "expired",
        "rejected",
        "replaced",
      ]);

      const activeOrders = aiOrders.filter((order) =>
        activeStatuses.has(String(order.status || "").toLowerCase())
      );

      const closedOrders = aiOrders.filter((order) =>
        closedStatuses.has(String(order.status || "").toLowerCase())
      );

      res.json({
        alpacaOrders: orders,
        aiAlpacaOrders: aiOrders,
        activeOrders,
        closedOrders,
        backendOrders: engineState.recentOrders,
        failedOrders: engineState.failedOrders,
        pendingExits: engineState.pendingExits,
        runnerPositions: engineState.runnerPositions,
        effectiveMode: engineState.effectiveMode,
        stockTradingStoppedForDay: engineState.stockTradingStoppedForDay,
        cryptoTradingStoppedForDay: engineState.cryptoTradingStoppedForDay,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/telemetry", async (req, res) => {
  res.json({
    engine: {
      running: engineState.running,
      marketOpen: engineState.marketOpen,
      lastScanAt: engineState.lastScanAt,
      lastHeartbeatAt: engineState.lastHeartbeatAt,
      lastSuccessfulCycleAt:
        engineState.lastSuccessfulCycleAt,
      lastTickDurationMs:
        engineState.lastTickDurationMs,
      totalEngineTicks:
        engineState.totalEngineTicks,
      engineFreezeDetected:
        engineState.engineFreezeDetected,
      engineFreezeCount:
        engineState.engineFreezeCount,
      lastEngineStopReason:
        engineState.lastEngineStopReason,
    },

    freshness: getEngineFreshness(),

    marketRegime: engineState.marketRegime,
    marketStressLevel:
  engineState.marketStressLevel,
  averageSignalScore:
  engineState.averageSignalScore,
  confidenceWeightedMode:
  engineState.averageSignalScore >= 90,
  marketBreadth:
  engineState.marketBreadth,
  marketMomentumScore:
  engineState.marketMomentumScore,
  marketVolatility:
  engineState.marketVolatility,
  institutionalExposureMode:
  engineState.institutionalExposureMode,
institutionalWatchlist:
  engineState.institutionalWatchlist,
  analyticsSnapshots:
  engineState.analyticsSnapshots?.slice(0, 20) || [],
  apiHealth: engineState.apiHealth || {},
    recentSignals:

      engineState.signalHistory?.slice(0, 20) || [],
      activeCooldowns:
  Object.keys(engineState.symbolCooldowns || {}),

    recentRegimes:
      engineState.marketRegimeHistory?.slice(0, 20) || [],
  });
});
  app.post("/scan-now", async (req, res) => {
    await engineTick();

    res.json({
      message: "Scan completed",
      autoTradingEnabled,
      engineState,
    });
  });

  app.post("/auto-trading/on", (req, res) => {
    if (engineState.dailyLossLocked) {
      return res.status(403).json({
        message: "Auto trading locked because daily loss limit was reached",
      });
    }

    if (engineState.profitLocked) {
      return res.status(403).json({
        message: "Auto trading locked because profit lock was hit",
      });
    }

    autoTradingEnabled = true;
    saveEngineState("AUTO_TRADING_ENABLED");

    res.json({
      message: "Auto trading enabled",
      autoTradingEnabled,
    });
  });
  app.get("/config", (req, res) => {
    res.json({
      message: "Current remote config",
      config: CONFIG,
    });
  });


  app.post("/config", (req, res) => {
    const allowedConfigKeys = [
      "minStockPrice",
      "maxStockPrice",
      "minScoreToBuy",
      "maxBotExposurePercent",
      "stopLossPercent",
      "trailingStopPercent",
      "takeProfitPercent",
      "maxOpenTrades",
      "runnerTriggerPercent",
      "runnerTrailingStopPercent",
      "dailyLossLimitPercent",
      "profitLockTriggerPercent",
      "profitLockProtectPercent",
      "moversTop",
      "minVolume",
      "maxPercentChange",
      "maxSignalsToReturn",
      "topAutoTradeCandidates",
      "enableMarketRegimeEngine",
      "aggressiveBullishExposureMultiplier",
      "cautiousBullishExposureMultiplier",
      "defensiveExposureMultiplier",
      "panicExposureMultiplier",
      "enableAdvancedFilters",
      "minVolumeSpikeRatio",
      "minCloseNearHighPercent",
      "fakeBreakoutMaxHighPullbackPercent",
      "maxGapUpPercent",
      "requireAboveVwap",
      "enableNewsRiskFilter",
      "newsLookbackDays"
    ];

    for (const key of allowedConfigKeys) {
      if (req.body[key] === undefined) continue;

      if (typeof CONFIG[key] === "boolean") {
        CONFIG[key] = Boolean(req.body[key]);
      } else {
        const value = Number(req.body[key]);

        if (!Number.isFinite(value)) {
          return res.status(400).json({
            error: `Invalid number for ${key}`,
            received: req.body[key],
          });
        }

        CONFIG[key] = value;
      }
    }
  saveRuntimeConfig({
    ...CONFIG,
    tradingMode: TRADING_MODE,
    tradingModeLocked,
  });
    res.json({
      
      message: "Remote config updated",
      config: CONFIG,
    });
  });
  app.post("/mode", (req, res) => {
    const { mode } = req.body;

    const validModes = ["smart", "live_stock", "live_crypto"];
    if (tradingModeLocked) {
      return res.status(403).json({
        error: "Trading mode is locked",
        mode: TRADING_MODE,
        message: "Unlock trading mode before changing it.",
      });
    }

    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode",
        validModes,
      });
    }

    TRADING_MODE = mode;
      saveRuntimeConfig({
    tradingMode: TRADING_MODE,
    tradingModeLocked,
  });

  saveEngineState("TRADING_MODE_CHANGED");
    saveRuntimeConfig({ tradingMode: TRADING_MODE });

    console.log("MODE SWITCHED:", TRADING_MODE);
    res.json({
      message: "Trading mode updated",
      mode: TRADING_MODE,
    });
  });

  app.post("/mode-lock/on", (req, res) => {
    tradingModeLocked = true;
    saveRuntimeConfig({ tradingModeLocked });

    res.json({
      message: "Trading mode locked",
      mode: TRADING_MODE,
      tradingModeLocked,
    });
  });

  app.post("/mode-lock/off", (req, res) => {
    tradingModeLocked = false;
    saveRuntimeConfig({ tradingModeLocked });

    res.json({
      message: "Trading mode unlocked",
      mode: TRADING_MODE,
      tradingModeLocked,
    });
  });

  app.post("/manual-buy-stock", async (req, res) => {
    try {
      const { symbol, dollars, shares, buyMode } = req.body;

      const cleanSymbol = normalizeSymbol(symbol);
      const amount = Number(dollars);
      const shareAmount = Number(shares || 0);
      const mode = String(buyMode || "dollars");
      const asset = await getAsset(cleanSymbol);
      const fractionable = asset?.fractionable === true;

      if (!cleanSymbol) throw new Error("Missing symbol");
      if (!amount || amount < 1) throw new Error("Invalid dollar amount");

      const orderBody = {
        symbol: cleanSymbol,
        side: "buy",
        type: "market",
        time_in_force: "day",
        client_order_id: `${AI_ORDER_PREFIX}_MANUAL_BUY_${cleanSymbol}_${Date.now()}`,
      };

      if (mode === "shares") {
        if (!shareAmount || shareAmount <= 0) {
          throw new Error("Invalid share amount");
        }

        orderBody.qty = fractionable
          ? String(shareAmount)
          : String(Math.floor(shareAmount));
      } else {
        if (!amount || amount < 1) {
          throw new Error("Invalid dollar amount");
        }

        if (fractionable) {
          orderBody.notional = Number(amount.toFixed(2));
        } else {
          const q = await finnhubQuote(cleanSymbol);
          const estimatedShares = Math.floor(amount / Number(q.current || 0));

          if (!estimatedShares || estimatedShares < 1) {
            throw new Error(
              `${cleanSymbol} is not fractionable. Enter enough dollars for at least 1 whole share or use share mode.`
            );
          }

          orderBody.qty = String(estimatedShares);
        }
      }

      const order = await alpacaTradingRequest("/v2/orders", {
        method: "POST",
        body: JSON.stringify(orderBody),
      });

      console.log("MANUAL BUY ORDER:", order);

      if (!order || !order.id) {
        return res.json({
          ok: false,
          error: "Order not created",
        });
      }

      markAiManagedSymbol(cleanSymbol);

      return res.json({
        ok: true,
        message: `${cleanSymbol} manual buy placed. Bot can manage exit.`,
        symbol: cleanSymbol,
        dollars: amount,
        aiManagedSymbols: engineState.aiManagedSymbols,
        order,
      });

      // LINE AFTER
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });

  app.post("/close-position", async (req, res) => {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }

    try {
      const normalizedSymbol = normalizeSymbol(symbol);
      const result = await closePosition(normalizedSymbol);

      saveRecentOrder("MANUAL_CLOSE", normalizedSymbol, {
        result,
      });
      engineState.symbolCooldowns[normalizedSymbol] =
       new Date().toISOString();
      delete engineState.highWaterMarks[normalizedSymbol];
      delete engineState.aiEntryScores[normalizedSymbol];
      delete engineState.runnerPositions[normalizedSymbol];

      res.json({
        message: `Close position submitted for ${normalizedSymbol}`,
        result,
      });
    } catch (err) {
      saveFailedOrder("MANUAL_CLOSE_FAILED", symbol, err.message);

      res.status(500).json({ error: err.message });
    }
  });

  app.post("/reset-daily-lock", (req, res) => {
    engineState.dailyLossLocked = false;
    engineState.profitLocked = false;
    engineState.dailyStartEquity = null;
    engineState.dailyPeakEquity = null;
    engineState.profitLockFloorEquity = null;
    engineState.dailyDateKey = null;

saveRecentOrder("MANUAL_DAILY_LOCK_RESET", "ACCOUNT", {
  resetAt: new Date().toISOString(),
});
    saveEngineState("DAILY_PROFIT_LOCK_RESET");

    res.json({
      message: "Daily/profit lock reset",
      engineState,
    });
  });

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`SmartMoney Pro backend running on port ${PORT}`);
    console.log(`Auto trading enabled: ${autoTradingEnabled}`);

    console.log("Advanced filters config:", {
      enableAdvancedFilters: CONFIG.enableAdvancedFilters,
      minVolumeSpikeRatio: CONFIG.minVolumeSpikeRatio,
      minCloseNearHighPercent: CONFIG.minCloseNearHighPercent,
      requireAboveVwap: CONFIG.requireAboveVwap,
      enableNewsRiskFilter: CONFIG.enableNewsRiskFilter,
    });

    console.log("Runner strategy config:", {
      runnerTriggerPercent: CONFIG.runnerTriggerPercent,
      runnerTrailingStopPercent: CONFIG.runnerTrailingStopPercent,
      takeProfitPercent: CONFIG.takeProfitPercent,
      stopLossPercent: CONFIG.stopLossPercent,
      trailingStopPercent: CONFIG.trailingStopPercent,
    });

    console.log("Running first SmartMoney Pro scan on startup...");
    if (
  engineState.running ||
  engineState.engineFreezeDetected
) {
  return;
}
    await engineTick();
  });
