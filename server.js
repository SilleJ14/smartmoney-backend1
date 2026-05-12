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

equityCurveState:
  engineState.equityCurveState || null,

drawdownRecoveryState:
  engineState.drawdownRecoveryState || null,

adaptiveRiskState:
  engineState.adaptiveRiskState || null,
capitalRedistributionHistory:
  (engineState.capitalRedistributionHistory || []).slice(0, 200),
  capitalCompoundingState:
  engineState.capitalCompoundingState || null,

capitalCompoundingHistory:
  (engineState.capitalCompoundingHistory || []).slice(0, 200),

  multiTimeframeState:
  engineState.multiTimeframeState || null,
multiTimeframeHistory:
  (engineState.multiTimeframeHistory || []).slice(0, 200),

statisticalMemoryState:
  engineState.statisticalMemoryState || {
    updatedAt: null,
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  },

probabilityReinforcementState:
  engineState.probabilityReinforcementState || {
    updatedAt: null,
    setupTrust: {},
  },

probabilityReinforcementHistory:
  (engineState.probabilityReinforcementHistory || []).slice(0, 200),

  technicalIntelligenceState:
  engineState.technicalIntelligenceState || null,

technicalIntelligenceHistory:
  (engineState.technicalIntelligenceHistory || []).slice(0, 200),

  portfolioOptimizationState:
  engineState.portfolioOptimizationState || null,

portfolioOptimizationHistory:
  (engineState.portfolioOptimizationHistory || []).slice(0, 200),

earningsIntelligenceState:
  engineState.earningsIntelligenceState || null,

earningsIntelligenceHistory:
  (engineState.earningsIntelligenceHistory || []).slice(0, 200),

competitiveAdvantageState:
  engineState.competitiveAdvantageState || null,

competitiveAdvantageHistory:
  (engineState.competitiveAdvantageHistory || []).slice(0, 200),

dividendCompoundingState:
  engineState.dividendCompoundingState || null,

dividendCompoundingHistory:
  (engineState.dividendCompoundingHistory || []).slice(0, 200),

dcfValuationState:
  engineState.dcfValuationState || null,

dcfValuationHistory:
  (engineState.dcfValuationHistory || []).slice(0, 200),

institutionalOrchestratorState:
  engineState.institutionalOrchestratorState || null,


institutionalOrchestratorHistory:
  (engineState.institutionalOrchestratorHistory || []).slice(0, 200),

macroRiskState:
  engineState.macroRiskState || null,

autonomousTradingSystemState:
  engineState.autonomousTradingSystemState || null,

autonomousTradingSystemHistory:
  (engineState.autonomousTradingSystemHistory || []).slice(0, 200),  

executionIntelligenceState:
  engineState.executionIntelligenceState || null,

executionIntelligenceHistory:
  (engineState.executionIntelligenceHistory || []).slice(0, 200),  

reinforcementWeightState:
  engineState.reinforcementWeightState || null,

reinforcementWeightHistory:
  (engineState.reinforcementWeightHistory || []).slice(0, 200),  

selfOptimizationState:
  engineState.selfOptimizationState || null,

selfOptimizationHistory:
  (engineState.selfOptimizationHistory || []).slice(0, 200),  

marketCycleIntelligenceState:
  engineState.marketCycleIntelligenceState || null,

marketCycleIntelligenceHistory:
  (engineState.marketCycleIntelligenceHistory || []).slice(0, 200),  

liquidityIntelligenceState:
  engineState.liquidityIntelligenceState || null,

liquidityIntelligenceHistory:
  (engineState.liquidityIntelligenceHistory || []).slice(0, 200),

correlationIntelligenceState:
  engineState.correlationIntelligenceState || null,

correlationIntelligenceHistory:
  (engineState.correlationIntelligenceHistory || []).slice(0, 200),  

  portfolioGovernorState:
  engineState.portfolioGovernorState || null,

portfolioGovernorHistory:
  (engineState.portfolioGovernorHistory || []).slice(0, 200),

macroRiskHistory:
  (engineState.macroRiskHistory || []).slice(0, 200),

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
  selfHealingScanState:
  engineState.selfHealingScanState || null,

selfHealingScanHistory:
  (engineState.selfHealingScanHistory || []).slice(0, 200),

  liveAiPerformanceState:
  engineState.liveAiPerformanceState || null,
  tradeJournalState:
  engineState.tradeJournalState || {},

tradeJournalOpenEntries:
  engineState.tradeJournalOpenEntries || {},

tradeJournalHistory:
  (engineState.tradeJournalHistory || []).slice(
    0,
    100
  ),

strategyPerformanceState:
  engineState.strategyPerformanceState || {},

regimePerformanceState:
  engineState.regimePerformanceState || {},

sectorPerformanceState:
  engineState.sectorPerformanceState || {},

confirmationPerformanceState:
  engineState.confirmationPerformanceState || {},

liveAiPerformanceHistory:
  (engineState.liveAiPerformanceHistory || []).slice(0, 200),
scanFailureCount:
  engineState.scanFailureCount || 0,

lastScanRecoveryAt:
  engineState.lastScanRecoveryAt || null,
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
phase20AutonomousOrchestrationState:
  engineState.phase20AutonomousOrchestrationState || null,

phase20AutonomousOrchestrationHistory:
  (engineState.phase20AutonomousOrchestrationHistory || []).slice(0, 200),

crossEngineMemoryState:
  engineState.crossEngineMemoryState || null,

crossEngineMemoryHistory:
  (engineState.crossEngineMemoryHistory || []).slice(0, 200),

adaptiveExecutionTimingState:
  engineState.adaptiveExecutionTimingState || null,

adaptiveExecutionTimingHistory:
  (engineState.adaptiveExecutionTimingHistory || []).slice(0, 200),

phase21AutonomousBrainState:
  engineState.phase21AutonomousBrainState || null,

phase21AutonomousBrainHistory:
  (engineState.phase21AutonomousBrainHistory || []).slice(0, 200),
      pendingExits: engineState.pendingExits || [],
    };

    fs.writeFileSync(ENGINE_STATE_FILE, JSON.stringify(safeState, null, 2));
    return safeState;
  } catch (err) {
    console.error("Could not save engine-state.json:", err.message);
    return null;
  }
}

let runtimeConfig = loadRuntimeConfig();
const persistedEngineState = loadPersistedEngineState();


// 🔥 Trading Mode (PERSISTED)
let TRADING_MODE =
  runtimeConfig.tradingMode || "live_stock";

let tradingModeLocked =
  runtimeConfig.tradingModeLocked ?? false;

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

let autoTradingEnabled =
  runtimeConfig.autoTradingEnabled ?? true;

const AI_ORDER_PREFIX = "SM_AI";

const CONFIG = {
  maxOpenTrades: Number(process.env.MAX_OPEN_TRADES || 8),
  maxStockOpenTrades: Number(process.env.MAX_STOCK_OPEN_TRADES || 5),
  maxCryptoOpenTrades: Number(process.env.MAX_CRYPTO_OPEN_TRADES || 3),

  minStockPrice: Number(process.env.MIN_STOCK_PRICE || 1),
  maxStockPrice: Number(process.env.MAX_STOCK_PRICE || 0),

  minScoreToBuy: Number(process.env.MIN_SCORE_TO_BUY || 65),
  replaceWeakestMinScoreGap: Number(process.env.REPLACE_SCORE_GAP || 5),

  maxBotExposurePercent: Number(
    process.env.MAX_BOT_EXPOSURE_PERCENT || 6
  ),

  takeProfitPercent: Number(
    process.env.TAKE_PROFIT_PERCENT || 8
  ),

  stopLossPercent: Number(
    process.env.STOP_LOSS_PERCENT || 2
  ),

  trailingStopPercent: Number(
    process.env.TRAILING_STOP_PERCENT || 2
  ),

  runnerTriggerPercent: Number(
    process.env.RUNNER_TRIGGER_PERCENT || 6
  ),

  runnerTrailingStopPercent: Number(
    process.env.RUNNER_TRAILING_STOP_PERCENT || 3
  ),

  dailyLossLimitPercent: Number(
    process.env.DAILY_LOSS_LIMIT_PERCENT || 2
  ),

  profitLockTriggerPercent: Number(
    process.env.PROFIT_LOCK_TRIGGER_PERCENT || 2
  ),

  profitLockProtectPercent: Number(
    process.env.PROFIT_LOCK_PROTECT_PERCENT || 50
  ),

  moversTop: Number(process.env.MOVERS_TOP || 50),

  minVolume: Number(process.env.MIN_VOLUME || 4000),

  minScanVolume: Number(process.env.MIN_SCAN_VOLUME || 4000),

  maxPercentChange: Number(
    process.env.MAX_PERCENT_CHANGE || 80
  ),

  maxSignalsToReturn: Number(
    process.env.MAX_SIGNALS_TO_RETURN || 75
  ),

  topAutoTradeCandidates: Number(
    process.env.TOP_AUTO_TRADE_CANDIDATES || 5
  ),

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
    process.env.PANIC_EXPOSURE_MULTIPLIER || 0.15
  ),

  enableAdvancedFilters:
    process.env.ENABLE_ADVANCED_FILTERS !== "false",

  minVolumeSpikeRatio: Number(
    process.env.MIN_VOLUME_SPIKE_RATIO || 0.13
  ),

  minCloseNearHighPercent: Number(
    process.env.MIN_CLOSE_NEAR_HIGH_PERCENT || 20
  ),

  fakeBreakoutMaxHighPullbackPercent: Number(
    process.env.FAKE_BREAKOUT_MAX_HIGH_PULLBACK_PERCENT || 0.5
  ),

  maxGapUpPercent: Number(
    process.env.MAX_GAP_UP_PERCENT || 30
  ),

  requireAboveVwap:
    process.env.REQUIRE_ABOVE_VWAP === "true",

  enableNewsRiskFilter:
    process.env.ENABLE_NEWS_RISK_FILTER === "true",

  newsLookbackDays: Number(
    process.env.NEWS_LOOKBACK_DAYS || 3
  ),

  ...runtimeConfig,
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
  lastRotationDateKey: null,
  rotationCountToday: 0,
  maxRotationsPerDay: 2,
  peaksByMode: {},

  cachedPositions: [],
  cachedAccount: null,

  aiManagedSymbols: [], 
  institutionalWatchlist: [],
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
capitalCompoundingState: null,
capitalCompoundingHistory: [],
equityCurveState: null,
drawdownRecoveryState: null,
adaptiveRiskState: null,
multiTimeframeState: null,
multiTimeframeHistory: [],
statisticalEdgeState: null,
probabilityReinforcementState: {
  updatedAt: null,
  setupTrust: {},
},
probabilityReinforcementHistory: [],
statisticalEdgeHistory: [],
technicalIntelligenceState: null,
technicalIntelligenceHistory: [],
portfolioOptimizationState: null,
portfolioOptimizationHistory: [],
earningsIntelligenceState: null,
earningsIntelligenceHistory: [],
competitiveAdvantageState: null,
competitiveAdvantageHistory: [],
dividendCompoundingState: null,
dividendCompoundingHistory: [],
dcfValuationState: null,
dcfValuationHistory: [],
institutionalOrchestratorState: null,
institutionalOrchestratorHistory: [],
autonomousTradingSystemState: null,
autonomousTradingSystemHistory: [],
phase20AutonomousOrchestrationState: null,
phase20AutonomousOrchestrationHistory: [],
crossEngineMemoryState: null,
crossEngineMemoryHistory: [],
adaptiveExecutionTimingState: null,
adaptiveExecutionTimingHistory: [],
phase21AutonomousBrainState: null,
phase21AutonomousBrainHistory: [],
executionIntelligenceState: null,
executionIntelligenceHistory: [],
reinforcementWeightState: null,
reinforcementWeightHistory: [],
selfOptimizationState: null,
selfOptimizationHistory: [],
marketCycleIntelligenceState: null,
marketCycleIntelligenceHistory: [],
liquidityIntelligenceState: null,
liquidityIntelligenceHistory: [],
correlationIntelligenceState: null,
correlationIntelligenceHistory: [],
portfolioGovernorState: null,
portfolioGovernorHistory: [],
macroRiskState: null,
macroRiskHistory: [],
signalQualityHistory: [],
marketBreadthHistory: [],
marketMomentumHistory: [],
marketVolatilityHistory: [],
institutionalExposureHistory: [],
marketCrashProtectionState: null,
marketCrashProtectionHistory: [],
selfHealingScanState: null,
selfHealingScanHistory: [],
liveAiPerformanceState: null,
liveAiPerformanceHistory: [],
scanFailureCount: 0,
lastScanRecoveryAt: null,
aiDecisionHistory: [],
tradeJournalState: {
  totalClosedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  breakevenTrades: 0,
  totalProfitPercent: 0,
  averageProfitPercent: 0,
  winRate: 0,
  bestTrade: null,
  worstTrade: null,
  lastUpdated: null,
},

tradeJournalHistory: [],
tradeJournalOpenEntries: {},

strategyPerformanceState: {},
regimePerformanceState: {},
sectorPerformanceState: {},
confirmationPerformanceState: {},
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

function ensureTradeJournalState() {
  if (!engineState.tradeJournalState) {
    engineState.tradeJournalState = {
      totalClosedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      totalProfitPercent: 0,
      averageProfitPercent: 0,
      winRate: 0,
      bestTrade: null,
      worstTrade: null,
      lastUpdated: null,
    };
  }

  if (!engineState.tradeJournalHistory) {
    engineState.tradeJournalHistory = [];
  }

  if (!engineState.tradeJournalOpenEntries) {
    engineState.tradeJournalOpenEntries = {};
  }

  if (!engineState.strategyPerformanceState) {
    engineState.strategyPerformanceState = {};
  }

  if (!engineState.regimePerformanceState) {
    engineState.regimePerformanceState = {};
  }

  if (!engineState.sectorPerformanceState) {
    engineState.sectorPerformanceState = {};
  }

  if (!engineState.confirmationPerformanceState) {
    engineState.confirmationPerformanceState = {};
  }
}

function journalTradeEntry(symbol, entry = {}) {
  ensureTradeJournalState();

  const cleanSymbol = normalizeSymbol(symbol);

  if (!cleanSymbol) return;

  engineState.tradeJournalOpenEntries[cleanSymbol] = {
    symbol: cleanSymbol,
    entryType: entry.entryType || "AI_ENTRY",
    assetClass: entry.assetClass || "stock",
    entryPrice: Number(entry.entryPrice || 0),
    score: Number(entry.score || 0),
    strategy: entry.strategy || "institutional_momentum",
    sector: entry.sector || "General Market",
    marketRegime:
      entry.marketRegime ||
      engineState.marketRegime?.state ||
      "unknown",
    confirmations: entry.confirmations || {},
    portfolioManager: entry.portfolioManager || null,
    tradeAmount: Number(entry.tradeAmount || 0),
    enteredAt: new Date().toISOString(),
  };

  saveEngineState("TRADE_JOURNAL_ENTRY");
}

function journalTradeExit(symbol, exit = {}) {
  ensureTradeJournalState();

  const cleanSymbol = normalizeSymbol(symbol);

  if (!cleanSymbol) return;

  const entry =
    engineState.tradeJournalOpenEntries[cleanSymbol] || {};

  const profitPercent = Number(exit.profitPercent || 0);

  const closedTrade = {
    symbol: cleanSymbol,
    assetClass: exit.assetClass || entry.assetClass || "stock",
    entryType: entry.entryType || "AI_ENTRY",
    exitType: exit.exitType || "AI_EXIT",
    strategy: entry.strategy || exit.strategy || "institutional_momentum",
    sector: entry.sector || exit.sector || "General Market",
    marketRegime:
      entry.marketRegime ||
      exit.marketRegime ||
      engineState.marketRegime?.state ||
      "unknown",
    entryPrice: Number(entry.entryPrice || 0),
    exitPrice: Number(exit.exitPrice || 0),
    score: Number(entry.score || exit.score || 0),
    tradeAmount: Number(entry.tradeAmount || 0),
    profitPercent,
    exitReason: exit.exitReason || "UNKNOWN_EXIT",
    confirmations: entry.confirmations || {},
    portfolioManager: entry.portfolioManager || null,
    enteredAt: entry.enteredAt || null,
    exitedAt: new Date().toISOString(),
  };

if (!engineState.statisticalMemoryState) {
  engineState.statisticalMemoryState = {
    updatedAt: new Date().toISOString(),
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  };
}

const setupType = classifyInstitutionalSetup({
  symbol: cleanSymbol,
  score: closedTrade.score,
  assetClass: closedTrade.assetClass,
  marketRegime: closedTrade.marketRegime,
  confirmations: closedTrade.confirmations,
  portfolioManager: closedTrade.portfolioManager,
});

engineState.statisticalMemoryState.setupHistory.unshift({
  timestamp: new Date().toISOString(),
  symbol: cleanSymbol,
  setupType,
  profitPercent,
  score: closedTrade.score,
  assetClass: closedTrade.assetClass,
  marketRegime: closedTrade.marketRegime,
  exitReason: closedTrade.exitReason,
});

engineState.statisticalMemoryState.setupHistory =
  engineState.statisticalMemoryState.setupHistory.slice(0, 500);

engineState.statisticalMemoryState.updatedAt =
  new Date().toISOString();

  engineState.tradeJournalHistory.unshift(closedTrade);
  engineState.tradeJournalHistory =
    engineState.tradeJournalHistory.slice(0, 500);

  engineState.tradeJournalState.totalClosedTrades += 1;

  if (profitPercent > 0) {
    engineState.tradeJournalState.winningTrades += 1;
  } else if (profitPercent < 0) {
    engineState.tradeJournalState.losingTrades += 1;
  } else {
    engineState.tradeJournalState.breakevenTrades += 1;
  }

  engineState.tradeJournalState.totalProfitPercent =
    Number(engineState.tradeJournalState.totalProfitPercent || 0) +
    profitPercent;

  engineState.tradeJournalState.averageProfitPercent =
    Number(
      (
        engineState.tradeJournalState.totalProfitPercent /
        Math.max(1, engineState.tradeJournalState.totalClosedTrades)
      ).toFixed(2)
    );

  engineState.tradeJournalState.winRate =
    Number(
      (
        (engineState.tradeJournalState.winningTrades /
          Math.max(1, engineState.tradeJournalState.totalClosedTrades)) *
        100
      ).toFixed(2)
    );

  if (
    !engineState.tradeJournalState.bestTrade ||
    profitPercent >
      Number(engineState.tradeJournalState.bestTrade.profitPercent || 0)
  ) {
    engineState.tradeJournalState.bestTrade = closedTrade;
  }

  if (
    !engineState.tradeJournalState.worstTrade ||
    profitPercent <
      Number(engineState.tradeJournalState.worstTrade.profitPercent || 0)
  ) {
    engineState.tradeJournalState.worstTrade = closedTrade;
  }

  engineState.tradeJournalState.lastUpdated =
    new Date().toISOString();

  delete engineState.tradeJournalOpenEntries[cleanSymbol];

  saveEngineState("TRADE_JOURNAL_EXIT");
}

function canRunSwingSafeRotation(position = {}) {
  const todayKey = getTodayKeyET();

  if (engineState.lastRotationDateKey !== todayKey) {
    engineState.lastRotationDateKey = todayKey;
    engineState.rotationCountToday = 0;
  }

  if (Number(engineState.rotationCountToday || 0) >= Number(engineState.maxRotationsPerDay || 1)) {
    return {
      allowed: false,
      reason: "Daily rotation limit reached",
    };
  }

  const profitPercent = Number(position.unrealized_plpc || 0) * 100;

  if (profitPercent > -4) {
    return {
      allowed: false,
      reason: "Position is not weak enough for swing-safe rotation",
    };
  }

  return {
    allowed: true,
    reason: "Swing-safe rotation allowed",
  };
}

function markSwingSafeRotationUsed(symbol, replacementSymbol) {
  engineState.lastRotationDateKey = getTodayKeyET();
  engineState.rotationCountToday =
    Number(engineState.rotationCountToday || 0) + 1;

  saveRecentOrder("SWING_SAFE_ROTATION_USED", symbol, {
    replacementSymbol,
    rotationCountToday: engineState.rotationCountToday,
    maxRotationsPerDay: engineState.maxRotationsPerDay,
  });

  saveEngineState("SWING_SAFE_ROTATION_USED");
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

  const liquidityTier =
    volume >= 1000000
      ? "Institutional Liquidity"
      : volume >= 250000
      ? "Strong Liquidity"
      : volume >= 25000
      ? "Moderate Liquidity"
      : "Thin Liquidity";

  const volatilityTier =
    Math.abs(percentChange) >= 40
      ? "Extreme Volatility"
      : Math.abs(percentChange) >= 20
      ? "High Volatility"
      : Math.abs(percentChange) >= 5
      ? "Active Momentum"
      : "Normal Volatility";

  let estimatedSector = "General Market";

  if (price < 5 || liquidityTier === "Thin Liquidity") {
    estimatedSector = "Speculative Small Cap";
  } else if (
    percentChange >= 5 &&
    liquidityTier !== "Thin Liquidity"
  ) {
    estimatedSector = "Momentum Leadership";
  } else if (
    Math.abs(percentChange) <= 2 &&
    liquidityTier === "Institutional Liquidity"
  ) {
    estimatedSector = "Large Cap Defensive";
  }

  const sectorMomentumScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 20 ? 15 : 0) -
      (percentChange > 40 ? 20 : 0) +
      (confirmations.closeNearHigh ? 10 : 0)
  );

  const sectorRiskScore = clampScore(
    75 -
      (estimatedSector === "Speculative Small Cap" ? 25 : 0) -
      (volatilityTier === "Extreme Volatility" ? 20 : 0) -
      (confirmations.fakeBreakout ? 30 : 0) -
      (confirmations.newsRisk ? 25 : 0) -
      (volume < 25000 ? 10 : 0)
  );

  const sectorLiquidityScore = clampScore(
    40 +
      (volume >= 1000000
        ? 35
        : volume >= 250000
        ? 25
        : volume >= 25000
        ? 15
        : -10) +
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
    symbol,
    estimatedSector,
    liquidityTier,
    volatilityTier,
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

  const openPositions = Array.isArray(openBotPositions)
    ? openBotPositions
    : [];

  const openSymbols = openPositions
    .map((position) => normalizeSymbol(position.symbol))
    .filter(Boolean);

  const duplicateSymbolRisk = openSymbols.includes(symbol);

  const sameSectorPositions = openPositions.filter((position) => {
    const positionSymbol = normalizeSymbol(position.symbol);

    const estimatedPositionSector = estimateSectorIntelligence({
      symbol: positionSymbol,
      current: Number(
        position.current_price || position.avg_entry_price || 0
      ),
      price: Number(
        position.current_price || position.avg_entry_price || 0
      ),
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
    concentrationRiskScore * 0.55 +
      correlationRiskScore * 0.45
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

function calculateAiPortfolioManagerDecision(
  signal,
  account = {},
  openBotPositions = [],
  marketRegime = {}
) {
  const portfolioHeat = calculatePortfolioHeatEngine(
    signal,
    openBotPositions
  );

  const cash = Number(account.cash || 0);
  const equity = Number(account.equity || cash || 0);

  const marketStress = Number(
    marketRegime.stressScore ||
      marketRegime.macroStressScore ||
      engineState.marketStressLevel ||
      0
  );

  let allocationMultiplier = 1;

  if (marketStress >= 75) allocationMultiplier = 0.25;
  else if (marketStress >= 60) allocationMultiplier = 0.5;
  else if (marketStress >= 40) allocationMultiplier = 0.75;

  if (portfolioHeat.portfolioHeatScore < 50) {
    allocationMultiplier *= 0.5;
  }

  const maxBotBudget =
    equity * (CONFIG.maxBotExposurePercent / 100);

  const recommendedTradeAmount = Number(
    Math.max(
      0,
      Math.min(
        cash,
        maxBotBudget * allocationMultiplier * 0.2
      )
    ).toFixed(2)
  );

  const portfolioScore = clampScore(
    portfolioHeat.portfolioHeatScore * 0.7 +
      (100 - marketStress) * 0.3
  );

  const approved =
    recommendedTradeAmount > 0 &&
    portfolioHeat.portfolioHeatScore >= 45;

  return {
    approved,
    autoTradeApproved: approved,
    portfolioAction: approved ? "ALLOW" : "REDUCE_RISK",
    aiPortfolioAction: approved ? "ALLOW" : "REDUCE_RISK",
    portfolioScore,
    recommendedTradeAmount,
    aiAllocationPercentOfBotBudget: Number(
      (
        (recommendedTradeAmount / Math.max(maxBotBudget, 1)) *
        100
      ).toFixed(2)
    ),
    portfolioHeat,
    marketStress,
    allocationMultiplier,
    portfolioManagerReason:
      `${portfolioHeat.portfolioHeatLabel} • Market Stress ${marketStress}/100`,
  };
}

function calculateInstitutionalRebalanceIntelligence(
  account = {},
  openPositions = [],
  signals = []
) {
  const equity = Number(account?.equity || 0);
  const positions = Array.isArray(openPositions) ? openPositions : [];
  const candidates = Array.isArray(signals) ? signals : [];

  const topSignal = [...candidates].sort(
    (a, b) => Number(b.score || 0) - Number(a.score || 0)
  )[0];

  const reviews = positions.map((position) => {
    const symbol = normalizeSymbol(position.symbol);
    const profitPercent = Number(position.unrealized_plpc || 0) * 100;
    const marketValue = Math.abs(Number(position.market_value || 0));

    const entryScore =
      Number(engineState.aiEntryScores?.[symbol]?.score || 0);

    const currentSignal = candidates.find(
      (signal) => normalizeSymbol(signal.symbol) === symbol
    );

    const currentScore = Number(
      currentSignal?.score || entryScore || 0
    );

    const topScore = Number(topSignal?.score || 0);
    const scoreGap = topScore - currentScore;

    const action =
      profitPercent >= 6 && currentScore >= 75
        ? "PROTECT_WINNER"
        : profitPercent <= -3 && scoreGap >= CONFIG.replaceWeakestMinScoreGap
        ? "ROTATE_TO_STRONGER_SIGNAL"
        : profitPercent <= -4
        ? "REDUCE_WEAK_POSITION"
        : currentScore >= 70
        ? "KEEP"
        : "WATCH";

    return {
      symbol,
      profitPercent: Number(profitPercent.toFixed(2)),
      marketValue: Number(marketValue.toFixed(2)),
      entryScore,
      currentScore,
      topAlternativeSymbol: topSignal?.symbol || null,
      topAlternativeScore: topScore,
      scoreGap,
      action,
    };
  });

  const state = {
    updatedAt: new Date().toISOString(),
    equity,
    openPositionCount: positions.length,
    reviewedPositions: reviews,
    protectWinners: reviews.filter((r) => r.action === "PROTECT_WINNER"),
    weakPositions: reviews.filter(
      (r) =>
        r.action === "REDUCE_WEAK_POSITION" ||
        r.action === "ROTATE_TO_STRONGER_SIGNAL"
    ),
    rebalanceRequired: reviews.some(
      (r) =>
        r.action === "REDUCE_WEAK_POSITION" ||
        r.action === "ROTATE_TO_STRONGER_SIGNAL"
    ),
  };

  return state;
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

  const weakCapitalPreview = positionReviews
    .filter((item) => item.redistributionAction === "REDUCE_OR_EXIT")
    .reduce((sum, item) => sum + item.marketValue, 0);

  const deployableSignals = topSignals
    .filter((signal) => signal.qualifiedToBuy !== false)
    .map((signal) => {
      const score = Number(signal.score || 0);
      const hasDirectBudget = remainingBotBudget > 0;

      const reinforcedProbability = Number(
  signal.institutionalOrchestrator
    ?.probabilityReinforcement
    ?.reinforcedProbability || 50
);

const reinforcementCapitalMultiplier =
  reinforcedProbability >= 85
    ? 1.4
    : reinforcedProbability >= 75
    ? 1.2
    : reinforcedProbability >= 65
    ? 1.05
    : reinforcedProbability <= 40
    ? 0.55
    : reinforcedProbability <= 50
    ? 0.8
    : 1;

const orchestratorScore = Number(
  signal.institutionalOrchestrator
    ?.finalInstitutionalDecisionScore || score
);

const deploymentPriorityScore = clampScore(
  orchestratorScore * 0.7 +
    reinforcedProbability * 0.3
);
const reinforcementActionBias =
  reinforcedProbability >= 80
    ? "HIGH_CONVICTION"
    : reinforcedProbability >= 65
    ? "CONFIRMED"
    : reinforcedProbability <= 40
    ? "WEAKENING"
    : "NEUTRAL";

const canRotateWeakCapital = weakCapitalPreview > 0;

 return {
  symbol: signal.symbol,
  score,
  price: signal.current || signal.price,
  sector: signal.estimatedSector || "General Market",
  deploymentPriorityScore:
    Number(deploymentPriorityScore.toFixed(2)),
  reinforcementActionBias,
suggestedAction:
  reinforcedProbability >= 80 &&
  hasDirectBudget &&
  score >=
    Number(
      engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
        CONFIG.minScoreToBuy
    )
    ? "HIGH_CONVICTION_DEPLOYMENT"
    : reinforcedProbability >= 60 &&
      hasDirectBudget &&
      score >=
        Number(
          engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
            CONFIG.minScoreToBuy
        )
    ? "ELIGIBLE_FOR_CAPITAL"
    : reinforcedProbability >= 70 &&
      canRotateWeakCapital &&
      score >=
        Number(
          engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
            CONFIG.minScoreToBuy
        ) +
          CONFIG.replaceWeakestMinScoreGap
    ? "ROTATION_CANDIDATE"
    : reinforcedProbability <= 40
    ? "REDUCE_RISK"
    : "WATCH_ONLY",
  reinforcedProbability,
  reinforcementCapitalMultiplier,     


suggestedCapitalAllocation:
  Number(
    (
      remainingBotBudget *
      reinforcementCapitalMultiplier
    ).toFixed(2)
  ),
        rotationCapitalAvailable: Number(weakCapitalPreview.toFixed(2)),
      };
        })
    .sort(
      (a, b) =>
        Number(b.deploymentPriorityScore || 0) -
        Number(a.deploymentPriorityScore || 0)
    )
    .slice(0, CONFIG.topAutoTradeCandidates);

  const weakCapital = positionReviews
    .filter((item) => item.redistributionAction === "REDUCE_OR_EXIT")
    .reduce((sum, item) => sum + item.marketValue, 0);

  const protectedWinnerCapital = positionReviews
    .filter((item) => item.redistributionAction === "PROTECT_WINNER")
    .reduce((sum, item) => sum + item.marketValue, 0);

  const cashReserveTarget = equity * 0.15;
  const cashReserveStatus =
    cash >= cashReserveTarget ? "CASH_RESERVE_HEALTHY" : "LOW_CASH_RESERVE";

    const averageReinforcedProbability =
  deployableSignals.length > 0
    ? deployableSignals.reduce(
        (sum, signal) =>
          sum +
          Number(signal.reinforcedProbability || 0),
        0
      ) / deployableSignals.length
    : 0;

const totalSuggestedCapitalAllocation =
  deployableSignals.reduce(
    (sum, signal) =>
      sum +
      Number(signal.suggestedCapitalAllocation || 0),
    0
  );

const strongestReinforcementSignal =
  [...deployableSignals].sort(
    (a, b) =>
      Number(b.reinforcedProbability || 0) -
      Number(a.reinforcedProbability || 0)
  )[0] || null;
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

        totalSuggestedCapitalAllocation:
      Number(
        totalSuggestedCapitalAllocation.toFixed(2)
      ),
        averageReinforcedProbability:
      Number(
        averageReinforcedProbability.toFixed(2)
      ),

    strongestReinforcementSignal:
      strongestReinforcementSignal
        ? {
            symbol:
              strongestReinforcementSignal.symbol,
            reinforcedProbability:
              strongestReinforcementSignal.reinforcedProbability,
            deploymentPriorityScore:
              strongestReinforcementSignal.deploymentPriorityScore,
          }
        : null,

    redistributionSummary:
      `Weak capital: $${weakCapital.toFixed(2)} • ` +
      `Remaining bot budget: $${remainingBotBudget.toFixed(2)} • ` +
      `${cashReserveStatus}`,
  };
}

function calculateEngineFreshnessWeight(updatedAt, staleAfterSeconds = 180) {
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : 0;

  if (!timestamp) return 0.35;

  const ageSeconds = Math.max(0, (Date.now() - timestamp) / 1000);

  if (ageSeconds <= staleAfterSeconds) return 1;
  if (ageSeconds <= staleAfterSeconds * 2) return 0.75;
  if (ageSeconds <= staleAfterSeconds * 4) return 0.5;

  return 0.25;
}

function calculatePhase20AsyncMultiAgentOrchestration(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const agents = [
    {
      name: "portfolioGovernor",
      priority: 10,
      state: engineState.portfolioGovernorState,
      score: Number(engineState.portfolioGovernorState?.governorScore || 50),
      blocks: engineState.portfolioGovernorState?.shouldBlockNewTrades === true,
      weight: 1.25,
    },
    {
      name: "autonomousParliament",
      priority: 10,
      state: engineState.autonomousTradingSystemState,
      score: Number(engineState.autonomousTradingSystemState?.probabilityScore || 50),
      blocks: engineState.autonomousTradingSystemState?.shouldBlockNewTrades === true,
      weight: 1.3,
    },
    {
      name: "macroRisk",
      priority: 9,
      state: engineState.macroRiskState,
      score: 100 - Number(engineState.macroRiskState?.macroStressScore || 50),
      blocks: engineState.macroRiskState?.shouldBlockNewTrades === true,
      weight: 1.2,
    },
    {
      name: "liquidity",
      priority: 8,
      state: engineState.liquidityIntelligenceState,
      score: Number(engineState.liquidityIntelligenceState?.averageExecutionQuality || 50),
      blocks: engineState.liquidityIntelligenceState?.shouldBlockWeakLiquidity === true,
      weight: 1.05,
    },
    {
      name: "correlation",
      priority: 8,
      state: engineState.correlationIntelligenceState,
      score: 100 - Number(engineState.correlationIntelligenceState?.hiddenExposureRiskScore || 0),
      blocks: engineState.correlationIntelligenceState?.shouldReduceExposure === true,
      weight: 1.05,
    },
    {
      name: "execution",
      priority: 7,
      state: engineState.executionIntelligenceState,
      score: Number(engineState.executionIntelligenceState?.averageExecutionConfidence || 50),
      blocks: Number(engineState.executionIntelligenceState?.averageExecutionConfidence || 50) < 40,
      weight: 1,
    },
    {
      name: "selfOptimization",
      priority: 7,
      state: engineState.selfOptimizationState,
      score: Number(engineState.selfOptimizationState?.adaptiveRiskMultiplier || 1) * 70,
      blocks: Number(engineState.selfOptimizationState?.adaptiveRiskMultiplier || 1) <= 0.35,
      weight: 1,
    },
    {
      name: "reinforcement",
      priority: 5,
      state: engineState.reinforcementWeightState,
      score:
        engineState.reinforcementWeightState?.learningMode === "DEFENSIVE_REWEIGHTING"
          ? 45
          : engineState.reinforcementWeightState?.learningMode === "REINFORCE_WINNING_FACTORS"
          ? 78
          : 60,
      blocks: false,
      weight: 0.85,
    },
  ];

  const reviewedAgents = agents.map((agent) => {
    const freshnessWeight = calculateEngineFreshnessWeight(agent.state?.updatedAt);
    const weightedScore = clampScore(
      Number(agent.score || 0) * Number(agent.weight || 1) * freshnessWeight
    );

    return {
      name: agent.name,
      priority: agent.priority,
      score: clampScore(agent.score),
      weightedScore,
      freshnessWeight: Number(freshnessWeight.toFixed(2)),
      blocks: agent.blocks,
      updatedAt: agent.state?.updatedAt || null,
    };
  });

  const blockingAgents = reviewedAgents.filter((agent) => agent.blocks);
  const staleCriticalAgents = reviewedAgents.filter(
    (agent) => agent.priority >= 8 && Number(agent.freshnessWeight || 0) < 0.5
  );

  const consensusScore =
    reviewedAgents.reduce(
      (sum, agent) =>
        sum + Number(agent.weightedScore || 0) * Number(agent.priority || 1),
      0
    ) /
    Math.max(
      1,
      reviewedAgents.reduce((sum, agent) => sum + Number(agent.priority || 1), 0)
    );

  const consensusMode =
    blockingAgents.length >= 2
      ? "BLOCKING_CONSENSUS"
      : staleCriticalAgents.length > 0
      ? "STALE_CRITICAL_ENGINES"
      : consensusScore >= 80
      ? "HIGH_CONFIDENCE_AUTONOMY"
      : consensusScore >= 68
      ? "CONTROLLED_AUTONOMY"
      : consensusScore >= 55
      ? "SELECTIVE_AUTONOMY"
      : "DEFENSIVE_AUTONOMY";

const shouldBlockNewTrades =
  blockingAgents.length >= 4 ||
  consensusMode === "STALE_CRITICAL_ENGINES" ||
  consensusScore < 25;

const orchestrationMultiplier =
  shouldBlockNewTrades
    ? 0.2
    : consensusScore >= 82
    ? 1.1
    : consensusScore >= 70
    ? 0.9
    : consensusScore >= 58
    ? 0.65
    : 0.35;

  return {
    updatedAt: new Date().toISOString(),
    phase: "20.1_ASYNC_MULTI_AGENT_ORCHESTRATION",
    consensusMode,
    consensusScore: Number(consensusScore.toFixed(2)),
    orchestrationMultiplier: Number(orchestrationMultiplier.toFixed(2)),
    shouldBlockNewTrades,
    blockingAgents,
    staleCriticalAgents,
    reviewedAgents: reviewedAgents.sort((a, b) => b.priority - a.priority),
    topSignals: analyzedSignals
      .filter((signal) => signal.qualifiedToBuy !== false)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 10),
    reason:
      `${consensusMode} • Consensus ${consensusScore.toFixed(0)}/100 • ` +
      `${blockingAgents.length} blocking agents`,
  };
}

function calculateCrossEngineMemoryEvolution(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];
  const priorTrust = engineState.crossEngineMemoryState?.engineTrust || {};
  const recentTrades = (engineState.tradeJournalHistory || []).slice(0, 75);

  const recentWinRate =
    recentTrades.length > 0
      ? (recentTrades.filter((trade) => Number(trade.profitPercent || 0) > 0).length /
          recentTrades.length) *
        100
      : Number(engineState.tradeJournalState?.winRate || 0);

  const recentAverageProfit =
    recentTrades.length > 0
      ? recentTrades.reduce((sum, trade) => sum + Number(trade.profitPercent || 0), 0) /
        recentTrades.length
      : Number(engineState.tradeJournalState?.averageProfitPercent || 0);

  const engineInputs = {
    statisticalEdge: Number(engineState.statisticalEdgeState?.averageStatisticalScore || 50),
    technicalIntelligence: Number(engineState.technicalIntelligenceState?.averageTechnicalScore || 50),
    orchestrator: Number(engineState.institutionalOrchestratorState?.averageOrchestratorScore || 50),
    liquidity: Number(engineState.liquidityIntelligenceState?.averageExecutionQuality || 50),
    execution: Number(engineState.executionIntelligenceState?.averageExecutionConfidence || 50),
    governor: Number(engineState.portfolioGovernorState?.governorScore || 50),
    reinforcement: Number(engineState.reinforcementWeightState?.recentWinRate || recentWinRate || 50),
    selfOptimization: Number(engineState.selfOptimizationState?.adaptiveRiskMultiplier || 1) * 70,
  };

  const engineTrust = {};

  for (const [name, rawScore] of Object.entries(engineInputs)) {
    const previous = Number(priorTrust[name]?.trustScore || 60);

    const performanceAdjustment =
      recentTrades.length < 10
        ? 0
        : recentWinRate >= 60 && recentAverageProfit > 0
        ? 4
        : recentWinRate < 45 || recentAverageProfit < 0
        ? -5
        : 1;

    const signalAlignment =
      analyzedSignals.length > 0
        ? clampScore(rawScore) >= 65
          ? 2
          : clampScore(rawScore) < 45
          ? -2
          : 0
        : 0;

    const trustScore = clampScore(
      previous * 0.72 +
        clampScore(rawScore) * 0.2 +
        8 +
        performanceAdjustment +
        signalAlignment
    );

    engineTrust[name] = {
      trustScore: Number(trustScore.toFixed(2)),
      previousTrustScore: previous,
      rawScore: Number(clampScore(rawScore).toFixed(2)),
      performanceAdjustment,
      signalAlignment,
    };
  }

  const averageEngineTrust =
    Object.values(engineTrust).reduce(
      (sum, item) => sum + Number(item.trustScore || 0),
      0
    ) / Math.max(1, Object.keys(engineTrust).length);

  return {
    updatedAt: new Date().toISOString(),
    phase: "20.2_CROSS_ENGINE_MEMORY_EVOLUTION",
    memoryMode:
      averageEngineTrust >= 75
        ? "ENGINES_REINFORCING"
        : averageEngineTrust >= 60
        ? "ENGINES_STABLE"
        : averageEngineTrust >= 45
        ? "ENGINES_UNDER_REVIEW"
        : "ENGINES_DEFENSIVE_RESET",
    averageEngineTrust: Number(averageEngineTrust.toFixed(2)),
    recentTradesAnalyzed: recentTrades.length,
    recentWinRate: Number(recentWinRate.toFixed(2)),
    recentAverageProfit: Number(recentAverageProfit.toFixed(2)),
    engineTrust,
  };
}

function calculateAdaptiveExecutionTimingIntelligence(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const liquidityQuality =
    Number(engineState.liquidityIntelligenceState?.averageExecutionQuality || 50);

  const volatility = Number(engineState.marketVolatility || 0);

  const cycleMultiplier =
    Number(engineState.marketCycleIntelligenceState?.cycleThrottleMultiplier || 1);

  const executionConfidence =
    Number(engineState.executionIntelligenceState?.averageExecutionConfidence || 50);

  const spreadRisk =
    analyzedSignals.length > 0
      ? analyzedSignals.reduce((sum, signal) => sum + Number(signal.spreadPercent || 0), 0) /
        analyzedSignals.length
      : 0;

 const recommendedDelayMs = Math.round(
  (
    (liquidityQuality >= 75 ? 4000 : liquidityQuality >= 60 ? 7000 : 10000) +
    (volatility >= 18 ? 8000 : volatility >= 10 ? 6000 : 3000) +
    (spreadRisk >= 1 ? 12000 : spreadRisk >= 0.5 ? 8000 : 3000)
  ) /
    Math.max(0.65, cycleMultiplier) /
    3
);

  const timingMode =
    liquidityQuality >= 75 && executionConfidence >= 75 && volatility < 10
      ? "FAST_LIQUIDITY_WINDOW"
      : volatility >= 18 || spreadRisk >= 1
      ? "SLOW_STEALTH_EXECUTION"
      : liquidityQuality < 55
      ? "WAIT_FOR_LIQUIDITY"
      : "BALANCED_TIMING";

  return {
    updatedAt: new Date().toISOString(),
    phase: "20.3_ADAPTIVE_EXECUTION_TIMING",
    timingMode,
    recommendedDelayMs,
    maxSlices:
      timingMode === "FAST_LIQUIDITY_WINDOW"
        ? 3
        : timingMode === "SLOW_STEALTH_EXECUTION"
        ? 5
        : timingMode === "WAIT_FOR_LIQUIDITY"
        ? 2
        : 4,
    shouldDelayEntries:
      timingMode === "SLOW_STEALTH_EXECUTION" ||
      timingMode === "WAIT_FOR_LIQUIDITY",
    liquidityQuality,
    executionConfidence,
    volatility,
    spreadRisk: Number(spreadRisk.toFixed(3)),
    cycleMultiplier,
  };
}

function calculatePhase21AutonomousInstitutionalBrain(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];
  const orchestration = engineState.phase20AutonomousOrchestrationState || {};
  const memory = engineState.crossEngineMemoryState || {};
  const timing = engineState.adaptiveExecutionTimingState || {};
  const parliament = engineState.autonomousTradingSystemState || {};
  const selfOptimization = engineState.selfOptimizationState || {};
  const portfolioGovernor = engineState.portfolioGovernorState || {};

  const averageTrust = Number(memory.averageEngineTrust || 60);
  const consensusScore = Number(orchestration.consensusScore || parliament.probabilityScore || 50);
  const adaptiveRiskMultiplier = Number(selfOptimization.adaptiveRiskMultiplier || 1);
  const governorScore = Number(portfolioGovernor.governorScore || 50);

  const autonomousIntelligenceScore = clampScore(
    consensusScore * 0.35 +
      averageTrust * 0.25 +
      Number(parliament.probabilityScore || 50) * 0.2 +
      governorScore * 0.1 +
      adaptiveRiskMultiplier * 10
  );

const brainMode =
  orchestration.shouldBlockNewTrades ||
  (
    parliament.shouldBlockNewTrades &&
    Number(parliament.probabilityScore || 0) < 15
  )
    ? "AUTONOMOUS_DEFENSE"
    : autonomousIntelligenceScore >= 75
    ? "FULL_PHASE_21_AUTONOMY"
    : autonomousIntelligenceScore >= 60
    ? "CONTROLLED_PHASE_21_AUTONOMY"
    : autonomousIntelligenceScore >= 42
    ? "SELECTIVE_PHASE_21_AUTONOMY"
    : "OBSERVATION_ONLY";

const capitalMultiplier =
  brainMode === "FULL_PHASE_21_AUTONOMY"
    ? 1.15
    : brainMode === "CONTROLLED_PHASE_21_AUTONOMY"
    ? 0.9
    : brainMode === "SELECTIVE_PHASE_21_AUTONOMY"
    ? 0.6
    : 0.2;

  return {
    updatedAt: new Date().toISOString(),
    phase: "21_AUTONOMOUS_INSTITUTIONAL_AI_BRAIN",
    brainMode,
    autonomousIntelligenceScore: Number(autonomousIntelligenceScore.toFixed(2)),
    capitalMultiplier: Number(capitalMultiplier.toFixed(2)),
shouldBlockNewTrades:
  (
    brainMode === "AUTONOMOUS_DEFENSE" &&
    Number(parliament.probabilityScore || 0) < 15
  ) ||
  (
    brainMode === "OBSERVATION_ONLY" &&
    autonomousIntelligenceScore < 35
  ),
    consensusScore,
    averageEngineTrust: averageTrust,
    parliamentDecision: parliament.capitalParliamentDecision || "UNKNOWN",
    timingMode: timing.timingMode || "UNKNOWN",
    adaptiveRiskMultiplier,
    topAutonomousCandidates: analyzedSignals
      .filter((signal) => signal.qualifiedToBuy !== false)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 10),
    reason:
      `${brainMode} • Intelligence ${autonomousIntelligenceScore.toFixed(0)}/100 • ` +
      `Trust ${averageTrust.toFixed(0)}/100`,
  };
}

function calculateFullInstitutionalAutonomousTradingSystem(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const governor =
    engineState.portfolioGovernorState || {};
  const correlation =
    engineState.correlationIntelligenceState || {};
  const liquidity =
    engineState.liquidityIntelligenceState || {};
  const marketCycle =
    engineState.marketCycleIntelligenceState || {};
  const selfOptimization =
    engineState.selfOptimizationState || {};
  const execution =
    engineState.executionIntelligenceState || {};
  const reinforcement =
    engineState.reinforcementWeightState || {};
  const macro =
    engineState.macroRiskState || {};
  const crash =
    engineState.marketCrashProtectionState || {};

  const agentVotes = {
    portfolioGovernor:
      governor.shouldBlockNewTrades
        ? -1
        : Number(governor.governorScore || 50) >= 70
        ? 1
        : 0,

    correlationRisk:
      correlation.shouldReduceExposure ? -1 : 1,

    liquidity:
      liquidity.shouldBlockWeakLiquidity
        ? -1
        : Number(liquidity.averageExecutionQuality || 50) >= 65
        ? 1
        : 0,

    marketCycle:
      marketCycle.shouldBlockNewTrades
        ? -1
        : Number(marketCycle.cycleThrottleMultiplier || 0) >= 0.75
        ? 1
        : 0,

    selfOptimization:
      Number(selfOptimization.adaptiveRiskMultiplier || 1) >= 0.85
        ? 1
        : Number(selfOptimization.adaptiveRiskMultiplier || 1) <= 0.5
        ? -1
        : 0,

    execution:
      Number(execution.averageExecutionConfidence || 50) >= 65
        ? 1
        : Number(execution.averageExecutionConfidence || 50) < 45
        ? -1
        : 0,

    macro:
      macro.shouldBlockNewTrades ? -1 : 0,

    crashProtection:
      crash.shouldBlockNewTrades ? -1 : 0,
  };

  const yesVotes = Object.values(agentVotes).filter((vote) => vote === 1).length;
  const noVotes = Object.values(agentVotes).filter((vote) => vote === -1).length;
  const neutralVotes = Object.values(agentVotes).filter((vote) => vote === 0).length;

  const probabilityScore = clampScore(
    50 +
      yesVotes * 8 -
      noVotes * 14 +
      Number(governor.governorScore || 50) * 0.1 +
      Number(liquidity.averageExecutionQuality || 50) * 0.1 +
      Number(execution.averageExecutionConfidence || 50) * 0.1 -
      Number(correlation.hiddenExposureRiskScore || 0) * 0.12 -
      Number(macro.macroStressScore || 0) * 0.12
  );
const adversarialValidationPassed =
  noVotes <= 1 ||
  (
    noVotes <= 2 &&
    probabilityScore >= 60
  ) ||
  (
    noVotes <= 3 &&
    probabilityScore >= 75
  );

const capitalParliamentDecision =
  probabilityScore >= 72 && adversarialValidationPassed
    ? "FULL_AUTONOMOUS_APPROVAL"
    : probabilityScore >= 58
    ? "CONTROLLED_AUTONOMOUS_APPROVAL"
    : probabilityScore >= 35
    ? "WATCHLIST_ONLY"
    : "AUTONOMOUS_REJECTION";

const autonomousCapitalMultiplier =
  capitalParliamentDecision === "FULL_AUTONOMOUS_APPROVAL"
    ? 1
    : capitalParliamentDecision === "CONTROLLED_AUTONOMOUS_APPROVAL"
    ? 0.75
    : capitalParliamentDecision === "WATCHLIST_ONLY"
    ? 0.35
    : 0.15;

const shouldBlockNewTrades =
  (
    capitalParliamentDecision === "AUTONOMOUS_REJECTION" &&
    probabilityScore < 15
  ) ||
  macro.shouldBlockNewTrades ||
  crash.shouldBlockNewTrades;

  const strongestSignals = analyzedSignals
    .filter((signal) => signal.qualifiedToBuy !== false)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 10)
    .map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      institutionalScore: signal.institutionalScore,
      finalDecisionScore:
        signal.institutionalOrchestrator?.finalInstitutionalDecisionScore ||
        signal.score,
    }));

  return {
    updatedAt: new Date().toISOString(),
    capitalParliamentDecision,
    probabilityScore: Number(probabilityScore.toFixed(2)),
    autonomousCapitalMultiplier,
    adversarialValidationPassed,
    shouldBlockNewTrades,
    yesVotes,
    noVotes,
    neutralVotes,
    agentVotes,
    strongestSignals,
    reinforcementLearningMode:
      reinforcement.learningMode || "UNKNOWN",
    finalSystemReason:
      `${capitalParliamentDecision} • Probability ${probabilityScore.toFixed(0)}/100 • ` +
      `Votes ${yesVotes} yes / ${noVotes} no`,
  };
}

function calculateInstitutionalExecutionIntelligence(
  signals = [],
  openPositions = []
) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];
  const positions = Array.isArray(openPositions) ? openPositions : [];

  const liquidityQuality =
    Number(engineState.liquidityIntelligenceState?.averageExecutionQuality || 50);

  const liquidityReviews =
    engineState.liquidityIntelligenceState?.liquidityReviews || [];

  const governorThrottle =
    Number(engineState.portfolioGovernorState?.capitalThrottleMultiplier || 1);

  const cycleThrottle =
    Number(engineState.marketCycleIntelligenceState?.cycleThrottleMultiplier || 1);

  const correlationRisk =
    Number(engineState.correlationIntelligenceState?.hiddenExposureRiskScore || 0);

  const executionReviews = analyzedSignals.slice(0, 25).map((signal) => {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const price = Number(signal.current || signal.price || 0);
    const volume = Number(signal.volume || 0);
    const spreadPercent = Number(
      signal.spreadPercent ||
        signal.liquidityReview?.spreadPercent ||
        0
    );

    const assetClass =
      signal.assetClass ||
      signal.asset_class ||
      (symbol.includes("/") ? "crypto" : "stock");

    const isCrypto = assetClass === "crypto";

    const matchingLiquidityReview = liquidityReviews.find(
      (review) => normalizeSymbol(review.symbol) === symbol
    );

    const signalLiquidityQuality = Number(
      matchingLiquidityReview?.executionQualityScore ||
        signal.cryptoInstitutionalQualification?.volumeConfidenceScore ||
        liquidityQuality
    );

    const existingPosition = positions.find(
      (position) => normalizeSymbol(position.symbol) === symbol
    );

    const hasPosition = Boolean(existingPosition);

    const executionConfidence = clampScore(
      score * 0.35 +
        signalLiquidityQuality * 0.25 +
        Number(signal.technicalScore || 0) * 0.15 +
        Number(signal.statisticalScore || 0) * 0.15 +
        governorThrottle * 10 +
        cycleThrottle * 10 -
        correlationRisk * (isCrypto ? 0.12 : 0.2) -
        spreadPercent * (isCrypto ? 8 : 15) +
        (isCrypto && signal.qualifiedToBuy === true ? 8 : 0)
    );

    const entryStyle =
      executionConfidence >= 85
        ? "STEALTH_SCALE_IN"
        : executionConfidence >= 70
        ? "STAGGERED_ENTRY"
        : executionConfidence >= 55
        ? "SMALL_PROBE_ENTRY"
        : "NO_EXECUTION";

    const icebergSlices =
      entryStyle === "STEALTH_SCALE_IN"
        ? 4
        : entryStyle === "STAGGERED_ENTRY"
        ? 3
        : entryStyle === "SMALL_PROBE_ENTRY"
        ? 2
        : 0;

    const firstSlicePercent =
      icebergSlices >= 4
        ? 35
        : icebergSlices === 3
        ? 45
        : icebergSlices === 2
        ? 50
        : 0;

    const partialExitPlan =
      hasPosition &&
      Number(existingPosition.unrealized_plpc || 0) * 100 >= 4
        ? "TRIM_25_PERCENT_PROTECT_PROFIT"
        : hasPosition &&
          Number(existingPosition.unrealized_plpc || 0) * 100 <= -2
        ? "REDUCE_50_PERCENT_WEAK_POSITION"
        : "HOLD_FULL_POSITION";

    return {
      symbol,
      score,
      price,
      volume,
      assetClass,
      spreadPercent,
      signalLiquidityQuality:
        Number(signalLiquidityQuality.toFixed(2)),
      hasPosition,
      executionConfidence: Number(executionConfidence.toFixed(2)),
      entryStyle,
      icebergSlices,
      firstSlicePercent,
      partialExitPlan,
      executionReason:
        `${entryStyle} • Confidence ${executionConfidence.toFixed(0)}/100`,
    };
  });

  const executableSignals = executionReviews.filter(
    (review) => review.entryStyle !== "NO_EXECUTION"
  );

  const averageExecutionConfidence =
    executionReviews.length > 0
      ? executionReviews.reduce(
          (sum, review) => sum + Number(review.executionConfidence || 0),
          0
        ) / executionReviews.length
      : 0;

  const adaptiveRiskMultiplier =
    Number(
      engineState.selfOptimizationState
        ?.adaptiveRiskMultiplier || 1
    );

  const combinedThrottle =
   normalizedThrottle

  const normalizedThrottle =
    Math.max(0.45, combinedThrottle);

  const executionMode =
    averageExecutionConfidence >= 80
      ? "INSTITUTIONAL_STEALTH_EXECUTION"
      : averageExecutionConfidence >= 65
      ? "CONTROLLED_STAGGERED_EXECUTION"
      : averageExecutionConfidence >= 50
      ? "PROBE_ONLY_EXECUTION"
      : "EXECUTION_DEFENSE";

  return {
    updatedAt: new Date().toISOString(),
    executionMode,
    averageExecutionConfidence:
      Number(averageExecutionConfidence.toFixed(2)),
    executableSignalCount: executableSignals.length,
    liquidityQuality,
    governorThrottle,
    cycleThrottle,
    correlationRisk,
    executionReviews,
    topExecutableSignals: executableSignals.slice(0, 10),
    executionReason:
      `${executionMode} • Avg confidence ${averageExecutionConfidence.toFixed(0)}/100`,
  };
}

function calculateReinforcementLearningWeightEngine(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];
  const recentTrades = (engineState.tradeJournalHistory || []).slice(0, 50);

  const baseWeights = {
    momentum: 0.18,
    technicals: 0.25,
    fundamentals: 0.12,
    macro: 0.1,
    statisticalEdge: 0.2,
    riskQuality: 0.15,
  };

  const setupPerformance = {};

  for (const trade of recentTrades) {
    const setup =
      trade.strategy ||
      trade.exitReason ||
      "GENERAL_SETUP";

    if (!setupPerformance[setup]) {
      setupPerformance[setup] = {
        trades: 0,
        wins: 0,
        totalProfit: 0,
      };
    }

    setupPerformance[setup].trades += 1;
    setupPerformance[setup].totalProfit += Number(trade.profitPercent || 0);

    if (Number(trade.profitPercent || 0) > 0) {
      setupPerformance[setup].wins += 1;
    }
  }

  const totalClosedTrades =
    Number(engineState.tradeJournalState?.totalClosedTrades || 0);

  const recentWinRate =
    recentTrades.length > 0
      ? (recentTrades.filter((trade) => Number(trade.profitPercent || 0) > 0).length /
          recentTrades.length) *
        100
      : Number(engineState.tradeJournalState?.winRate || 0);

  const recentAverageProfit =
    recentTrades.length > 0
      ? recentTrades.reduce(
          (sum, trade) => sum + Number(trade.profitPercent || 0),
          0
        ) / recentTrades.length
      : Number(engineState.tradeJournalState?.averageProfitPercent || 0);

  const marketCycle =
    engineState.marketCycleIntelligenceState?.marketCyclePhase ||
    "NEUTRAL_CYCLE";

  const macroStress =
    Number(engineState.macroRiskState?.macroStressScore || 0);

  const liquidityQuality =
    Number(engineState.liquidityIntelligenceState?.averageExecutionQuality || 50);

  const correlationRisk =
    Number(engineState.correlationIntelligenceState?.hiddenExposureRiskScore || 0);

  let weights = { ...baseWeights };

  if (totalClosedTrades >= 10 && recentWinRate >= 60 && recentAverageProfit > 0) {
    weights.momentum += 0.03;
    weights.technicals += 0.03;
    weights.statisticalEdge += 0.02;
    weights.riskQuality -= 0.03;
    weights.macro -= 0.02;
  }

  if (totalClosedTrades >= 10 && recentWinRate < 45) {
    weights.riskQuality += 0.06;
    weights.macro += 0.03;
    weights.momentum -= 0.03;
    weights.technicals -= 0.02;
  }

  if (
    marketCycle === "PANIC" ||
    marketCycle === "DISTRIBUTION" ||
    macroStress >= 65 ||
    correlationRisk >= 70 ||
    liquidityQuality < 50
  ) {
    weights.riskQuality += 0.08;
    weights.macro += 0.05;
    weights.momentum -= 0.04;
    weights.fundamentals += 0.02;
  }

  if (marketCycle === "ACCUMULATION") {
    weights.momentum += 0.03;
    weights.technicals += 0.03;
    weights.statisticalEdge += 0.02;
  }

  const totalWeight = Object.values(weights).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );

  const normalizedWeights = Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [
      key,
      Number((Number(value || 0) / totalWeight).toFixed(4)),
    ])
  );

  const learningMode =
    totalClosedTrades < 10
      ? "BASELINE_LEARNING"
      : recentWinRate >= 60 && recentAverageProfit > 0
      ? "REINFORCE_WINNING_FACTORS"
      : recentWinRate < 45
      ? "DEFENSIVE_REWEIGHTING"
      : "BALANCED_REWEIGHTING";

  return {
    updatedAt: new Date().toISOString(),
    learningMode,
    weights: normalizedWeights,
    baseWeights,
    totalClosedTrades,
    recentTradesAnalyzed: recentTrades.length,
    recentWinRate: Number(recentWinRate.toFixed(2)),
    recentAverageProfit: Number(recentAverageProfit.toFixed(2)),
    marketCycle,
    macroStress,
    liquidityQuality,
    correlationRisk,
    setupPerformance,
    weightReason:
      `${learningMode} • Momentum ${normalizedWeights.momentum} • ` +
      `Technicals ${normalizedWeights.technicals} • Risk ${normalizedWeights.riskQuality}`,
  };
}

function calculateAiSelfOptimizationLayer(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const journal = engineState.tradeJournalState || {};
  const totalClosedTrades = Number(journal.totalClosedTrades || 0);
  const winRate = Number(journal.winRate || 0);
  const averageProfitPercent = Number(journal.averageProfitPercent || 0);

  const recentTrades =
    (engineState.tradeJournalHistory || []).slice(0, 30);

  const recentWinRate =
    recentTrades.length > 0
      ? (recentTrades.filter((trade) => Number(trade.profitPercent || 0) > 0).length /
          recentTrades.length) *
        100
      : winRate;

  const recentAverageProfit =
    recentTrades.length > 0
      ? recentTrades.reduce(
          (sum, trade) => sum + Number(trade.profitPercent || 0),
          0
        ) / recentTrades.length
      : averageProfitPercent;

  const marketCycle =
    engineState.marketCycleIntelligenceState?.marketCyclePhase ||
    "UNKNOWN";

  const liquidityQuality =
    Number(
      engineState.liquidityIntelligenceState?.averageExecutionQuality || 50
    );

  const correlationRisk =
    Number(
      engineState.correlationIntelligenceState?.hiddenExposureRiskScore || 0
    );

  const governorScore =
    Number(engineState.portfolioGovernorState?.governorScore || 50);

  const recentSignalAverage =
    analyzedSignals.length > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.score || 0),
          0
        ) / analyzedSignals.length
      : 50;

  let adaptiveMinScoreToBuy = CONFIG.minScoreToBuy;
  let adaptiveRiskMultiplier = 1;
  let adaptiveTrailingStopPercent = CONFIG.trailingStopPercent;
  let adaptiveRunnerTrailingStopPercent = CONFIG.runnerTrailingStopPercent;

  if (totalClosedTrades >= 10 && recentWinRate < 45) {
    adaptiveMinScoreToBuy += 5;
    adaptiveRiskMultiplier *= 0.75;
  }

  if (totalClosedTrades >= 10 && recentAverageProfit < 0) {
    adaptiveMinScoreToBuy += 3;
    adaptiveRiskMultiplier *= 0.8;
  }

  if (recentWinRate >= 60 && recentAverageProfit > 0.5 && governorScore >= 70) {
    adaptiveMinScoreToBuy -= 2;
    adaptiveRiskMultiplier *= 1.1;
  }

if (
  marketCycle === "PANIC" ||
  marketCycle === "DISTRIBUTION" ||
  marketCycle === "EUPHORIA_EXHAUSTION"
) {
  adaptiveMinScoreToBuy += 2;
  adaptiveRiskMultiplier *= 0.75;
  adaptiveTrailingStopPercent = Math.max(1, adaptiveTrailingStopPercent - 0.5);
}

if (liquidityQuality < 50) {
  adaptiveMinScoreToBuy += 1;
  adaptiveRiskMultiplier *= 0.85;
}

  if (correlationRisk >= 70) {
    adaptiveMinScoreToBuy += 4;
    adaptiveRiskMultiplier *= 0.7;
  }

  if (recentSignalAverage >= 85 && governorScore >= 80 && liquidityQuality >= 70) {
    adaptiveRiskMultiplier *= 1.05;
  }

 adaptiveMinScoreToBuy = Math.min(
  CONFIG.minScoreToBuy,
  Math.max(60, Math.round(adaptiveMinScoreToBuy))
);

  adaptiveRiskMultiplier = Number(
    Math.min(1.25, Math.max(0.25, adaptiveRiskMultiplier)).toFixed(2)
  );

  adaptiveTrailingStopPercent = Number(
    Math.min(5, Math.max(0.75, adaptiveTrailingStopPercent)).toFixed(2)
  );

  adaptiveRunnerTrailingStopPercent = Number(
    Math.min(6, Math.max(1, adaptiveRunnerTrailingStopPercent)).toFixed(2)
  );

  const qualificationMode =
    adaptiveRiskMultiplier <= 0.5
      ? "STRICT_DEFENSE"
      : adaptiveRiskMultiplier < 0.85
      ? "SELECTIVE_QUALITY"
      : adaptiveRiskMultiplier > 1
      ? "CONTROLLED_OFFENSE"
      : "BALANCED";

  return {
    updatedAt: new Date().toISOString(),
    qualificationMode,
    adaptiveMinScoreToBuy,
    baseMinScoreToBuy: CONFIG.minScoreToBuy,
    adaptiveRiskMultiplier,
    adaptiveTrailingStopPercent,
    adaptiveRunnerTrailingStopPercent,
    totalClosedTrades,
    winRate,
    recentWinRate: Number(recentWinRate.toFixed(2)),
    averageProfitPercent,
    recentAverageProfit: Number(recentAverageProfit.toFixed(2)),
    marketCycle,
    liquidityQuality,
    correlationRisk,
    governorScore,
    recentSignalAverage: Number(recentSignalAverage.toFixed(2)),
    optimizationReason:
      `${qualificationMode} • Min score ${adaptiveMinScoreToBuy} • ` +
      `Risk x${adaptiveRiskMultiplier}`,
  };
}

function calculateAdaptiveMarketCycleIntelligence(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const totalSignals = analyzedSignals.length;

  const averageScore =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.score || 0),
          0
        ) / totalSignals
      : 0;

  const averagePercentChange =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.percentChange || 0),
          0
        ) / totalSignals
      : 0;

  const averageVolumeRatio =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) =>
            sum +
            Number(
              signal.confirmations?.volumeSpikeRatio ||
                signal.volumeRatio ||
                0
            ),
          0
        ) / totalSignals
      : 0;

  const strongBreakouts = analyzedSignals.filter(
    (signal) =>
      Number(signal.score || 0) >= 75 &&
      Number(signal.percentChange || 0) > 0 &&
      signal.confirmations?.fakeBreakout !== true
  ).length;

  const fakeBreakouts = analyzedSignals.filter(
    (signal) => signal.confirmations?.fakeBreakout
  ).length;

  const exhaustedSignals = analyzedSignals.filter(
    (signal) =>
      Number(signal.percentChange || 0) >= 25 ||
      Number(signal.technicalIntelligence?.exhaustionRiskScore || 0) >= 70
  ).length;

  const compressedSignals = analyzedSignals.filter(
    (signal) =>
      Math.abs(Number(signal.percentChange || 0)) <= 2 &&
      Number(
        signal.confirmations?.volumeSpikeRatio ||
          signal.volumeRatio ||
          0
      ) >= 1
  ).length;

  const accumulationScore = clampScore(
    averageScore * 0.35 +
      averageVolumeRatio * 18 +
      strongBreakouts * 4 -
      fakeBreakouts * 8
  );

  const distributionScore = clampScore(
    fakeBreakouts * 12 +
      Math.max(0, -averagePercentChange) * 6 +
      exhaustedSignals * 5
  );

const panicScore = clampScore(
  Math.max(0, -averagePercentChange) * 3 +
    Number(engineState.marketStressLevel || 0) * 0.5 +
    Number(engineState.macroRiskState?.macroStressScore || 0) * 0.15
);

  const euphoriaScore = clampScore(
    Math.max(0, averagePercentChange) * 5 +
      exhaustedSignals * 6 +
      (averageScore >= 85 ? 20 : 0)
  );

  const volatilityCompressionScore = clampScore(
    compressedSignals * 8 +
      (Number(engineState.marketVolatility || 0) <= 25 ? 20 : 0)
  );

  const exhaustionRiskScore = clampScore(
    exhaustedSignals * 10 +
      fakeBreakouts * 8 +
      euphoriaScore * 0.4
  );

  const marketCyclePhase =
    panicScore >= 85
      ? "PANIC"
      : distributionScore >= 70
      ? "DISTRIBUTION"
      : euphoriaScore >= 75 || exhaustionRiskScore >= 75
      ? "EUPHORIA_EXHAUSTION"
      : accumulationScore >= 70
      ? "ACCUMULATION"
      : volatilityCompressionScore >= 65
      ? "VOLATILITY_COMPRESSION"
      : "NEUTRAL_CYCLE";

  const cycleThrottleMultiplier =
    marketCyclePhase === "PANIC"
  ? 0.35
      : marketCyclePhase === "DISTRIBUTION"
      ? 0.25
      : marketCyclePhase === "EUPHORIA_EXHAUSTION"
      ? 0.35
      : marketCyclePhase === "VOLATILITY_COMPRESSION"
      ? 0.75
      : marketCyclePhase === "ACCUMULATION"
      ? 1
      : 0.65;

  const shouldBlockNewTrades =
    marketCyclePhase === "PANIC" ||
    exhaustionRiskScore >= 85;

  return {
    updatedAt: new Date().toISOString(),
    marketCyclePhase,
    cycleThrottleMultiplier,
    shouldBlockNewTrades,
    totalSignals,
    averageScore: Number(averageScore.toFixed(2)),
    averagePercentChange: Number(averagePercentChange.toFixed(2)),
    averageVolumeRatio: Number(averageVolumeRatio.toFixed(2)),
    accumulationScore: Number(accumulationScore.toFixed(2)),
    distributionScore: Number(distributionScore.toFixed(2)),
    panicScore: Number(panicScore.toFixed(2)),
    euphoriaScore: Number(euphoriaScore.toFixed(2)),
    exhaustionRiskScore: Number(exhaustionRiskScore.toFixed(2)),
    volatilityCompressionScore: Number(volatilityCompressionScore.toFixed(2)),
    strongBreakouts,
    fakeBreakouts,
    exhaustedSignals,
    compressedSignals,
    cycleReason:
      `${marketCyclePhase} • Cycle throttle x${cycleThrottleMultiplier}`,
  };
}

function calculateLiquidityIntelligenceEngine(signals = []) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const liquidityReviews = analyzedSignals.map((signal) => {
    const symbol = normalizeSymbol(signal.symbol);
    const assetClass = signal.assetClass || signal.asset_class || "stock";
    const isCrypto = assetClass === "crypto" || symbol.includes("/");

    const price = Number(signal.current || signal.price || 0);
    const volume = Number(signal.volume || 0);
    const bid = Number(signal.bid || 0);
    const ask = Number(signal.ask || 0);

    const spreadPercent =
      bid > 0 && ask > 0
        ? ((ask - bid) / ask) * 100
        : Number(signal.spreadPercent || 0);

    const reportedDollarVolume = Number(signal.dollarVolume || 0);
    const dollarVolume =
      reportedDollarVolume > 0
        ? reportedDollarVolume
        : price * volume;

 const percentChange =
  Math.abs(
    Number(
      signal.percent_change_24h ||
      signal.changePercent ||
      signal.percentChange ||
      0
    )
  );

const stableBehaviorDetected =
  percentChange <= 0.35 &&
  Number(spreadPercent || 0) <= 0.12;       

    const cryptoQualification =
      signal.cryptoInstitutionalQualification || {};

    const cryptoVolumeSpikeRatio = Number(
      signal.volumeSpikeRatio ||
        cryptoQualification.volumeSpikeRatio ||
        0
    );

    const cryptoLiquidityConfidence = isCrypto
      ? clampScore(
          45 +
            (spreadPercent <= 0.15
              ? 25
              : spreadPercent <= 0.35
              ? 18
              : spreadPercent <= 0.65
              ? 10
              : spreadPercent <= 1
              ? 2
              : -20) +
            (cryptoVolumeSpikeRatio >= 2
              ? 18
              : cryptoVolumeSpikeRatio >= 1
              ? 12
              : cryptoVolumeSpikeRatio >= 0.5
              ? 6
              : 0) +
            (dollarVolume >= 1000
              ? 15
              : dollarVolume >= 100
              ? 10
              : dollarVolume > 0
              ? 5
              : 0) +
            (Number(signal.barsFound || 0) >= 20 ? 8 : 0) +
            (cryptoQualification.liquidityPass ? 10 : 0)
        )
      : 0;

const stockLiquidityDepthScore = clampScore(
  25 +
    (
      volume >= 1000000
        ? 35
        : volume >= 250000
        ? 28
        : volume >= 75000
        ? 20
        : volume >= 25000
        ? 12
        : 0
    ) +
    (
      dollarVolume >= 3000000
        ? 25
        : dollarVolume >= 1000000
        ? 18
        : dollarVolume >= 350000
        ? 12
        : dollarVolume >= 100000
        ? 6
        : 0
    ) +
    (
      spreadPercent <= 0.15
        ? 20
        : spreadPercent <= 0.35
        ? 12
        : spreadPercent <= 0.65
        ? 4
        : -15
    )
);

    const liquidityDepthScore = isCrypto
      ? cryptoLiquidityConfidence
      : stockLiquidityDepthScore;

    const estimatedSlippagePercent = Number(
      (
        Math.max(0.03, spreadPercent * (isCrypto ? 0.45 : 0.6)) +
        (isCrypto
          ? spreadPercent <= 0.25
            ? 0.05
            : spreadPercent <= 0.65
            ? 0.12
            : 0.25
          : volume < 50000
          ? 0.35
          : volume < 250000
          ? 0.18
          : 0.05)
      ).toFixed(3)
    );

    const executionQualityScore = clampScore(
      liquidityDepthScore -
        estimatedSlippagePercent * (isCrypto ? 10 : 20) -
        (spreadPercent > (isCrypto ? 1.25 : 0.65) ? 20 : 0)
    );

    const liquidityAction =
      executionQualityScore >= 80
        ? "CLEAN_EXECUTION"
        : executionQualityScore >= 65
        ? "ACCEPTABLE_EXECUTION"
        : executionQualityScore >= 50
        ? "SMALL_SIZE_ONLY"
        : "AVOID_EXECUTION";

    return {
      symbol,
      assetClass: isCrypto ? "crypto" : assetClass,
      price,
      volume,
      dollarVolume: Number(dollarVolume.toFixed(2)),
      spreadPercent: Number(spreadPercent.toFixed(3)),
      liquidityDepthScore: Number(liquidityDepthScore.toFixed(2)),
      estimatedSlippagePercent,
      executionQualityScore: Number(executionQualityScore.toFixed(2)),
      liquidityAction,
      cryptoLiquidityConfidence: isCrypto
        ? Number(cryptoLiquidityConfidence.toFixed(2))
        : null,
    };
  });

  const weakLiquiditySignals = liquidityReviews.filter(
    (item) => item.liquidityAction === "AVOID_EXECUTION"
  );

  const averageExecutionQuality =
    liquidityReviews.length > 0
      ? liquidityReviews.reduce(
          (sum, item) => sum + Number(item.executionQualityScore || 0),
          0
        ) / liquidityReviews.length
      : 0;

  const spreadPersistenceRisk = liquidityReviews.filter(
    (item) =>
      item.spreadPercent >
      (item.assetClass === "crypto" ? 1.25 : 0.65)
  ).length;

  const hasQualifiedCrypto = analyzedSignals.some(
    (signal) =>
      (signal.assetClass === "crypto" ||
        signal.asset_class === "crypto" ||
        String(signal.symbol || "").includes("/")) &&
      signal.qualifiedToBuy === true
  );

  const shouldBlockWeakLiquidity =
    averageExecutionQuality < 35 ||
    spreadPersistenceRisk >= 5 ||
    (averageExecutionQuality < 45 && !hasQualifiedCrypto);

  return {
    updatedAt: new Date().toISOString(),
    averageExecutionQuality: Number(averageExecutionQuality.toFixed(2)),
    weakLiquidityCount: weakLiquiditySignals.length,
    spreadPersistenceRisk,
    shouldBlockWeakLiquidity,
    hasQualifiedCrypto,
    weakestLiquiditySignals: weakLiquiditySignals.slice(0, 10),
    liquidityReviews: liquidityReviews.slice(0, 25),
    liquidityReason:
      `Execution quality ${averageExecutionQuality.toFixed(0)}/100 • ` +
      `Weak liquidity ${weakLiquiditySignals.length} • ` +
      `${hasQualifiedCrypto ? "Qualified crypto present" : "No qualified crypto"}`,
  };
}

function calculateCorrelationIntelligenceEngine(
  openPositions = [],
  signals = []
) {
  const positions = Array.isArray(openPositions)
    ? openPositions
    : [];

  const analyzedSignals = Array.isArray(signals)
    ? signals
    : [];

const tradingMode =
  getEffectiveTradingMode(engineState.marketOpen);

const filteredPositions =
  tradingMode === "live_crypto"
    ? positions.filter((position) => {
        const symbol = normalizeSymbol(position.symbol);

        return (
          symbol.includes("/") ||
          String(position.asset_class || "")
            .toLowerCase()
            .includes("crypto") ||
          String(position.assetClass || "")
            .toLowerCase()
            .includes("crypto")
        );
      })
    : positions.filter((position) => {
        const symbol = normalizeSymbol(position.symbol);

        return !symbol.includes("/");
      });
      

  const sectorBuckets = {};
  const cryptoPositions = [];
  const overlapWarnings = [];

for (const position of filteredPositions) {
    const symbol = normalizeSymbol(position.symbol);

    const sectorInfo = estimateSectorIntelligence({
      symbol,
      current:
        Number(position.current_price || 0),
      price:
        Number(position.current_price || 0),
      volume: 0,
      percentChange:
        Number(position.unrealized_plpc || 0) * 100,
      confirmations: {},
    });

    const sector =
      sectorInfo.estimatedSector ||
      "General Market";

    if (!sectorBuckets[sector]) {
      sectorBuckets[sector] = [];
    }

    sectorBuckets[sector].push({
      symbol,
      marketValue: Math.abs(
        Number(position.market_value || 0)
      ),
      unrealizedPercent:
        Number(position.unrealized_plpc || 0) * 100,
    });

    const isCrypto =
      String(position.asset_class || "")
        .toLowerCase()
        .includes("crypto") ||
      symbol.includes("/");

    if (isCrypto) {
      cryptoPositions.push(symbol);
    }
  }

  const sectorClusters = Object.entries(
    sectorBuckets
  ).map(([sector, positions]) => {
    const totalExposure =
      positions.reduce(
        (sum, p) => sum + p.marketValue,
        0
      );

    const averagePerformance =
      positions.length > 0
        ? positions.reduce(
            (sum, p) =>
              sum + p.unrealizedPercent,
            0
          ) / positions.length
        : 0;

    const contagionRiskScore = clampScore(
      positions.length * 18 +
        Math.max(
          0,
          -averagePerformance * 4
        )
    );

    const clusterRisk =
      contagionRiskScore >= 80
        ? "SEVERE_CLUSTER_RISK"
        : contagionRiskScore >= 60
        ? "HIGH_CLUSTER_RISK"
        : contagionRiskScore >= 40
        ? "MODERATE_CLUSTER_RISK"
        : "LOW_CLUSTER_RISK";

    return {
      sector,
      positions,
      positionCount: positions.length,
      totalExposure:
        Number(totalExposure.toFixed(2)),
      averagePerformance:
        Number(
          averagePerformance.toFixed(2)
        ),
      contagionRiskScore:
        Number(
          contagionRiskScore.toFixed(2)
        ),
      clusterRisk,
    };
  });

  const concentratedClusters =
    sectorClusters.filter(
      (cluster) =>
        cluster.positionCount >= 2 ||
        cluster.contagionRiskScore >= 60
    );

  for (const cluster of concentratedClusters) {
    overlapWarnings.push({
      type: "SECTOR_OVERLAP",
      sector: cluster.sector,
      risk: cluster.clusterRisk,
      positions:
        cluster.positions.map(
          (p) => p.symbol
        ),
    });
  }

  const cryptoCorrelationRisk =
    cryptoPositions.length >= 3
      ? "HIGH_CRYPTO_CORRELATION"
      : cryptoPositions.length >= 2
      ? "MODERATE_CRYPTO_CORRELATION"
      : "LOW_CRYPTO_CORRELATION";

  const averageClusterRisk =
    sectorClusters.length > 0
      ? sectorClusters.reduce(
          (sum, cluster) =>
            sum +
            Number(
              cluster.contagionRiskScore || 0
            ),
          0
        ) / sectorClusters.length
      : 0;

  const hiddenExposureRiskScore =
    clampScore(
      averageClusterRisk +
        concentratedClusters.length * 10 +
        cryptoPositions.length * 8
    );

  const drawdownContagionRisk =
    hiddenExposureRiskScore >= 80
      ? "EXTREME_CONTAGION_RISK"
      : hiddenExposureRiskScore >= 60
      ? "HIGH_CONTAGION_RISK"
      : hiddenExposureRiskScore >= 40
      ? "MODERATE_CONTAGION_RISK"
      : "LOW_CONTAGION_RISK";

  const shouldReduceExposure =
    hiddenExposureRiskScore >= 70;

  return {
    updatedAt: new Date().toISOString(),
    hiddenExposureRiskScore:
      Number(
        hiddenExposureRiskScore.toFixed(2)
      ),
    drawdownContagionRisk,
    cryptoCorrelationRisk,
    shouldReduceExposure,
    totalClusters: sectorClusters.length,
    concentratedClusters:
      concentratedClusters.length,
    cryptoPositions,
    overlapWarnings,
    sectorClusters:
      sectorClusters.slice(0, 10),
    correlationReason:
      `${drawdownContagionRisk} • ` +
      `Hidden exposure ${hiddenExposureRiskScore.toFixed(0)}/100`,
  };
}

function calculateAutonomousPortfolioGovernor(
  account = {},
  openBotPositions = [],
  signals = [],
  portfolioOptimization = {},
  macroRisk = {},
  crashProtection = {}
) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);
  const positions = Array.isArray(openBotPositions) ? openBotPositions : [];
  const candidates = Array.isArray(signals) ? signals : [];

  const currentExposure = getBotExposure(positions);
  const maxBudget = equity * (CONFIG.maxBotExposurePercent / 100);
  const exposurePercent =
    equity > 0 ? (currentExposure / equity) * 100 : 0;

  const sectorExposureMap = {};

  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol);
    const marketValue = Math.abs(Number(position.market_value || 0));

    const sector =
      estimateSectorIntelligence({
        symbol,
        current: Number(position.current_price || position.avg_entry_price || 0),
        price: Number(position.current_price || position.avg_entry_price || 0),
        volume: 0,
        percentChange: Number(position.unrealized_plpc || 0) * 100,
        confirmations: {},
      }).estimatedSector || "General Market";

    sectorExposureMap[sector] =
      Number(sectorExposureMap[sector] || 0) + marketValue;
  }

  const sectorExposure = Object.entries(sectorExposureMap)
    .map(([sector, value]) => ({
      sector,
      exposure: Number(value.toFixed(2)),
      exposurePercent:
        equity > 0 ? Number(((value / equity) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.exposure - a.exposure);

  const topSector = sectorExposure[0] || null;

  const sectorSaturationRisk =
    topSector && topSector.exposurePercent >= CONFIG.maxBotExposurePercent * 0.6;

  const averageCandidateScore =
    candidates.length > 0
      ? candidates.reduce((sum, signal) => sum + Number(signal.score || 0), 0) /
        candidates.length
      : 0;

  const volatilityBudgetScore = clampScore(
    100 -
      Number(engineState.marketVolatility || 0) -
      Number(macroRisk?.macroStressScore || 0) * 0.4 -
      Number(crashProtection?.crashRiskScore || 0) * 0.4
  );

  const portfolioEfficiencyScore = Number(
    portfolioOptimization?.portfolioEfficiencyScore ||
      portfolioOptimization?.optimizationScore ||
      50
  );

  const governorScore = clampScore(
    portfolioEfficiencyScore * 0.3 +
      volatilityBudgetScore * 0.25 +
      averageCandidateScore * 0.2 +
      (100 - exposurePercent * 10) * 0.15 +
      (sectorSaturationRisk ? 35 : 75) * 0.1
  );

let capitalThrottleMultiplier =
  macroRisk?.shouldBlockNewTrades || crashProtection?.shouldBlockNewTrades
    ? 0.25
    : governorScore >= 85
    ? 1
    : governorScore >= 70
    ? 0.75
    : governorScore >= 55
    ? 0.5
    : governorScore >= 40
    ? 0.25
    : 0.15;


const governorMode =
  capitalThrottleMultiplier <= 0.15
    ? "CAPITAL_LOCKDOWN"
    : governorScore >= 85
    ? "FULL_PORTFOLIO_GREENLIGHT"
    : governorScore >= 70
    ? "CONTROLLED_EXPANSION"
    : governorScore >= 55
    ? "SELECTIVE_DEPLOYMENT"
    : governorScore >= 40
    ? "DEFENSIVE_THROTTLE"
    : "PROBE_DEPLOYMENT";

const shouldBlockNewTrades =
  capitalThrottleMultiplier === 0 ||
  exposurePercent >= CONFIG.maxBotExposurePercent ||
  engineState.correlationIntelligenceState
    ?.shouldReduceExposure === true;

    const liquidityPenalty =
  engineState.liquidityIntelligenceState
    ?.shouldBlockWeakLiquidity
    ? 0.7
    : 1;

const marketCyclePenalty =
  engineState.marketCycleIntelligenceState
    ?.shouldBlockNewTrades
    ? 0.7
    : 1;

const parliamentPenalty =
  engineState.autonomousTradingSystemState
    ?.shouldBlockNewTrades
    ? 0.6
    : 1;

capitalThrottleMultiplier *=
  Math.max(
    0.55,
    liquidityPenalty *
      marketCyclePenalty *
      parliamentPenalty
  );

capitalThrottleMultiplier = Math.max(
  0.35,
  Math.min(capitalThrottleMultiplier, 1)
);
  
  return {
    updatedAt: new Date().toISOString(),
    governorMode,
    governorScore: Number(governorScore.toFixed(2)),
    capitalThrottleMultiplier,
    shouldBlockNewTrades,
    equity,
    cash,
    maxBudget: Number(maxBudget.toFixed(2)),
    currentExposure: Number(currentExposure.toFixed(2)),
    exposurePercent: Number(exposurePercent.toFixed(2)),
    portfolioEfficiencyScore,
    volatilityBudgetScore: Number(volatilityBudgetScore.toFixed(2)),
    averageCandidateScore: Number(averageCandidateScore.toFixed(2)),
    sectorSaturationRisk,
    topSector,
    sectorExposure,
    governorReason:
      `${governorMode} • Governor ${governorScore.toFixed(0)}/100 • ` +
      `Throttle x${capitalThrottleMultiplier}`,
  };
}

function calculateSmartCapitalCompoundingEngine(account, openBotPositions = []) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);

  const modePeaks = engineState.peaksByMode?.[TRADING_MODE] || {};
  const peakEquity = Number(modePeaks.peakEquity || equity || 0);

  const drawdownPercent =
    peakEquity > 0
      ? ((peakEquity - equity) / peakEquity) * 100
      : 0;

  const dailyStart = Number(engineState.dailyStartEquity || equity || 0);

  const dailyReturnPercent =
    dailyStart > 0
      ? ((equity - dailyStart) / dailyStart) * 100
      : 0;

  const currentBotExposure = getBotExposure(openBotPositions);

  let compoundingMode = "BASELINE";
  let compoundingMultiplier = 1;

  if (drawdownPercent >= 8) {
    compoundingMode = "CAPITAL_DEFENSE";
    compoundingMultiplier = 0.25;
  } else if (drawdownPercent >= 4) {
    compoundingMode = "DRAWDOWN_RECOVERY";
    compoundingMultiplier = 0.5;
  } else if (dailyReturnPercent >= 2) {
    compoundingMode = "PROTECT_GAINS";
    compoundingMultiplier = 0.65;
  } else if (dailyReturnPercent >= 1 && drawdownPercent < 2) {
    compoundingMode = "CONTROLLED_COMPOUNDING";
    compoundingMultiplier = 1.15;
  }

  const baseMaxBotBudget =
    equity * (CONFIG.maxBotExposurePercent / 100);

  const compoundedBotBudget =
    baseMaxBotBudget * compoundingMultiplier;

  const remainingCompoundedBudget =
    Math.max(0, compoundedBotBudget - currentBotExposure);

  const state = {
    updatedAt: new Date().toISOString(),
    equity,
    cash,
    peakEquity,
    dailyStart,
    dailyReturnPercent: Number(dailyReturnPercent.toFixed(2)),
    drawdownPercent: Number(drawdownPercent.toFixed(2)),
    currentBotExposure: Number(currentBotExposure.toFixed(2)),
    baseMaxBotBudget: Number(baseMaxBotBudget.toFixed(2)),
    compoundedBotBudget: Number(compoundedBotBudget.toFixed(2)),
    remainingCompoundedBudget: Number(
      remainingCompoundedBudget.toFixed(2)
    ),
    compoundingMode,
    compoundingMultiplier,
  };

  engineState.capitalCompoundingState = state;
  engineState.equityCurveState = {
    updatedAt: state.updatedAt,
    equity,
    peakEquity,
    dailyStart,
    dailyReturnPercent: state.dailyReturnPercent,
  };

  engineState.drawdownRecoveryState = {
    updatedAt: state.updatedAt,
    drawdownPercent: state.drawdownPercent,
    recoveryMode:
      drawdownPercent >= 4
        ? "ACTIVE_RECOVERY"
        : "NORMAL",
  };

  engineState.adaptiveRiskState = {
    updatedAt: state.updatedAt,
    compoundingMode,
    compoundingMultiplier,
  };

  engineState.capitalCompoundingHistory.unshift(state);
  engineState.capitalCompoundingHistory =
    engineState.capitalCompoundingHistory.slice(0, 200);

  return state;
}

function calculateLiveAiPerformanceAnalyticsEngine(account, openPositions = []) {
  const positions = Array.isArray(openPositions) ? openPositions : [];

  const aiSymbols = Array.isArray(engineState.aiManagedSymbols)
    ? engineState.aiManagedSymbols.map((symbol) => normalizeSymbol(symbol))
    : [];

  const aiPositions = positions.filter((position) => {
    const symbol = normalizeSymbol(position.symbol);

    if (aiSymbols.includes(symbol)) return true;

    return String(position.asset_class || "").toLowerCase() === "us_equity";
  });

  const totalMarketValue = aiPositions.reduce(
    (sum, position) => sum + Math.abs(Number(position.market_value || 0)),
    0
  );

  const totalUnrealizedProfit = aiPositions.reduce(
    (sum, position) => sum + Number(position.unrealized_pl || 0),
    0
  );

  const winners = aiPositions.filter(
    (position) => Number(position.unrealized_pl || 0) > 0
  );

  const losers = aiPositions.filter(
    (position) => Number(position.unrealized_pl || 0) < 0
  );

  const bestPerformer = [...aiPositions].sort(
    (a, b) => Number(b.unrealized_plpc || 0) - Number(a.unrealized_plpc || 0)
  )[0] || null;

  const worstPerformer = [...aiPositions].sort(
    (a, b) => Number(a.unrealized_plpc || 0) - Number(b.unrealized_plpc || 0)
  )[0] || null;

  const winRate =
    aiPositions.length > 0
      ? (winners.length / aiPositions.length) * 100
      : 0;

  const averageUnrealizedPercent =
    aiPositions.length > 0
      ? aiPositions.reduce(
          (sum, position) => sum + Number(position.unrealized_plpc || 0) * 100,
          0
        ) / aiPositions.length
      : 0;

  return {
    updatedAt: new Date().toISOString(),
    accountEquity: Number(account?.equity || 0),
    accountCash: Number(account?.cash || 0),
    aiPositionCount: aiPositions.length,
    totalMarketValue: Number(totalMarketValue.toFixed(2)),
    totalUnrealizedProfit: Number(totalUnrealizedProfit.toFixed(2)),
    winRate: Number(winRate.toFixed(2)),
    winners: winners.length,
    losers: losers.length,
    averageUnrealizedPercent: Number(averageUnrealizedPercent.toFixed(2)),
    bestPerformer: bestPerformer
      ? {
          symbol: bestPerformer.symbol,
          unrealizedPercent: Number(bestPerformer.unrealized_plpc || 0) * 100,
          unrealizedProfit: Number(bestPerformer.unrealized_pl || 0),
        }
      : null,
    worstPerformer: worstPerformer
      ? {
          symbol: worstPerformer.symbol,
          unrealizedPercent: Number(worstPerformer.unrealized_plpc || 0) * 100,
          unrealizedProfit: Number(worstPerformer.unrealized_pl || 0),
        }
      : null,
  };
}

function calculateSelfHealingScanRecoveryEngine() {
  const now = Date.now();

  const lastScanTime = engineState.lastScanAt
    ? new Date(engineState.lastScanAt).getTime()
    : 0;

  const lastHeartbeatTime = engineState.lastHeartbeatAt
    ? new Date(engineState.lastHeartbeatAt).getTime()
    : 0;

  const scanAgeSeconds = lastScanTime
    ? Math.round((now - lastScanTime) / 1000)
    : null;

  const heartbeatAgeSeconds = lastHeartbeatTime
    ? Math.round((now - lastHeartbeatTime) / 1000)
    : null;

  const scanIsStale =
    scanAgeSeconds === null || scanAgeSeconds > 240;

  const heartbeatIsStale =
    heartbeatAgeSeconds === null || heartbeatAgeSeconds > 180;

  const engineAppearsStuck =
    engineState.running === true &&
    engineState.lastTickStartedAt &&
    now - Number(engineState.lastTickStartedAt) > 1000 * 60 * 4;

  let recoveryAction = "NO_ACTION";
  let recovered = false;

  if (engineAppearsStuck) {
    engineState.running = false;
    engineState.engineFreezeDetected = true;
    engineState.engineFreezeCount =
      Number(engineState.engineFreezeCount || 0) + 1;

    recoveryAction = "ENGINE_UNLOCKED";
    recovered = true;
  } else if (scanIsStale || heartbeatIsStale) {
    recoveryAction = "SCAN_STALE_MONITORING";
  }

  if (recovered) {
    engineState.lastScanRecoveryAt = new Date().toISOString();
  }

  const state = {
    updatedAt: new Date().toISOString(),
    scanAgeSeconds,
    heartbeatAgeSeconds,
    scanIsStale,
    heartbeatIsStale,
    engineAppearsStuck,
    recoveryAction,
    recovered,
    scanFailureCount: Number(engineState.scanFailureCount || 0),
    engineFreezeCount: Number(engineState.engineFreezeCount || 0),
  };

  engineState.selfHealingScanState = state;

  engineState.selfHealingScanHistory.unshift(state);
  engineState.selfHealingScanHistory =
    engineState.selfHealingScanHistory.slice(0, 200);

  return state;
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

function calculateBridgewaterMacroRiskEngine(
  signals = [],
  marketRegime = {},
  crashProtection = {},
  account = {}
) {
  const analyzedSignals = Array.isArray(signals) ? signals : [];

  const totalSignals = analyzedSignals.length;

  const averageScore =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.score || 0),
          0
        ) / totalSignals
      : 0;

  const averageRiskScore =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.riskScore || 50),
          0
        ) / totalSignals
      : 50;

  const averagePercentChange =
    totalSignals > 0
      ? analyzedSignals.reduce(
          (sum, signal) => sum + Number(signal.percentChange || 0),
          0
        ) / totalSignals
      : 0;

  const weakSignals = analyzedSignals.filter(
    (signal) => Number(signal.score || 0) < 50
  ).length;

  const highVolatilitySignals = analyzedSignals.filter(
    (signal) => Math.abs(Number(signal.percentChange || 0)) >= 15
  ).length;

  const liquidityStressSignals = analyzedSignals.filter(
    (signal) =>
      Number(signal.volume || 0) < CONFIG.minScanVolume ||
      Number(signal.confirmations?.volumeSpikeRatio || signal.volumeRatio || 0) < 0.75
  ).length;

  const weakSignalRatio =
    totalSignals > 0 ? weakSignals / totalSignals : 0;

  const volatilityStressRatio =
    totalSignals > 0 ? highVolatilitySignals / totalSignals : 0;

  const liquidityStressRatio =
    totalSignals > 0 ? liquidityStressSignals / totalSignals : 0;

  const macroStressScore = clampScore(
    weakSignalRatio * 25 +
      volatilityStressRatio * 25 +
      liquidityStressRatio * 20 +
      (averageRiskScore < 55 ? 15 : 0) +
      (averagePercentChange < -2 ? 10 : 0) +
      (marketRegime?.state === "panic/high volatility" ? 25 : 0) +
      Number(crashProtection?.crashRiskScore || 0) * 0.25
  );

  const macroMode =
    macroStressScore >= 80
      ? "CAPITAL_PRESERVATION"
      : macroStressScore >= 60
      ? "RISK_OFF"
      : macroStressScore >= 40
      ? "CAUTIOUS"
      : averageScore >= 75 && averageRiskScore >= 65
      ? "RISK_ON"
      : "NEUTRAL";

  const macroExposureMultiplier =
    macroMode === "CAPITAL_PRESERVATION"
      ? 0
      : macroMode === "RISK_OFF"
      ? 0.25
      : macroMode === "CAUTIOUS"
      ? 0.5
      : macroMode === "RISK_ON"
      ? 1
      : 0.75;

  const shouldBlockNewTrades =
    macroMode === "CAPITAL_PRESERVATION";

  return {
    updatedAt: new Date().toISOString(),
    macroMode,
    macroStressScore,
    macroExposureMultiplier,
    shouldBlockNewTrades,
    totalSignals,
    averageScore: Number(averageScore.toFixed(2)),
    averageRiskScore: Number(averageRiskScore.toFixed(2)),
    averagePercentChange: Number(averagePercentChange.toFixed(2)),
    weakSignalRatio: Number(weakSignalRatio.toFixed(2)),
    volatilityStressRatio: Number(volatilityStressRatio.toFixed(2)),
    liquidityStressRatio: Number(liquidityStressRatio.toFixed(2)),
    marketRegimeState: marketRegime?.state || "unknown",
    crashProtectionMode:
      crashProtection?.crashProtectionMode || "UNKNOWN",
    accountEquity: Number(account?.equity || 0),
    accountCash: Number(account?.cash || 0),
    macroReason:
      `Macro ${macroMode} • Stress ${macroStressScore}/100 • ` +
      `Exposure x${macroExposureMultiplier}`,
  };
}

function calculateCitadelTechnicalIntelligenceEngine(q = {}) {
  const price = Number(q.current || q.price || 0);
  const high = Number(q.high || price || 0);
  const low = Number(q.low || price || 0);
  const open = Number(q.open || price || 0);
  const previousClose = Number(q.previousClose || open || price || 0);
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const volumeRatio = Number(q.volumeRatio || q.confirmations?.volumeSpikeRatio || 0);

  const technicals = q.technicals || {};
  const ema9 = Number(technicals.ema9 || 0);
  const ema20 = Number(technicals.ema20 || 0);
  const rsi = Number(technicals.rsi || 50);
  const macd = Number(technicals.macd || 0);
  const macdSignal = Number(technicals.macdSignal || 0);

  const confirmations = q.confirmations || {};

  const range = Math.max(0.01, high - low);
  const closeLocationPercent =
    high > low ? ((price - low) / range) * 100 : 50;

  const pullbackFromHighPercent =
    high > 0 ? ((high - price) / high) * 100 : 0;

  const openToCloseStrength =
    open > 0 ? ((price - open) / open) * 100 : 0;

  const gapPercent =
    previousClose > 0
      ? ((open - previousClose) / previousClose) * 100
      : 0;

  const trendQualityScore = clampScore(
    45 +
      (ema9 > ema20 ? 20 : -10) +
      (macd > macdSignal ? 15 : -5) +
      (rsi >= 45 && rsi <= 70 ? 15 : 0) -
      (rsi > 78 ? 20 : 0) +
      (percentChange > 0 && percentChange <= 15 ? 10 : 0)
  );

  const breakoutQualityScore = clampScore(
    40 +
      (closeLocationPercent >= 75 ? 20 : 0) +
      (volumeRatio >= 1.5 ? 20 : volumeRatio >= 1 ? 10 : -10) +
      (openToCloseStrength > 0 ? 10 : -10) -
      (pullbackFromHighPercent > 3 ? 20 : 0) -
      (Math.abs(gapPercent) > CONFIG.maxGapUpPercent ? 20 : 0)
  );

  const executionTimingScore = clampScore(
    50 +
      (price > open ? 15 : -10) +
      (closeLocationPercent >= 65 ? 15 : 0) +
      (pullbackFromHighPercent <= 2 ? 10 : -10) +
      (rsi >= 50 && rsi <= 72 ? 10 : 0) -
      (percentChange > 25 ? 25 : 0)
  );

  const exhaustionRiskScore = clampScore(
    20 +
      (rsi > 75 ? 25 : 0) +
      (percentChange > 20 ? 25 : 0) +
      (pullbackFromHighPercent > 4 ? 20 : 0) +
      (volumeRatio < 0.75 ? 15 : 0) +
      (confirmations.fakeBreakout ? 35 : 0)
  );

  const institutionalEntryScore = clampScore(
    trendQualityScore * 0.3 +
      breakoutQualityScore * 0.25 +
      executionTimingScore * 0.25 +
      (100 - exhaustionRiskScore) * 0.2
  );

  const institutionalEntryGrade =
    institutionalEntryScore >= 85
      ? "A+ Institutional Entry"
      : institutionalEntryScore >= 75
      ? "A Quality Entry"
      : institutionalEntryScore >= 65
      ? "B Tactical Entry"
      : institutionalEntryScore >= 50
      ? "C Watch Only"
      : "D Avoid Entry";

  return {
    technicalScore: Number(institutionalEntryScore.toFixed(2)),
    trendQualityScore: Number(trendQualityScore.toFixed(2)),
    breakoutQualityScore: Number(breakoutQualityScore.toFixed(2)),
    executionTimingScore: Number(executionTimingScore.toFixed(2)),
    exhaustionRiskScore: Number(exhaustionRiskScore.toFixed(2)),
    institutionalEntryScore: Number(institutionalEntryScore.toFixed(2)),
    institutionalEntryGrade,
    closeLocationPercent: Number(closeLocationPercent.toFixed(2)),
    pullbackFromHighPercent: Number(pullbackFromHighPercent.toFixed(2)),
    openToCloseStrength: Number(openToCloseStrength.toFixed(2)),
    technicalReason:
      `${institutionalEntryGrade} • Trend ${trendQualityScore.toFixed(0)}/100 • ` +
      `Breakout ${breakoutQualityScore.toFixed(0)}/100 • ` +
      `Timing ${executionTimingScore.toFixed(0)}/100 • ` +
      `Exhaustion ${exhaustionRiskScore.toFixed(0)}/100`,
  };
}

function classifyInstitutionalSetup(signal = {}) {
  const score = Number(signal.score || 0);
  const orchestratorScore = Number(
  signal.institutionalOrchestrator
    ?.finalInstitutionalDecisionScore || score
);


  const technicalScore = Number(
    signal.technicalIntelligence?.institutionalEntryScore ||
      signal.technicalScore ||
      0
  );

  const statisticalScore = Number(
    signal.statisticalScore ||
      signal.statisticalEdgeScore ||
      signal.statisticalEdge?.statisticalEdgeScore ||
      0
  );

  const momentumScore = Number(
    signal.momentumScore || score || 0
  );

  const volumeRatio = Number(
    signal.confirmations?.volumeSpikeRatio ||
      signal.volumeRatio ||
      0
  );

  if (
    momentumScore >= 85 &&
    technicalScore >= 75 &&
    volumeRatio >= 1.5
  ) {
    return "MOMENTUM_BREAKOUT";
  }

  if (
    statisticalScore >= 70 &&
    technicalScore >= 65
  ) {
    return "STATISTICAL_EDGE";
  }

  if (
    momentumScore >= 60 &&
    technicalScore >= 60
  ) {
    return "TREND_CONTINUATION";
  }

  if (
    technicalScore < 40 &&
    momentumScore < 40
  ) {
    return "WEAK_STRUCTURE";
  }

  return "GENERAL_SETUP";
}

function calculateCryptoSignalRealismEngine(signal = {}) {
  const symbol = normalizeSymbol(signal.symbol);
  const rawScore = Number(signal.score || 0);
  const barsFound = Number(signal.barsFound || 0);
  const bid = Number(signal.bid || 0);
  const ask = Number(signal.ask || 0);
  const price = Number(signal.current || signal.price || 0);

  const isCrypto =
    signal.assetClass === "crypto" ||
    signal.asset_class === "crypto" ||
    symbol.includes("/");

  if (!isCrypto) {
    return {
      realismScore: rawScore,
      cryptoRiskPenalty: 0,
      cryptoRealismReason: "Non-crypto signal",
    };
  }

  const spreadPercent =
    bid > 0 && ask > 0 ? ((ask - bid) / ask) * 100 : 1;
 
const stableBehaviorDetected =
  Math.abs(
    Number(
      signal.percent_change_24h ||
        signal.changePercent ||
        signal.percentChange ||
        0
    )
  ) <= 0.35 &&
  spreadPercent <= 0.12;

const memeOrUltraSpeculative =
  price < 0.01 ||
  spreadPercent >= 0.7 ||
  barsFound < 15;

  const weakHistoryPenalty = barsFound < 30 ? 10 : 0;
  const spreadPenalty =
    spreadPercent >= 0.75 ? 20 : spreadPercent >= 0.35 ? 10 : 0;
 const stableBehaviorPenalty =
  stableBehaviorDetected ? 45 : 0;

const memePenalty =
  memeOrUltraSpeculative ? 12 : 0;
  const noStatPenalty =
    Number(signal.statisticalScore || signal.statisticalEdgeScore || 0) <= 0
      ? 10
      : 0;

const cryptoRiskPenalty =
  weakHistoryPenalty +
  spreadPenalty +
  stableBehaviorPenalty +
  memePenalty +
  noStatPenalty;

  const realismScore = clampScore(rawScore - cryptoRiskPenalty);

  return {
    realismScore,
    cryptoRiskPenalty,
    spreadPercent: Number(spreadPercent.toFixed(3)),
    memeOrUltraSpeculative,
    cryptoRealismReason:
      `Crypto realism ${realismScore}/100 • ` +
      `Penalty ${cryptoRiskPenalty} • Spread ${spreadPercent.toFixed(3)}%`,
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

    const technicalScore = Number(
      signal.technicalIntelligence?.institutionalEntryScore ||
        signal.technicalScore ||
        0
    );

    const statisticalScore = Number(
      signal.statisticalScore ||
        signal.statisticalEdgeScore ||
        signal.statisticalEdge?.statisticalEdgeScore ||
        0
    );

    const barsFound = Number(signal.barsFound || signal.confirmations?.barsFound || 0);

    const microTrend =
      percentChange > 0.25 && technicalScore >= 60
        ? "BULLISH"
        : percentChange < -1.5
        ? "BEARISH"
        : "NEUTRAL";

    const intradayTrend =
      volumeRatio >= 1 && technicalScore >= 65
        ? "BULLISH"
        : technicalScore < 45
        ? "BEARISH"
        : "NEUTRAL";

    const higherTimeframeTrend =
      barsFound >= 20 && statisticalScore >= 60 && score >= 70
        ? "BULLISH"
        : statisticalScore > 0 && statisticalScore < 40
        ? "BEARISH"
        : "NEUTRAL";

    const alignedBullish =
      microTrend === "BULLISH" &&
      intradayTrend === "BULLISH" &&
      higherTimeframeTrend === "BULLISH";

    const partialBullish =
      [microTrend, intradayTrend, higherTimeframeTrend].filter(
        (trend) => trend === "BULLISH"
      ).length === 2;

    const alignedBearish =
      microTrend === "BEARISH" &&
      intradayTrend === "BEARISH";

    const timeframeConflict =
      [microTrend, intradayTrend, higherTimeframeTrend].includes("BULLISH") &&
      [microTrend, intradayTrend, higherTimeframeTrend].includes("BEARISH");

    const timeframeConfidenceScore = clampScore(
      35 +
        (alignedBullish ? 40 : 0) +
        (partialBullish ? 18 : 0) -
        (alignedBearish ? 30 : 0) -
        (timeframeConflict ? 25 : 0) +
        technicalScore * 0.15 +
        statisticalScore * 0.15
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
      technicalScore,
      statisticalScore,
      barsFound,
      microTrend,
      intradayTrend,
      higherTimeframeTrend,
      alignedBullish,
      partialBullish,
      alignedBearish,
      timeframeConflict,
      timeframeConfidenceScore: Number(timeframeConfidenceScore.toFixed(2)),
      timeframeDecision,
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    alignedSignals: analyzedSignals.filter((s) => s.alignedBullish).length,
    partiallyAlignedSignals: analyzedSignals.filter((s) => s.partialBullish).length,
    conflictedSignals: analyzedSignals.filter((s) => s.timeframeConflict).length,
    topAlignedSignals: analyzedSignals
      .sort((a, b) => b.timeframeConfidenceScore - a.timeframeConfidenceScore)
      .slice(0, 10),
  };
}

function calculateBlackRockPortfolioOptimizer(
  account,
  openPositions = [],
  signals = []
) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);

  const positions = Array.isArray(openPositions)
    ? openPositions
    : [];

  const analyzedSignals = Array.isArray(signals)
    ? signals
    : [];

  const totalExposure = positions.reduce(
    (sum, position) =>
      sum + Math.abs(Number(position.market_value || 0)),
    0
  );

  const exposurePercent =
    equity > 0
      ? (totalExposure / equity) * 100
      : 0;

  const sectorMap = {};

  for (const position of positions) {
    const sector =
      estimateSectorIntelligence({
        symbol: position.symbol,
        current:
          Number(position.current_price || 0),
      }).estimatedSector || "General Market";

    if (!sectorMap[sector]) {
      sectorMap[sector] = {
        sector,
        exposure: 0,
        positions: 0,
      };
    }

    sectorMap[sector].positions += 1;

    sectorMap[sector].exposure += Math.abs(
      Number(position.market_value || 0)
    );
  }

  const sectorDiversification = Object.values(sectorMap);

  const concentrationRiskScore = clampScore(
    100 -
      sectorDiversification.reduce(
        (sum, sector) =>
          sum +
          (sector.positions >= 2 ? 18 : 0),
        0
      ) -
      (exposurePercent > CONFIG.maxBotExposurePercent
        ? 40
        : 0)
  );

  const diversificationScore = clampScore(
    45 +
      sectorDiversification.length * 12 -
      (positions.length >= CONFIG.maxOpenTrades
        ? 15
        : 0)
  );

  const liquidityReserveScore = clampScore(
    equity > 0
      ? (cash / equity) * 100
      : 0
  );

  const portfolioEfficiencyScore = clampScore(
    concentrationRiskScore * 0.35 +
      diversificationScore * 0.35 +
      liquidityReserveScore * 0.3
  );

  const optimizerMode =
    portfolioEfficiencyScore >= 80
      ? "MAX_EFFICIENCY"
      : portfolioEfficiencyScore >= 65
      ? "BALANCED"
      : portfolioEfficiencyScore >= 50
      ? "DEFENSIVE"
      : "RISK_REDUCTION";

  const rebalanceRequired =
    concentrationRiskScore < 45 ||
    exposurePercent >
      CONFIG.maxBotExposurePercent;

  const topSignals = analyzedSignals
    .slice(0, 5)
    .map((signal) => {
      const directTechnicalScore = Number(
        signal.technicalIntelligence?.institutionalEntryScore ||
          signal.technicalScore ||
          0
      );

      const fallbackTechnicalScore =
        directTechnicalScore > 0
          ? directTechnicalScore
          : clampScore(
              Number(signal.score || 0) * 0.75 +
           (Number(signal.barsFound || 0) >= 30
  ? 15
  : Number(signal.barsFound || 0) >= 20
  ? 10
  : Number(signal.barsFound || 0) >= 10
  ? 5
  : 0) +
                (signal.qualifiedToBuy !== false ? 10 : -15)
            );

      return {
        symbol: signal.symbol,
        score: signal.score,
        technicalScore: fallbackTechnicalScore,
        portfolioRole:
          signal.portfolioRole || "Momentum Candidate",
      };
    });
  return {
    updatedAt: new Date().toISOString(),
    optimizerMode,
    rebalanceRequired,
    portfolioEfficiencyScore:
      Number(
        portfolioEfficiencyScore.toFixed(2)
      ),

    concentrationRiskScore:
      Number(
        concentrationRiskScore.toFixed(2)
      ),

    diversificationScore:
      Number(diversificationScore.toFixed(2)),

    liquidityReserveScore:
      Number(
        liquidityReserveScore.toFixed(2)
      ),

    totalExposure:
      Number(totalExposure.toFixed(2)),

    exposurePercent:
      Number(exposurePercent.toFixed(2)),

    sectorDiversification,

    topSignals,

    optimizerReason:
      `${optimizerMode} • Efficiency ${portfolioEfficiencyScore}/100 • ` +
      `Diversification ${diversificationScore}/100 • ` +
      `Concentration ${concentrationRiskScore}/100`,
  };
}

function calculateStatisticalExpectancyEngine(signal = {}) {
  const setupType =
    signal.setupType ||
    classifyInstitutionalSetup(signal);

  const setupHistory =
    engineState.statisticalMemoryState?.setupHistory || [];

  const matchingHistory = setupHistory.filter(
    (item) => item.setupType === setupType
  );

if (matchingHistory.length < 5) {
  const score = Number(signal.realismAdjustedScore || signal.score || 0);

  const technicalScore = Number(
    signal.technicalIntelligence?.institutionalEntryScore ||
      signal.technicalScore ||
      0
  );

  const spreadPercent = Number(
    signal.cryptoRealism?.spreadPercent || 0
  );

  const bootstrapConfidence = clampScore(
    score * 0.35 +
      technicalScore * 0.25 +
      (spreadPercent <= 0.25 ? 20 : spreadPercent <= 0.5 ? 10 : -10) +
      (setupType === "MOMENTUM_BREAKOUT" ? 15 : 0) +
      (setupType === "TREND_CONTINUATION" ? 10 : 0)
  );

  return {
    setupType,
    expectedValue:
      bootstrapConfidence >= 75
        ? 1.25
        : bootstrapConfidence >= 65
        ? 0.65
        : 0,
    winRate:
      bootstrapConfidence >= 75
        ? 58
        : bootstrapConfidence >= 65
        ? 52
        : 0,
    averageWin:
      bootstrapConfidence >= 65 ? 3 : 0,
    averageLoss:
      bootstrapConfidence >= 65 ? 2 : 0,
    statisticalConfidence: bootstrapConfidence,
    sampleSize: matchingHistory.length,
    expectancyState:
      bootstrapConfidence >= 75
        ? "BOOTSTRAP_POSITIVE_EXPECTANCY"
        : bootstrapConfidence >= 65
        ? "BOOTSTRAP_WATCHLIST_EXPECTANCY"
        : "INSUFFICIENT_DATA",
  };
}

  const wins = matchingHistory.filter(
    (item) => Number(item.profitPercent || 0) > 0
  );

  const losses = matchingHistory.filter(
    (item) => Number(item.profitPercent || 0) <= 0
  );

  const averageWin =
    wins.length > 0
      ? wins.reduce(
          (sum, item) =>
            sum + Number(item.profitPercent || 0),
          0
        ) / wins.length
      : 0;

  const averageLoss =
    losses.length > 0
      ? Math.abs(
          losses.reduce(
            (sum, item) =>
              sum + Number(item.profitPercent || 0),
            0
          ) / losses.length
        )
      : 0;

  const winRate =
    matchingHistory.length > 0
      ? wins.length / matchingHistory.length
      : 0;

  const expectedValue =
    (winRate * averageWin) -
    ((1 - winRate) * averageLoss);

  const statisticalConfidence = clampScore(
    matchingHistory.length * 4
  );

  return {
    setupType,
    expectedValue: Number(expectedValue.toFixed(2)),
    winRate: Number((winRate * 100).toFixed(2)),
    averageWin: Number(averageWin.toFixed(2)),
    averageLoss: Number(averageLoss.toFixed(2)),
    sampleSize: matchingHistory.length,
    statisticalConfidence,
    expectancyState:
      expectedValue > 0
        ? "POSITIVE_EXPECTANCY"
        : "NEGATIVE_EXPECTANCY",
  };
}

function calculateDynamicProbabilityReinforcementEngine(
  signal = {},
  statisticalExpectancy = {}
) {
  const setupType =
    statisticalExpectancy.setupType ||
    signal.setupType ||
    classifyInstitutionalSetup(signal);

  if (!engineState.probabilityReinforcementState) {
    engineState.probabilityReinforcementState = {
      updatedAt: null,
      setupTrust: {},
    };
  }

  if (!Array.isArray(engineState.probabilityReinforcementHistory)) {
    engineState.probabilityReinforcementHistory = [];
  }

  const setupHistory =
    engineState.statisticalMemoryState?.setupHistory || [];

  const matchingHistory = setupHistory.filter(
    (item) => item.setupType === setupType
  );

  const recentHistory = matchingHistory.slice(0, 20);

  const wins = recentHistory.filter(
    (item) => Number(item.profitPercent || 0) > 0
  );

  const losses = recentHistory.filter(
    (item) => Number(item.profitPercent || 0) <= 0
  );

  const runnerWins = recentHistory.filter(
    (item) =>
      Number(item.profitPercent || 0) >=
      Number(CONFIG.runnerTriggerPercent || 6)
  );

  const previousTrust =
    engineState.probabilityReinforcementState.setupTrust[setupType] || {};

  const previousProbability = Number(
    previousTrust.reinforcedProbability ||
      statisticalExpectancy.winRate ||
      50
  );

  const baseProbability = Number(
    statisticalExpectancy.winRate ||
      (wins.length / Math.max(1, recentHistory.length)) * 100 ||
      50
  );

  const recentWinRate =
    recentHistory.length > 0
      ? (wins.length / recentHistory.length) * 100
      : baseProbability;

  const runnerReinforcement =
    recentHistory.length > 0
      ? (runnerWins.length / recentHistory.length) * 12
      : 0;

  const lossPressure =
    recentHistory.length > 0
      ? (losses.length / recentHistory.length) * 10
      : 0;

  const lastSetupAt = matchingHistory[0]?.timestamp
    ? new Date(matchingHistory[0].timestamp).getTime()
    : 0;

  const hoursSinceLastSetup = lastSetupAt
    ? (Date.now() - lastSetupAt) / 1000 / 60 / 60
    : 999;

  const probabilityDecay = clampScore(
    hoursSinceLastSetup > 72
      ? 15
      : hoursSinceLastSetup > 24
      ? 8
      : hoursSinceLastSetup > 8
      ? 4
      : 0
  );

  const adaptiveTrustWeight = Number(
    (
      1 +
      (recentWinRate - 50) / 200 +
      runnerReinforcement / 100 -
      lossPressure / 100 -
      probabilityDecay / 200
    ).toFixed(2)
  );

  const reinforcedProbability = clampScore(
    baseProbability * adaptiveTrustWeight +
      runnerReinforcement -
      lossPressure -
      probabilityDecay
  );

  const confidenceDrift = Number(
    (reinforcedProbability - previousProbability).toFixed(2)
  );

  const reinforcedExpectedValue = Number(
    (
      Number(statisticalExpectancy.expectedValue || 0) *
        adaptiveTrustWeight +
      runnerReinforcement * 0.08 -
      lossPressure * 0.08 -
      probabilityDecay * 0.05
    ).toFixed(2)
  );

  const reinforcementMode =
    reinforcedProbability >= 70 && confidenceDrift >= 3
      ? "REINFORCING"
      : reinforcedProbability >= 60
      ? "TRUSTED"
      : confidenceDrift <= -8 || reinforcedProbability < 45
      ? "WEAKENING"
      : probabilityDecay > 0
      ? "DECAYING"
      : "NEUTRAL";

  const state = {
    updatedAt: new Date().toISOString(),
    symbol: signal.symbol,
    setupType,
    baseProbability: Number(baseProbability.toFixed(2)),
    reinforcedProbability,
    confidenceDrift,
    probabilityDecay,
    adaptiveTrustWeight,
    reinforcedExpectedValue,
    recentSampleSize: recentHistory.length,
    recentWinRate: Number(recentWinRate.toFixed(2)),
    runnerWins: runnerWins.length,
    losses: losses.length,
    reinforcementMode,
  };

  engineState.probabilityReinforcementState.updatedAt = state.updatedAt;
  engineState.probabilityReinforcementState.setupTrust[setupType] = state;

  engineState.probabilityReinforcementHistory.unshift(state);
  engineState.probabilityReinforcementHistory =
    engineState.probabilityReinforcementHistory.slice(0, 200);

  return state;
}

function calculateInstitutionalAiPortfolioOrchestrator(signal = {}) {
  const institutionalScore = Number(
    signal.institutionalScore || signal.score || 0
  );

  const orchestratorStatisticalScore = Number(
    signal.totalStatisticalScore ||
      signal.statisticalScore ||
      signal.statisticalEdgeScore ||
      signal.statisticalEdge?.statisticalEdgeScore ||
      0
  );

  const technicalScore = Number(
    signal.technicalIntelligence?.institutionalEntryScore ||
      signal.technicalScore ||
      signal.score ||
      0
  );

  const macroScore = Number(
    engineState.macroRiskState?.macroStressScore ?? 50
  );

  const portfolioScore = Number(
    signal.portfolioScore ||
      engineState.portfolioOptimizationState?.portfolioEfficiencyScore ||
      0
  );

  const earningsScore = Number(signal.earningsScore || 0);

  const moatScore = Number(
    signal.competitiveAdvantageScore ||
      signal.moatScore ||
      0
  );

  const dividendScore = Number(
    signal.harvardDividendScore ||
      signal.longTermWealthScore ||
      signal.wealthBuilderScore ||
      signal.dividendScore ||
      0
  );

  const wealthScore = dividendScore;

  const dcfScore = Number(
    signal.dcfValuationScore ||
      signal.dcfScore ||
      0
  );

  const riskScore = Number(
    signal.institutionalRiskScore ||
      signal.riskScore ||
      50
  );

  const exhaustionRisk = Number(
    signal.exhaustionRiskScore ||
      signal.technicalIntelligence?.exhaustionRiskScore ||
      0
  );

  const valuationRisk = Number(signal.valuationRiskScore || 0);

  const earningsRisk = Number(
    signal.earningsVolatilityRiskScore || 0
  );

  const momentumScore = Number(
    signal.momentumScore ||
      signal.score ||
      0
  );

  const macroPenalty =
    engineState.macroRiskState?.shouldBlockNewTrades
      ? 60
      : macroScore >= 80
      ? 20
      : macroScore >= 60
      ? 12
      : macroScore >= 40
      ? 6
      : 0;

  const portfolioPenalty =
    engineState.portfolioOptimizationState?.rebalanceRequired
      ? 8
      : 0;

  const assetClass =
    signal.assetClass || signal.asset_class || "stock";

  const isCryptoSignal =
    assetClass === "crypto" ||
    String(signal.symbol || "").includes("/") ||
    TRADING_MODE === "live_crypto";

  const cryptoAdaptiveOpportunityScore =
    isCryptoSignal
      ? clampScore(
          technicalScore * 0.35 +
            orchestratorStatisticalScore * 0.2 +
            momentumScore * 0.25 +
            portfolioScore * 0.1 +
            riskScore * 0.1
        )
      : 0;

const statisticalExpectancy =
  calculateStatisticalExpectancyEngine(signal);

const probabilityReinforcement =
  calculateDynamicProbabilityReinforcementEngine(
    signal,
    statisticalExpectancy
  );


const reinforcementConfidenceBonus =
  probabilityReinforcement.reinforcedProbability >= 80
    ? 8
    : probabilityReinforcement.reinforcedProbability >= 70
    ? 5
    : probabilityReinforcement.reinforcedProbability >= 60
    ? 2
    : probabilityReinforcement.reinforcedProbability < 45
    ? -8
    : 0;

const reinforcementDriftAdjustment =
  probabilityReinforcement.confidenceDrift >= 10
    ? 6
    : probabilityReinforcement.confidenceDrift >= 5
    ? 3
    : probabilityReinforcement.confidenceDrift <= -10
    ? -8
    : probabilityReinforcement.confidenceDrift <= -5
    ? -4
    : 0;
    
const expectancyBoost =
  probabilityReinforcement.reinforcedExpectedValue > 0
    ? Math.min(
        probabilityReinforcement.reinforcedExpectedValue * 2,
        18
      )
    : Math.max(
        probabilityReinforcement.reinforcedExpectedValue * 2,
        -22
      );

const institutionalOpportunityScore =
  isCryptoSignal
    ? clampScore(
        technicalScore * 0.22 +
          orchestratorStatisticalScore * 0.22 +
          momentumScore * 0.18 +
          portfolioScore * 0.08 +
          riskScore * 0.08 +
          expectancyBoost +
          statisticalExpectancy.statisticalConfidence * 0.08
      )
    : clampScore(
        technicalScore * 0.16 +
          macroScore * 0.08 +
          orchestratorStatisticalScore * 0.18 +
          dcfScore * 0.12 +
          earningsScore * 0.1 +
          moatScore * 0.1 +
          dividendScore * 0.05 +
          portfolioScore * 0.12 +
          expectancyBoost +
          statisticalExpectancy.statisticalConfidence * 0.09
      );

  const institutionalRiskPenalty = isCryptoSignal
    ? clampScore(
        macroPenalty * 0.45 +
          portfolioPenalty * 0.5 +
          exhaustionRisk * 0.12 +
          (riskScore < 40 ? 8 : 0)
      )
    : clampScore(
        macroPenalty +
          portfolioPenalty +
          exhaustionRisk * 0.15 +
          valuationRisk * 0.15 +
          earningsRisk * 0.12 +
          (riskScore < 50 ? 20 : 0)
      );

  const missingStatisticalPenalty =
    orchestratorStatisticalScore <= 0 ? 18 : 0;

  const timeframePenalty =
    signal.timeframeDecision === "WEAK_CONFIRMATION"
      ? 12
      : signal.timeframeDecision === "TIMEFRAME_CONFLICT"
      ? 25
      : 0;
  const finalInstitutionalDecisionScore = clampScore(
    institutionalOpportunityScore * 0.82 +
      (100 - institutionalRiskPenalty) * 0.18 -
      missingStatisticalPenalty -
      timeframePenalty +
      + reinforcementConfidenceBonus +
      reinforcementDriftAdjustment
  );

  const highConvictionThreshold = isCryptoSignal ? 72 : 78;
  const controlledThreshold = isCryptoSignal ? 62 : 68;
  const tacticalThreshold = isCryptoSignal ? 50 : 55;
  const watchlistThreshold = isCryptoSignal ? 38 : 42;

  const orchestratorAction =
    engineState.macroRiskState?.shouldBlockNewTrades
      ? "BLOCKED_BY_MACRO_RISK"
      : finalInstitutionalDecisionScore >= highConvictionThreshold
      ? "DEPLOY_HIGH_CONVICTION"
      : finalInstitutionalDecisionScore >= controlledThreshold
      ? "DEPLOY_CONTROLLED"
      : finalInstitutionalDecisionScore >= tacticalThreshold
      ? "SMALL_TACTICAL"
      : finalInstitutionalDecisionScore >= watchlistThreshold
      ? "WATCHLIST_ONLY"
      : "AVOID";

  const orchestratorMultiplier =
    orchestratorAction === "DEPLOY_HIGH_CONVICTION"
      ? 1
      : orchestratorAction === "DEPLOY_CONTROLLED"
      ? 0.8
      : orchestratorAction === "SMALL_TACTICAL"
      ? 0.5
      : orchestratorAction === "WATCHLIST_ONLY"
      ? 0.15
      : 0;

  return {
    symbol: signal.symbol,
    assetClass,
    isCryptoSignal,
    institutionalOpportunityScore,
    institutionalRiskPenalty,
    finalInstitutionalDecisionScore,
    statisticalExpectancy,
    probabilityReinforcement,
    orchestratorAction,
    orchestratorMultiplier,
    engineScores: {
      institutionalScore,
      technicalScore,
      totalStatisticalScore: orchestratorStatisticalScore,
      riskScore,
      earningsScore,
      moatScore,
      wealthScore,
      dcfScore,
      portfolioScore,
      macroStressScore: macroScore,
    },
    riskInputs: {
      exhaustionRisk,
      valuationRisk,
      earningsRisk,
      macroPenalty,
      portfolioPenalty,
      missingStatisticalPenalty,
      timeframePenalty,
    },
    orchestratorReason:
      `${orchestratorAction} • Final ${finalInstitutionalDecisionScore}/100 • ` +
      `Opportunity ${institutionalOpportunityScore}/100 • Penalty ${institutionalRiskPenalty}/100`,
  };
}
function passesInstitutionalOrchestratorBuyGate(signal = {}) {
  const orchestrator =
    signal.institutionalOrchestrator ||
    calculateInstitutionalAiPortfolioOrchestrator(signal);

  const finalScore = Number(
    orchestrator.finalInstitutionalDecisionScore || 0
  );

  const action = orchestrator.orchestratorAction || "WATCH";

  const symbolUpper = normalizeSymbol(signal.symbol);

  const isCrypto =
    signal.assetClass === "crypto" ||
    signal.asset_class === "crypto" ||
    symbolUpper.includes("/");

  const isSpeculativeMeme =
    symbolUpper.includes("SHIB") ||
    symbolUpper.includes("BONK") ||
    symbolUpper.includes("PEPE") ||
    symbolUpper.includes("TRUMP");

  const statisticalScore =
    Number(signal.statisticalScore || 0) +
    Number(signal.statisticalEdgeScore || 0) +
    Number(signal.statisticalEdge?.statisticalEdgeScore || 0);

  const timeframeDecision =
    signal.timeframeDecision ||
    signal.multiTimeframe?.timeframeDecision ||
    "WEAK_CONFIRMATION";

  const blockedActions = [
    "AVOID",
    "BLOCK",
    "BLOCK_TRADE",
    "CAPITAL_PRESERVATION",
  ];

    const reinforcementMode =
    orchestrator.probabilityReinforcement?.reinforcementMode ||
    "NEUTRAL";

  const reinforcedProbability = Number(
    orchestrator.probabilityReinforcement?.reinforcedProbability || 50
  );

  const confidenceDrift = Number(
    orchestrator.probabilityReinforcement?.confidenceDrift || 0
  );

  if (
    reinforcementMode === "WEAKENING" ||
    (reinforcedProbability < 45 && confidenceDrift <= -5)
  ) {
    return {
      allowed: false,
      reason:
        `Probability reinforcement blocked: ${reinforcementMode} ` +
        `${reinforcedProbability}/100 drift ${confidenceDrift}`,
      orchestrator,
    };
  }

  if (blockedActions.includes(action)) {
    return {
      allowed: false,
      reason: `Orchestrator blocked: ${action}`,
      orchestrator,
    };
  }

if (
  isSpeculativeMeme &&
  (
    Number(signal.statisticalScore || 0) +
    Number(signal.statisticalEdgeScore || 0) +
    Number(signal.statisticalEdge?.statisticalEdgeScore || 0)
  ) <= 0
){
    return {
      allowed: false,
      reason: "Speculative meme crypto blocked: no statistical confirmation",
      orchestrator,
    };
  }

  if (isCrypto && timeframeDecision === "TIMEFRAME_CONFLICT") {
    return {
      allowed: false,
      reason: "Crypto blocked: timeframe conflict",
      orchestrator,
    };
  }

  if (isCrypto && timeframeDecision === "WEAK_CONFIRMATION" && finalScore < 75) {
    return {
      allowed: false,
      reason: `Crypto weak timeframe confirmation: ${finalScore}/100`,
      orchestrator,
    };
  }

 if (
  isCrypto &&
  (
    Number(signal.statisticalScore || 0) +
    Number(signal.statisticalEdgeScore || 0) +
    Number(signal.statisticalEdge?.statisticalEdgeScore || 0)
  ) <= 0 &&
  finalScore < 78
) {
    return {
      allowed: false,
      reason: `Crypto missing statistical edge: ${finalScore}/100`,
      orchestrator,
    };
  }

  if (finalScore < 65) {
    return {
      allowed: false,
      reason: `Orchestrator score too low: ${finalScore}`,
      orchestrator,
    };
  }

  return {
    allowed: true,
    reason: `Orchestrator approved: ${action} ${finalScore}/100`,
    orchestrator,
  };
}

function passesAutonomousParliamentGate(signal = {}) {
  const system =
    engineState.autonomousTradingSystemState || {};

  const phase20 =
    engineState.phase20AutonomousOrchestrationState || {};

  const phase21 =
    engineState.phase21AutonomousBrainState || {};

  if (!system.updatedAt) {
    return {
      allowed: true,
      multiplier: 1,
      reason: "Autonomous parliament not initialized yet",
    };
  }

  if (
    system.shouldBlockNewTrades ||
    phase20.shouldBlockNewTrades ||
    phase21.shouldBlockNewTrades
  ) {
    return {
      allowed: false,
      multiplier: 0,
      reason:
        phase21.reason ||
        phase20.reason ||
        system.finalSystemReason ||
        "Autonomous parliament blocked new trades",
    };
  }

  const decision =
    system.capitalParliamentDecision || "WATCHLIST_ONLY";

  const score = Number(signal.score || 0);

  if (decision === "AUTONOMOUS_REJECTION") {
    return {
      allowed: false,
      multiplier: 0,
      reason: system.finalSystemReason || "Autonomous rejection",
    };
  }

  if (decision === "WATCHLIST_ONLY" && score < 90) {
    return {
      allowed: false,
      multiplier: 0,
      reason: "Parliament watchlist-only mode requires 90+ score",
    };
  }

  const multiplier = Number(
    (
      Number(system.autonomousCapitalMultiplier || 1) *
      Number(phase20.orchestrationMultiplier || 1) *
      Number(phase21.capitalMultiplier || 1)
    ).toFixed(2)
  );

  return {
    allowed: multiplier > 0,
    multiplier,
    reason:
      phase21.reason ||
      phase20.reason ||
      system.finalSystemReason ||
      `Parliament approved: ${decision}`,
    phase20,
    phase21,
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
  const compoundingBudget =
  Number(
    engineState.capitalCompoundingState
      ?.remainingCompoundedBudget || 0
  );

const effectiveRemainingBotBudget =
  compoundingBudget > 0
    ? Math.min(remainingBotBudget, compoundingBudget)
    : remainingBotBudget;

if (effectiveRemainingBotBudget <= 0) return 0;

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
   Math.min(
  scoreAdjustedTradeMax,
  effectiveRemainingBotBudget,
  cash,
  buyingPower || cash
)
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
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    symbol
  )}&token=${FINNHUB_API_KEY}`;

  const res = await fetch(url);

  markApiHealth("finnhubQuote", true);

  const data = await res.json();

  if (!res.ok || !data || typeof data.c !== "number") {
    engineState.apiFailureCounts.finnhubQuote =
      (engineState.apiFailureCounts.finnhubQuote || 0) + 1;
engineState.apiCooldowns.finnhubQuote =
  Date.now() + 1000 * 60;
    markApiHealth(
      "finnhubQuote",
      false,
      `Quote failed for ${symbol}`
    );

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

const alpacaOpen = Number(
  firstBar.o || latestBar.o || 0
);

const alpacaHigh = Math.max(
  ...bars.map((b) => Number(b.h || 0)),
  0
);

const dollarVolume =
  Number(barStats.lastVolume || barStats.avgVolume || 0) *
  alpacaCurrent;

const alpacaLow = Math.min(
  ...bars.map((b) => Number(b.l || Infinity))
);

const safeAlpacaLow = Number.isFinite(alpacaLow)
  ? alpacaLow
  : 0;

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

  const statisticalEdge =
  calculateRenaissanceStatisticalEdgeEngine(q);

q.statisticalEdge = statisticalEdge;
q.statisticalScore =
  statisticalEdge.statisticalEdgeScore;

if (statisticalEdge.statisticalEdgeScore >= 85) score += 12;
else if (statisticalEdge.statisticalEdgeScore >= 70) score += 8;
else if (statisticalEdge.statisticalEdgeScore < 45) score -= 12;

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

function calculateRenaissanceStatisticalEdgeEngine(q) {
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const volumeRatio = Number(
    q.confirmations?.volumeSpikeRatio ||
      q.volumeRatio ||
      0
  );

  const rsi = Number(q.technicals?.rsi || 50);
  const macd = Number(q.technicals?.macd || 0);
  const macdSignal = Number(q.technicals?.macdSignal || 0);

  const trendPersistenceScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 12 ? 20 : 0) -
      (percentChange > 25 ? 25 : 0) +
      (macd > macdSignal ? 15 : -10)
  );

  const volumeAnomalyScore = clampScore(
    45 +
      (volumeRatio >= 1.5 ? 25 : 0) +
      (volumeRatio >= 2 ? 15 : 0) +
      (volume >= CONFIG.minVolume ? 10 : -10)
  );

  const meanReversionRiskScore = clampScore(
    100 -
      (rsi > 80 ? 35 : 0) -
      (percentChange > 35 ? 30 : 0) -
      (q.confirmations?.fakeBreakout ? 35 : 0)
  );

  const statisticalEdgeScore = clampScore(
    trendPersistenceScore * 0.35 +
      volumeAnomalyScore * 0.3 +
      meanReversionRiskScore * 0.35
  );

  const statisticalEdgeLabel =
    statisticalEdgeScore >= 85
      ? "High Probability Edge"
      : statisticalEdgeScore >= 70
      ? "Positive Statistical Edge"
      : statisticalEdgeScore >= 55
      ? "Neutral Edge"
      : "Weak Statistical Edge";

  return {
    statisticalEdgeScore,
    statisticalEdgeLabel,
    trendPersistenceScore,
    volumeAnomalyScore,
    meanReversionRiskScore,
  };
}

function estimateAtrStyleVolatility(signal = {}) {
  const price = Number(
    signal.current ||
      signal.price ||
      signal.currentPrice ||
      0
  );

  const high = Number(signal.high || price || 0);
  const low = Number(signal.low || price || 0);
  const percentChange = Math.abs(
    Number(signal.percentChange || 0)
  );

  const intradayRangePercent =
    price > 0 && high > low
      ? ((high - low) / price) * 100
      : percentChange;

  const atrStyleVolatilityPercent = Math.max(
    intradayRangePercent,
    percentChange
  );

  const volatilityScore = clampScore(
    atrStyleVolatilityPercent * 8
  );

  const volatilityRegime =
    atrStyleVolatilityPercent >= 10
      ? "EXTREME_VOLATILITY"
      : atrStyleVolatilityPercent >= 6
      ? "HIGH_VOLATILITY"
      : atrStyleVolatilityPercent >= 3
      ? "NORMAL_VOLATILITY"
      : "LOW_VOLATILITY";

  return {
    atrStyleVolatilityPercent: Number(
      atrStyleVolatilityPercent.toFixed(2)
    ),
    intradayRangePercent: Number(
      intradayRangePercent.toFixed(2)
    ),
    volatilityScore,
    volatilityRegime,
  };
}
function calculateAdaptiveSwingRisk(signal = {}, context = {}) {
  const assetType =
    signal.assetType ||
    context.assetType ||
    (String(signal.symbol || "").includes("/") ? "crypto" : "stock");

  const score = Number(signal.score || 0);
  const technicalScore = Number(signal.technicalScore || signal.technical?.score || 0);
  const statisticalScore = Number(signal.statisticalScore || 0);
  const trendPersistenceScore = Number(signal.trendPersistenceScore || 0);
 const atrStyleVolatility = estimateAtrStyleVolatility(signal);

const volatilityScore = Number(
  signal.volatilityScore ||
    signal.volatility ||
    atrStyleVolatility.volatilityScore ||
    0
);
  let stopLossPercent = CONFIG.stopLossPercent;
  let trailingStopPercent = CONFIG.trailingStopPercent;
  let runnerTrailingStopPercent = CONFIG.runnerTrailingStopPercent;
  let takeProfitPercent = CONFIG.takeProfitPercent;

  const strongTrend =
    score >= 80 ||
    technicalScore >= 80 ||
    trendPersistenceScore >= 70 ||
    statisticalScore >= 75;

  const weakTrend =
    score < 65 ||
    technicalScore < 60 ||
    trendPersistenceScore < 45;

  const highVolatility =
    volatilityScore >= 70 ||
    Math.abs(Number(signal.percentChange || 0)) >= 8;

  if (assetType === "crypto") {
    stopLossPercent = highVolatility ? -6 : -4;
    trailingStopPercent = strongTrend ? -4 : -3;
    runnerTrailingStopPercent = strongTrend ? 4 : 3;
    takeProfitPercent = strongTrend ? 12 : 8;
  } else {
    stopLossPercent = highVolatility ? -5 : -4;
    trailingStopPercent = strongTrend ? -3 : -2;
    runnerTrailingStopPercent = strongTrend ? 3.5 : 3;
    takeProfitPercent = strongTrend ? 10 : 8;
  }

  if (weakTrend) {
    stopLossPercent = assetType === "crypto" ? -3 : -2.5;
    trailingStopPercent = assetType === "crypto" ? -2 : -1.5;
    runnerTrailingStopPercent = 2;
    takeProfitPercent = 6;
  }

  return {
    assetType,
    stopLossPercent,
    trailingStopPercent,
    runnerTrailingStopPercent,
    takeProfitPercent,
    strongTrend,
    weakTrend,
    highVolatility,
    atrStyleVolatility,
  };
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
  const symbol = normalizeSymbol(q.symbol);
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};

  const volumeRatio = Number(
    confirmations.volumeSpikeRatio ||
      q.volumeRatio ||
      0
  );

  const rsi = Number(technicals.rsi || 50);

  const riskyHeadlineText = (
    confirmations.riskyNewsHeadlines || []
  )
    .join(" ")
    .toLowerCase();

  const earningsWords = [
    "earnings",
    "eps",
    "revenue",
    "guidance",
    "forecast",
    "quarter",
    "q1",
    "q2",
    "q3",
    "q4",
  ];

  const negativeEarningsWords = [
    "miss",
    "misses",
    "cut guidance",
    "lowers guidance",
    "weak guidance",
    "loss",
    "decline",
    "downgrade",
    "margin pressure",
  ];

  const positiveEarningsWords = [
    "beats",
    "beat",
    "raises guidance",
    "strong revenue",
    "record revenue",
    "profit rises",
    "eps beat",
  ];

  const hasEarningsNews = earningsWords.some((word) =>
    riskyHeadlineText.includes(word)
  );

  const negativeEarningsNews = negativeEarningsWords.some((word) =>
    riskyHeadlineText.includes(word)
  );

  const positiveEarningsNews = positiveEarningsWords.some((word) =>
    riskyHeadlineText.includes(word)
  );

  const revenueQualityScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 12 ? 15 : 0) +
      (volume >= 25000 ? 10 : -10) +
      (positiveEarningsNews ? 15 : 0) -
      (negativeEarningsNews ? 25 : 0)
  );

  const guidanceScore = clampScore(
    50 +
      (percentChange > 2 && percentChange <= 15 ? 15 : 0) +
      (positiveEarningsNews ? 25 : 0) -
      (negativeEarningsNews ? 35 : 0) -
      (percentChange > 25 ? 20 : 0)
  );

  const marginExpansionScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 10 ? 10 : 0) -
      (rsi > 80 ? 10 : 0) -
      (negativeEarningsNews ? 20 : 0)
  );

  const epsSurpriseQualityScore = clampScore(
    50 +
      (volumeRatio >= 1.3 ? 15 : 0) +
      (percentChange > 0 ? 10 : -10) +
      (positiveEarningsNews ? 20 : 0) -
      (negativeEarningsNews ? 30 : 0) -
      (confirmations.fakeBreakout ? 25 : 0)
  );

  const institutionalEarningsSentiment = clampScore(
    50 +
      (volumeRatio >= 1.5 ? 15 : 0) +
      (confirmations.closeNearHigh ? 10 : 0) +
      (confirmations.aboveVwap ? 10 : 0) +
      (positiveEarningsNews ? 15 : 0) -
      (confirmations.newsRisk ? 25 : 0) -
      (negativeEarningsNews ? 25 : 0)
  );

  const earningsCashFlowStrength = clampScore(
    50 +
      (volume >= 100000 ? 15 : volume >= 25000 ? 8 : -10) -
      (percentChange > 30 ? 15 : 0) -
      (negativeEarningsNews ? 15 : 0)
  );

  const earningsMomentumScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 12 ? 18 : 0) +
      (volumeRatio >= 1.5 ? 15 : 0) +
      (positiveEarningsNews ? 20 : 0) -
      (percentChange > 25 ? 20 : 0) -
      (negativeEarningsNews ? 30 : 0)
  );

  const earningsVolatilityRiskScore = clampScore(
    20 +
      (Math.abs(percentChange) >= 12 ? 25 : 0) +
      (Math.abs(percentChange) >= 25 ? 25 : 0) +
      (rsi > 78 ? 15 : 0) +
      (hasEarningsNews ? 15 : 0) +
      (confirmations.newsRisk ? 20 : 0)
  );

  const earningsSurpriseScore = clampScore(
    epsSurpriseQualityScore * 0.6 +
      institutionalEarningsSentiment * 0.4
  );

  const earningsScore = clampScore(
    revenueQualityScore * 0.16 +
      guidanceScore * 0.16 +
      marginExpansionScore * 0.14 +
      epsSurpriseQualityScore * 0.14 +
      institutionalEarningsSentiment * 0.15 +
      earningsCashFlowStrength * 0.12 +
      earningsMomentumScore * 0.08 +
      (100 - earningsVolatilityRiskScore) * 0.05
  );

  const earningsRiskMode =
    earningsVolatilityRiskScore >= 75
      ? "HIGH_EARNINGS_RISK"
      : earningsVolatilityRiskScore >= 55
      ? "EARNINGS_CAUTION"
      : hasEarningsNews
      ? "EARNINGS_ACTIVE"
      : "NORMAL";

  const earningsAction =
    earningsRiskMode === "HIGH_EARNINGS_RISK"
      ? "Avoid New Entry"
      : earningsRiskMode === "EARNINGS_CAUTION"
      ? "Reduce Position Size"
      : earningsScore >= 75
      ? "Earnings Tailwind"
      : "Neutral";

  return {
    symbol,
    earningsScore,
    revenueQualityScore,
    guidanceScore,
    guidanceQualityScore: guidanceScore,
    marginExpansionScore,
    epsSurpriseQualityScore,
    institutionalEarningsSentiment,
    earningsCashFlowStrength,
    earningsMomentumScore,
    earningsSurpriseScore,
    earningsVolatilityRiskScore,
    hasEarningsNews,
    positiveEarningsNews,
    negativeEarningsNews,
    earningsRiskMode,
    earningsAction,
    earningsReason:
      `${earningsAction} • Earnings ${earningsScore}/100 • ` +
      `Guidance ${guidanceScore}/100 • ` +
      `Volatility Risk ${earningsVolatilityRiskScore}/100`,
  };
}

function calculateInstitutionalDcfValuationEngine(q) {
  const symbol = normalizeSymbol(q.symbol);
  const price = Number(q.current || q.price || 0);
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const confirmations = q.confirmations || {};

  const baseDcf = calculateFundamentalDcfEngine(q);

  const moatScore = Number(q.moatScore || q.competitiveAdvantageScore || 50);
  const earningsScore = Number(q.earningsScore || 50);
  const riskScore = Number(q.riskScore || 50);
  const dividendScore = Number(q.dividendScore || q.wealthBuilderScore || 50);

  const estimatedFairValue = Number(baseDcf.intrinsicValue || price || 0);

  const marginOfSafetyPercent =
    price > 0
      ? ((estimatedFairValue - price) / price) * 100
      : 0;

  const qualityAdjustedFairValue = Number(
    (
      estimatedFairValue *
      (1 +
        (moatScore - 50) / 300 +
        (earningsScore - 50) / 400 +
        (dividendScore - 50) / 500 -
        (100 - riskScore) / 500)
    ).toFixed(2)
  );

  const qualityAdjustedMarginOfSafety =
    price > 0
      ? ((qualityAdjustedFairValue - price) / price) * 100
      : 0;

  const valuationRiskScore = clampScore(
    50 +
      (qualityAdjustedMarginOfSafety <= -25 ? 30 : 0) +
      (qualityAdjustedMarginOfSafety <= -50 ? 20 : 0) +
      (percentChange > 25 ? 20 : 0) +
      (confirmations.fakeBreakout ? 20 : 0) -
      (qualityAdjustedMarginOfSafety >= 20 ? 20 : 0)
  );

  const marginOfSafetyScore = clampScore(
    50 +
      (qualityAdjustedMarginOfSafety >= 10 ? 15 : 0) +
      (qualityAdjustedMarginOfSafety >= 25 ? 20 : 0) +
      (qualityAdjustedMarginOfSafety >= 50 ? 15 : 0) -
      (qualityAdjustedMarginOfSafety <= -10 ? 15 : 0) -
      (qualityAdjustedMarginOfSafety <= -25 ? 20 : 0)
  );

  const dcfValuationScore = clampScore(
    Number(baseDcf.valuationScore || 50) * 0.35 +
      marginOfSafetyScore * 0.35 +
      (100 - valuationRiskScore) * 0.3
  );

  const valuationLabel =
    qualityAdjustedMarginOfSafety >= 30
      ? "Deep Value"
      : qualityAdjustedMarginOfSafety >= 15
      ? "Undervalued"
      : qualityAdjustedMarginOfSafety >= -15
      ? "Fair Value"
      : qualityAdjustedMarginOfSafety >= -30
      ? "Overvalued"
      : "Extremely Overvalued";

  const valuationAction =
    valuationRiskScore >= 80
      ? "Avoid Valuation Risk"
      : valuationRiskScore >= 65
      ? "Reduce Position Size"
      : dcfValuationScore >= 75
      ? "Valuation Supportive"
      : dcfValuationScore >= 60
      ? "Valuation Neutral"
      : "Watch Only";

  return {
    symbol,
    dcfValuationScore,
    estimatedFairValue,
    qualityAdjustedFairValue,
    marginOfSafetyPercent: Number(marginOfSafetyPercent.toFixed(2)),
    qualityAdjustedMarginOfSafety:
      Number(qualityAdjustedMarginOfSafety.toFixed(2)),
    marginOfSafetyScore,
    valuationRiskScore,
    valuationLabel,
    valuationAction,
    baseDcf,
    dcfReason:
      `${valuationAction} • ${valuationLabel} • DCF ${dcfValuationScore}/100 • ` +
      `Margin ${qualityAdjustedMarginOfSafety.toFixed(2)}%`,
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

function calculateHarvardDividendCompoundingEngine(q) {
  const symbol = normalizeSymbol(q.symbol);
  const price = Number(q.current || q.price || 0);
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};
  const rsi = Number(technicals.rsi || 50);

  const existingWealth = calculateDividendWealthEngine(q);
  const sector = estimateSectorIntelligence(q);

  const harvardStabilityScore = clampScore(
    50 +
      (price >= 10 ? 15 : price >= 5 ? 8 : -10) +
      (volume >= 250000 ? 12 : volume >= 25000 ? 6 : -8) +
      (Math.abs(percentChange) <= 10 ? 12 : -10) -
      (confirmations.newsRisk ? 20 : 0) -
      (confirmations.fakeBreakout ? 20 : 0)
  );

  const endowmentQualityScore = clampScore(
    Number(existingWealth.wealthBuilderScore || 0) * 0.45 +
      Number(sector.sectorRiskScore || 50) * 0.25 +
      Number(sector.sectorLiquidityScore || 50) * 0.2 +
      (rsi >= 40 && rsi <= 70 ? 10 : 0)
  );

  const capitalPreservationScore = clampScore(
    55 +
      (price >= 5 ? 10 : -15) +
      (Math.abs(percentChange) <= 12 ? 12 : -12) +
      (Number(existingWealth.incomeStabilityScore || 0) >= 65 ? 12 : 0) -
      (confirmations.newsRisk ? 20 : 0)
  );

  const harvardDividendCompoundingScore = clampScore(
    harvardStabilityScore * 0.3 +
      endowmentQualityScore * 0.35 +
      capitalPreservationScore * 0.35
  );

  const harvardDividendProfile =
    harvardDividendCompoundingScore >= 85
      ? "Elite Endowment Compounder"
      : harvardDividendCompoundingScore >= 72
      ? "Strong Long-Term Compounder"
      : harvardDividendCompoundingScore >= 60
      ? "Moderate Wealth Builder"
      : harvardDividendCompoundingScore >= 45
      ? "Trade Only"
      : "Avoid Long-Term Allocation";

  return {
    symbol,
    harvardDividendCompoundingScore,
    harvardStabilityScore,
    endowmentQualityScore,
    capitalPreservationScore,
    harvardDividendProfile,
    harvardDividendReason:
      `${harvardDividendProfile} • Harvard ${harvardDividendCompoundingScore}/100 • ` +
      `Stability ${harvardStabilityScore}/100 • Preservation ${capitalPreservationScore}/100`,
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
  const symbol = normalizeSymbol(q.symbol);
  const price = Number(q.current || q.price || 0);
  const percentChange = Number(q.percentChange || 0);
  const volume = Number(q.volume || 0);
  const volumeRatio = Number(
    q.confirmations?.volumeSpikeRatio ||
      q.volumeRatio ||
      0
  );

  const confirmations = q.confirmations || {};
  const technicals = q.technicals || {};
  const rsi = Number(technicals.rsi || 50);

  const sectorInfo = estimateSectorIntelligence(q);
  const sectorScore = Number(sectorInfo.sectorScore || 50);
  const sectorLiquidityScore = Number(
    sectorInfo.sectorLiquidityScore || 50
  );
  const sectorRiskScore = Number(
    sectorInfo.sectorRiskScore || 50
  );
  const estimatedSector =
    sectorInfo.estimatedSector || "General Market";

  const brandStrengthScore = clampScore(
    45 +
      (price >= 5 ? 10 : -10) +
      (volume >= 250000 ? 15 : volume >= 25000 ? 8 : -10) +
      (sectorScore >= 65 ? 12 : 0) +
      (confirmations.closeNearHigh ? 8 : 0) -
      (confirmations.newsRisk ? 20 : 0)
  );

  const pricingPowerScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 12 ? 12 : 0) +
      (rsi >= 45 && rsi <= 70 ? 10 : 0) +
      (sectorRiskScore >= 65 ? 12 : 0) -
      (percentChange > 30 ? 18 : 0) -
      (price < 2 ? 20 : 0)
  );

  const marketPositionScore = clampScore(
    45 +
      (sectorScore >= 70 ? 18 : sectorScore >= 55 ? 10 : 0) +
      (sectorLiquidityScore >= 65 ? 12 : 0) +
      (volumeRatio >= 1.2 ? 8 : 0) +
      (confirmations.aboveVwap ? 7 : 0) -
      (confirmations.fakeBreakout ? 25 : 0)
  );

  const durabilityScore = clampScore(
    55 +
      (price >= 10 ? 12 : price >= 5 ? 6 : -12) +
      (volume >= 100000 ? 10 : volume >= 25000 ? 5 : -10) +
      (Math.abs(percentChange) <= 15 ? 10 : -12) -
      (confirmations.newsRisk ? 20 : 0) -
      (estimatedSector === "Speculative Small Cap" ? 15 : 0)
  );

  const reinvestmentQualityScore = clampScore(
    50 +
      (percentChange > 0 && percentChange <= 15 ? 12 : 0) +
      (volumeRatio >= 1 ? 8 : -8) +
      (sectorScore >= 60 ? 10 : 0) -
      (rsi > 80 ? 15 : 0) -
      (percentChange > 35 ? 20 : 0)
  );

  const competitiveAdvantageScore = clampScore(
    brandStrengthScore * 0.2 +
      pricingPowerScore * 0.2 +
      marketPositionScore * 0.22 +
      durabilityScore * 0.23 +
      reinvestmentQualityScore * 0.15
  );

  const moatScore = competitiveAdvantageScore;

  const moatLabel =
    competitiveAdvantageScore >= 85
      ? "Wide Moat / Durable Compounder"
      : competitiveAdvantageScore >= 72
      ? "Strong Competitive Advantage"
      : competitiveAdvantageScore >= 60
      ? "Developing Advantage"
      : competitiveAdvantageScore >= 45
      ? "Weak Advantage"
      : "No Clear Moat";

  const competitiveAdvantageAction =
    competitiveAdvantageScore >= 75
      ? "Long-Term Quality Candidate"
      : competitiveAdvantageScore >= 60
      ? "Tactical Quality Candidate"
      : competitiveAdvantageScore >= 45
      ? "Trade Only, Not Core"
      : "Avoid Core Allocation";

  return {
    symbol,
    moatScore,
    competitiveAdvantageScore,
    brandStrengthScore,
    pricingPowerScore,
    marketPositionScore,
    durabilityScore,
    reinvestmentQualityScore,
    moatLabel,
    competitiveAdvantageAction,
    estimatedSector,
    competitiveAdvantageReason:
      `${moatLabel} • Advantage ${competitiveAdvantageScore}/100 • ` +
      `Durability ${durabilityScore}/100 • Pricing Power ${pricingPowerScore}/100`,
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
  const institutionalDcf =
  calculateInstitutionalDcfValuationEngine(q);
  
  const earnings = calculateEarningsIntelligenceEngine(q);
  const edge = calculateStatisticalEdge(q);
  const citadelTechnical = calculateCitadelTechnicalIntelligenceEngine(q);
  const moat = calculateMoatEngine(q);
  const wealth = calculateDividendWealthEngine(q);
  const harvardDividend =
  calculateHarvardDividendCompoundingEngine(q);
  const portfolio = calculatePortfolioConstructionEngine(q);
  const sector = estimateSectorIntelligence(q);
  const advancedRisk = calculateAdvancedRiskEngine(q);
  const technicalScore = citadelTechnical.technicalScore;

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

  const fundamentalScore = institutionalDcf.fundamentalScore;
  const dcfValuationScore = institutionalDcf.dcfValuationScore;

  const earningsScore = earnings.earningsScore;
  const moatScore = moat.moatScore;
  const dividendScore = wealth.wealthBuilderScore;
  const harvardDividendScore =
  harvardDividend.harvardDividendCompoundingScore;
  const portfolioScore = portfolio.portfolioScore;

    const reinforcementWeights =
    engineState.reinforcementWeightState?.weights || {
      momentum: 0.18,
      technicals: 0.25,
      fundamentals: 0.12,
      macro: 0.1,
      statisticalEdge: 0.2,
      riskQuality: 0.15,
    };

  const momentumScore = clampScore(
    50 +
      momentum * 1.5 +
      volumeRatio * 8 -
      (momentum > 35 ? 15 : 0)
  );

  const fundamentalBlendScore = clampScore(
    fundamentalScore * 0.45 +
      dcfValuationScore * 0.2 +
      earningsScore * 0.15 +
      moatScore * 0.12 +
      dividendScore * 0.04 +
      harvardDividendScore * 0.04
  );

  const institutionalScore = clampScore(
    momentumScore * reinforcementWeights.momentum +
      technicalScore * reinforcementWeights.technicals +
      fundamentalBlendScore * reinforcementWeights.fundamentals +
      macroScore * reinforcementWeights.macro +
      statisticalScore * reinforcementWeights.statisticalEdge +
      blendedRiskScore * reinforcementWeights.riskQuality +
      portfolioScore * 0.04 +
      sector.sectorScore * 0.03
  );

  const hardSafetyPass =
    confirmations.fakeBreakout !== true &&
    confirmations.newsRisk !== true &&
    blendedRiskScore >= 55 &&
    citadelTechnical.exhaustionRiskScore <= 82 &&
    Number(q.volume || 0) >= 5000 &&
    Number(q.percentChange || 0) <= CONFIG.maxPercentChange;

  const institutionalQualityPass =
    institutionalScore >= CONFIG.minScoreToBuy &&
    citadelTechnical.institutionalEntryScore >= 55;

  const stockResearchPass =
    TRADING_MODE === "live_crypto" ||
    (
      institutionalDcf.valuationRiskScore <= 90 &&
      earnings.earningsRiskMode !== "HIGH_EARNINGS_RISK" &&
      earnings.earningsVolatilityRiskScore <= 85 &&
      moat.competitiveAdvantageScore >= 35
    );

  const autoTradeApproved =
    hardSafetyPass &&
    institutionalQualityPass &&
    stockResearchPass;

  const decisionLevel = autoTradeApproved
    ? "Auto-Trade Approved"
    : institutionalScore >= 55
      ? "Qualified Setup"
      : "Visible Stock";

  return {
    technicalScore,
    momentumScore,
    fundamentalBlendScore,
    reinforcementWeights,
    technicalIntelligence: citadelTechnical,
    trendQualityScore: citadelTechnical.trendQualityScore,
    breakoutQualityScore: citadelTechnical.breakoutQualityScore,
    executionTimingScore: citadelTechnical.executionTimingScore,
    exhaustionRiskScore: citadelTechnical.exhaustionRiskScore,
    institutionalEntryGrade: citadelTechnical.institutionalEntryGrade,
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
fundamentalScore,
dcfValuation: institutionalDcf,
dcfValuationScore,
valuationRiskScore:
  institutionalDcf.valuationRiskScore,
marginOfSafetyScore:
  institutionalDcf.marginOfSafetyScore,
qualityAdjustedMarginOfSafety:
  institutionalDcf.qualityAdjustedMarginOfSafety,
valuationLabel:
  institutionalDcf.valuationLabel,
valuationAction:
  institutionalDcf.valuationAction,
intrinsicValue:
  institutionalDcf.baseDcf?.intrinsicValue || 0,
valuationGapPercent:
  institutionalDcf.baseDcf?.valuationGapPercent || 0,
valuationScore:
  institutionalDcf.dcfValuationScore || dcfValuationScore,
balanceSheetHealthScore:
  institutionalDcf.baseDcf?.balanceSheetHealthScore || 50,
cashFlowScore:
  institutionalDcf.baseDcf?.cashFlowScore || 50,
revenueGrowthScore:
  institutionalDcf.baseDcf?.revenueGrowthScore || 50,
marginScore:
  institutionalDcf.baseDcf?.marginScore || 50,
debtRiskScore:
  institutionalDcf.baseDcf?.debtRiskScore || 50,
    earningsScore,
    earningsIntelligence: earnings,
    earningsRiskMode: earnings.earningsRiskMode,
    earningsAction: earnings.earningsAction,
    earningsVolatilityRiskScore:
    earnings.earningsVolatilityRiskScore,
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
    harvardDividendCompounding: harvardDividend,
harvardDividendScore,
harvardStabilityScore:
  harvardDividend.harvardStabilityScore,
endowmentQualityScore:
  harvardDividend.endowmentQualityScore,
capitalPreservationScore:
  harvardDividend.capitalPreservationScore,
harvardDividendProfile:
  harvardDividend.harvardDividendProfile,
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
  if (!Array.isArray(bars) || bars.length < 3) {
    return 0;
  }

  const cleanBars = bars
    .map((bar) => ({
      o: Number(bar.o || 0),
      h: Number(bar.h || 0),
      l: Number(bar.l || 0),
      c: Number(bar.c || 0),
      v: Number(bar.v || 0),
    }))
    .filter((bar) => bar.c > 0);

  if (cleanBars.length < 3) {
    return 0;
  }

  const first = cleanBars[0];
  const latest = cleanBars[cleanBars.length - 1];
  const previous = cleanBars[cleanBars.length - 2];

  const current = Number(latest.c || quote.current || 0);
  const open = Number(first.o || first.c || 0);

  const high = Math.max(...cleanBars.map((bar) => bar.h || bar.c));
  const low = Math.min(...cleanBars.map((bar) => bar.l || bar.c));

  const momentumPercent =
    open > 0 ? ((current - open) / open) * 100 : 0;

  const shortWindow = cleanBars.slice(-5);
  const shortFirst = shortWindow[0];
  const shortMomentumPercent =
    shortFirst?.c > 0
      ? ((current - shortFirst.c) / shortFirst.c) * 100
      : 0;

  const closeNearHigh =
    high > low ? ((current - low) / (high - low)) * 100 : 50;

  const greenBars = cleanBars.filter(
    (bar) => Number(bar.c || 0) >= Number(bar.o || 0)
  ).length;

  const greenRatio = greenBars / cleanBars.length;

  const previousClose = Number(previous.c || current);
  const lastBarMomentum =
    previousClose > 0 ? ((current - previousClose) / previousClose) * 100 : 0;

  const avgVolume =
    cleanBars.reduce((sum, bar) => sum + Number(bar.v || 0), 0) /
    Math.max(1, cleanBars.length);

  const latestVolume = Number(latest.v || 0);

  const volumeRatio =
    avgVolume > 0 ? latestVolume / avgVolume : 1;

  let score = 35;

  if (cleanBars.length >= 10) score += 8;
  if (cleanBars.length >= 15) score += 5;
  if (cleanBars.length >= 20) score += 5;

  if (momentumPercent > 0) score += 12;
  if (momentumPercent >= 0.2) score += 10;
  if (momentumPercent >= 0.5) score += 10;
  if (momentumPercent >= 1) score += 8;

  if (shortMomentumPercent > 0) score += 8;
  if (shortMomentumPercent >= 0.25) score += 7;

  if (greenRatio >= 0.55) score += 8;
  if (greenRatio >= 0.65) score += 7;

  if (closeNearHigh >= 55) score += 6;
  if (closeNearHigh >= 70) score += 8;
  if (closeNearHigh >= 85) score += 6;

  if (volumeRatio >= 1.1) score += 5;
  if (volumeRatio >= 1.5) score += 6;

  if (lastBarMomentum < -0.6) score -= 10;
  if (momentumPercent < -0.5) score -= 12;
  if (closeNearHigh < 30) score -= 8;

  return clampScore(Math.round(score));
}

async function getBestCryptoBars(symbol) {
  const attempts = [
    ["5Min", 30],
    ["1Min", 30],
    ["15Min", 30],
  ];

  for (const [timeframe, limit] of attempts) {
    const bars = await getCryptoRecentBars(symbol, timeframe, limit);

    if (Array.isArray(bars) && bars.length >= 10) {
      return bars;
    }
  }

  return await getCryptoRecentBars(symbol, "1Min", 30);
}

function calculateCryptoLiquidityFromBars(
  bars = [],
  currentPrice = 0
) {
  const cleanBars = Array.isArray(bars)
    ? bars
        .map((bar) => {
          const close = Number(
            bar.c ??
            bar.close ??
            bar.price ??
            0
          );

          const rawVolume =
            bar.v ??
            bar.volume ??
            bar.volume_crypto ??
            bar.volume_usd ??
            bar.baseVolume ??
            bar.quoteVolume ??
            0;

          const parsedVolume = Number(rawVolume);

          return {
            close,
            volume:
              Number.isFinite(parsedVolume)
                ? parsedVolume
                : 0,
          };
        })
        .filter(
          (bar) =>
            Number.isFinite(bar.close) &&
            bar.close > 0
        )
    : [];

  const latestBar =
    cleanBars[cleanBars.length - 1] || {};

  const latestVolume = Number(
    latestBar.volume || 0
  );

  const nonZeroVolumes = cleanBars
    .map((bar) => Number(bar.volume || 0))
    .filter((volume) => volume > 0);

  const averageVolume =
    nonZeroVolumes.length > 0
      ? nonZeroVolumes.reduce(
          (sum, volume) => sum + volume,
          0
        ) / nonZeroVolumes.length
      : 0;

  const maxVolume =
    nonZeroVolumes.length > 0
      ? Math.max(...nonZeroVolumes)
      : 0;

  const effectiveVolume =
    latestVolume > 0
      ? latestVolume
      : averageVolume > 0
      ? averageVolume
      : maxVolume;

  const volumeSpikeRatio =
    averageVolume > 0 && latestVolume > 0
      ? latestVolume / averageVolume
      : averageVolume > 0
      ? 1
      : 0;

  const effectivePrice = Number(
    currentPrice ||
      latestBar.close ||
      cleanBars[cleanBars.length - 1]?.close ||
      0
  );

  const dollarVolume =
    effectiveVolume * effectivePrice;

  const volumeConfidenceScore = clampScore(
    25 +
      (cleanBars.length >= 20 ? 20 : cleanBars.length >= 10 ? 10 : 0) +
      (nonZeroVolumes.length >= 10 ? 25 : nonZeroVolumes.length >= 3 ? 15 : nonZeroVolumes.length > 0 ? 8 : 0) +
      (volumeSpikeRatio >= 2 ? 20 : volumeSpikeRatio >= 1 ? 12 : volumeSpikeRatio > 0 ? 6 : 0)
  );

  return {
    volume: Number(latestVolume.toFixed(2)),
    averageVolume: Number(averageVolume.toFixed(2)),
    effectiveVolume: Number(effectiveVolume.toFixed(2)),
    maxVolume: Number(maxVolume.toFixed(2)),
    nonZeroVolumeBars: nonZeroVolumes.length,
    volumeSpikeRatio: Number(volumeSpikeRatio.toFixed(3)),
    dollarVolume: Number(dollarVolume.toFixed(2)),
    volumeConfidenceScore: Number(volumeConfidenceScore.toFixed(2)),
  };
}

function calculateCryptoInstitutionalQualification({
  quote = {},
  score = 0,
  bars = [],
  liquidityMetrics = {},
  spreadPercent = 0,
}) {
  const barsFound = Array.isArray(bars) ? bars.length : 0;

  const volumeSpikeRatio = Number(
    liquidityMetrics.volumeSpikeRatio || 0
  );

  const dollarVolume = Number(
    liquidityMetrics.dollarVolume || 0
  );

  const volumeConfidenceScore = Number(
    liquidityMetrics.volumeConfidenceScore || 0
  );

  const cleanSpreadPercent = Number(spreadPercent || 0);

  const spreadPass = cleanSpreadPercent <= 0.85;

const liquidityPass =
  spreadPass &&
  dollarVolume >= 50 &&
  (
    volumeSpikeRatio >= 0.15 ||
    volumeConfidenceScore >= 60
  );

  const momentumPass =
    Number(score || 0) >=
    Number(
      engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
        CONFIG.minScoreToBuy ||
        70
    );

  const dataPass =
    barsFound >= 10 &&
    Number(quote.current || 0) > 0;

  const macroPass =
    engineState.macroRiskState?.shouldBlockNewTrades !== true &&
    engineState.marketCrashProtectionState?.shouldBlockNewTrades !== true;

  const qualifiedToBuy =
    dataPass &&
    momentumPass &&
    liquidityPass &&
    macroPass;

  return {
    qualifiedToBuy,
    cryptoInstitutionalQualification: {
      dataPass,
      momentumPass,
      liquidityPass,
      macroPass,
      spreadPass,
      barsFound,
      score,
      spreadPercent: cleanSpreadPercent,
      dollarVolume,
      volumeSpikeRatio,
      volumeConfidenceScore,
      reason: qualifiedToBuy
        ? "Crypto institutional qualification passed"
        : "Crypto institutional qualification failed",
    },
  };
}

async function scanCryptoMarket() {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) {
    throw new Error("Crypto scanner is only available in live modes");
  }

  const symbols = await getCryptoAssets();
  const results = [];

  engineState.skippedSymbols = [];

  for (const symbol of symbols) {

    const institutionalUsdPair =
  String(symbol || "").endsWith("/USD");

if (!institutionalUsdPair) {
  continue;
}
    try {
      const quote = await getCryptoLatestQuote(symbol);
      const bars = await getBestCryptoBars(symbol);
      const score = scoreCrypto(quote, bars);

      const firstBarClose = Number(
  bars?.[0]?.c ||
    bars?.[0]?.close ||
    0
);

const latestPrice = Number(
  quote.current || 0
);

const cryptoPercentChange =
  firstBarClose > 0 &&
  latestPrice > 0
    ? (
        (
          latestPrice -
          firstBarClose
        ) / firstBarClose
      ) * 100
    : 0;

      const liquidityMetrics =
        calculateCryptoLiquidityFromBars(
          bars,
          Number(quote.current || 0)
        );

      const spreadPercent =
        Number(quote.bid || 0) > 0 &&
        Number(quote.ask || 0) > 0
          ? ((Number(quote.ask) - Number(quote.bid)) /
              Number(quote.ask)) *
            100
          : 0;

      const cryptoQualification =
        calculateCryptoInstitutionalQualification({
          quote,
          score,
          bars,
          liquidityMetrics,
          spreadPercent,
        });

      results.push({
        ...quote,

        assetClass: "crypto",
        asset_class: "crypto",
        percentChange: Number(cryptoPercentChange.toFixed(2)),
       changePercent: Number(cryptoPercentChange.toFixed(2)),
        score,

        barsFound: bars.length,

        volume: liquidityMetrics.volume,
        averageVolume: liquidityMetrics.averageVolume,
        volumeSpikeRatio: liquidityMetrics.volumeSpikeRatio,
        dollarVolume: liquidityMetrics.dollarVolume,

        spreadPercent: Number(spreadPercent.toFixed(3)),

        confirmations: {
          volumeSpikeRatio:
            liquidityMetrics.volumeSpikeRatio,
        },

        ...cryptoQualification,
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

  const batchSize = 5;

  const rawResults = await runInBatches(limitedSymbols, batchSize, async (symbol) => {
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

const statisticalEdge = quote.statisticalEdge || null;
const statisticalScore = Number(quote.statisticalScore || 0);

const institutional = calculateInstitutionalScores({
  ...quote,
  score,
});

   const portfolioManager =
  typeof calculateAiPortfolioManagerDecision === "function"
    ? calculateAiPortfolioManagerDecision(
        institutional,
        engineState.cachedAccount || {},
        engineState.cachedPositions || [],
        engineState.marketRegime || detectMarketRegime([])
      )
    : {
        approved: true,
        autoTradeApproved: true,
        aiPortfolioAction: "ALLOW",
        portfolioAction: "ALLOW",
        portfolioScore: 50,
        recommendedTradeAmount: 0,
        aiAllocationPercentOfBotBudget: 0,
        portfolioManagerReason:
          "AI_PORTFOLIO_MANAGER_UNAVAILABLE",
      };

      return {
        ...quote,

        score: institutional.institutionalScore,
        legacyMomentumScore: score,

        momentumScore:
          institutional.momentumScore || score,

        fundamentalBlendScore:
          institutional.fundamentalBlendScore || 0,

        reinforcementWeights:
          institutional.reinforcementWeights ||
          engineState.reinforcementWeightState?.weights ||
          {},

        statisticalScore,
        statisticalEdge,

        ...institutional,
        ...portfolioManager,
qualifiedToBuy:
  (
    institutional.autoTradeApproved === true ||
    portfolioManager.autoTradeApproved === true ||
    portfolioManager.approved === true ||
    portfolioManager.aiPortfolioAction === "ALLOW" ||
    portfolioManager.portfolioAction === "ALLOW"
  ) &&
  institutional.decisionLevel !== "Visible Stock" &&
  engineState.phase20AutonomousOrchestrationState?.shouldBlockNewTrades !== true &&
  engineState.phase21AutonomousBrainState?.shouldBlockNewTrades !== true,
      };
    } catch (err) {
      saveSkippedSymbol(symbol, err.message);
      return null;
    }
  });

  const results = rawResults.filter(Boolean);

  console.log(`Scan finished. Found ${results.length} stocks.`);

  const statisticalEdgeSignals = results.filter(
    (signal) => Number(signal.statisticalScore || 0) >= 70
  );

  const averageStatisticalEdge =
    statisticalEdgeSignals.length > 0
      ? statisticalEdgeSignals.reduce(
          (sum, signal) => sum + Number(signal.statisticalScore || 0),
          0
        ) / statisticalEdgeSignals.length
      : 0;
engineState.statisticalMemoryState =
  engineState.statisticalMemoryState || {
    updatedAt: null,
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  };

  engineState.statisticalEdgeState = {
    updatedAt: new Date().toISOString(),
    qualifyingSignals: statisticalEdgeSignals.length,
    averageStatisticalEdge: Number(averageStatisticalEdge.toFixed(2)),
    strongestSignals: statisticalEdgeSignals.slice(0, 5).map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      statisticalScore: signal.statisticalScore,
    })),
  };

  if (!Array.isArray(engineState.statisticalEdgeHistory)) {
    engineState.statisticalEdgeHistory = [];
  }

  engineState.statisticalEdgeHistory.unshift({
    updatedAt: new Date().toISOString(),
    qualifyingSignals: statisticalEdgeSignals.length,
    averageStatisticalEdge: Number(averageStatisticalEdge.toFixed(2)),
  });

  engineState.statisticalEdgeHistory = engineState.statisticalEdgeHistory.slice(
    0,
    200
  );

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

    const clock = await getClock();
    const marketOpen = Boolean(clock?.is_open);
    const cleanNotional = Math.max(1, Number(dollars.toFixed(2)));

    let orderPayload = {
      symbol: normalizedSymbol,
      notional: cleanNotional,
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: `${AI_ORDER_PREFIX}_BUY_${normalizedSymbol}_${Math.round(score)}_${Date.now()}`,
    };

    if (!marketOpen) {
      const latestQuote = await getCombinedStockQuote(normalizedSymbol);
      const referencePrice = Number(
        latestQuote.ask ||
          latestQuote.current ||
          latestQuote.price ||
          0
      );

      if (!referencePrice || referencePrice <= 0) {
        throw new Error(`No valid after-hours limit price for ${normalizedSymbol}`);
      }

      const limitPrice = Number((referencePrice * 1.01).toFixed(2));
      const qty = Math.max(1, Math.floor(cleanNotional / limitPrice));

      orderPayload = {
        symbol: normalizedSymbol,
        qty: String(qty),
        side: "buy",
        type: "limit",
        limit_price: String(limitPrice),
        time_in_force: "day",
        extended_hours: true,
        client_order_id: `${AI_ORDER_PREFIX}_EXT_BUY_${normalizedSymbol}_${Math.round(score)}_${Date.now()}`,
      };
    }

    return await alpacaTradingRequest("/v2/orders", {
      method: "POST",
      body: JSON.stringify(orderPayload),
    });


  } finally {
    setTimeout(() => buyingNow.delete(normalizedSymbol), 10000);
  }
}
async function executeAdaptiveBuyOrder({
  signal,
  totalAmount,
  assetClass = "stock",
}) {
  const symbol = normalizeSymbol(signal.symbol);
  const amount = Number(totalAmount || 0);

  if (!symbol || amount <= 0) {
    throw new Error("Invalid adaptive buy order");
  }

  const executionReview =
    engineState.executionIntelligenceState?.executionReviews?.find(
      (review) => normalizeSymbol(review.symbol) === symbol
    ) || {};

  const entryStyle =
    executionReview.entryStyle || "SINGLE_ENTRY";

  if (entryStyle === "NO_EXECUTION") {
    throw new Error("Execution intelligence blocked order");
  }

  const timing =
    engineState.adaptiveExecutionTimingState || {};

  let slices =
    Number(executionReview.icebergSlices || 0) ||
    (
      entryStyle === "STEALTH_SCALE_IN"
        ? 4
        : entryStyle === "STAGGERED_ENTRY"
        ? 3
        : entryStyle === "SMALL_PROBE_ENTRY"
        ? 2
        : 1
    );

  if (Number(timing.maxSlices || 0) > 0) {
    slices = Math.min(slices, Number(timing.maxSlices || slices));
  }

  const minSliceAmount =
    assetClass === "crypto" ? 25 : 1;

  if (amount / slices < minSliceAmount) {
    slices = Math.max(1, Math.floor(amount / minSliceAmount));
  }

  slices = Math.max(1, slices);

  const sliceAmount = Number((amount / slices).toFixed(2));

  const defaultDelayMs =
    entryStyle === "STEALTH_SCALE_IN"
      ? 20000
      : entryStyle === "STAGGERED_ENTRY"
      ? 15000
      : entryStyle === "SMALL_PROBE_ENTRY"
      ? 10000
      : 0;

  const delayMs =
    Number(timing.recommendedDelayMs || 0) > 0
      ? Number(timing.recommendedDelayMs || 0)
      : defaultDelayMs;

  const orders = [];

  for (let i = 0; i < slices; i += 1) {
    const order =
      assetClass === "crypto"
        ? await placeCryptoMarketBuy(symbol, sliceAmount)
        : await placeMarketBuy(symbol, sliceAmount, signal.score);

    orders.push(order);

    if (i < slices - 1 && delayMs > 0) {
      saveRecentOrder("ADAPTIVE_EXECUTION_SLICE_WAIT", symbol, {
        assetClass,
        slice: i + 1,
        slices,
        delayMs,
        timingMode: timing.timingMode,
      });

      await sleep(delayMs);
    }
  }

  return {
    symbol,
    assetClass,
    entryStyle,
    timingMode: timing.timingMode || "DEFAULT_TIMING",
    slices,
    sliceAmount,
    delayMs,
    totalAmount: amount,
    executionReview,
    timing,
    orders,
  };
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

    const clock = await getClock();
    const marketOpen = Boolean(clock?.is_open);
    const cleanNotional = Math.max(1, Number(dollars.toFixed(2)));

    if (marketOpen) {
      return await alpacaTradingRequest("/v2/orders", {
        method: "POST",
        body: JSON.stringify({
          symbol: normalizedSymbol,
          notional: cleanNotional,
          side: "buy",
          type: "market",
          time_in_force: "day",
          client_order_id: `${AI_ORDER_PREFIX}_BUY_${normalizedSymbol}_${Math.round(score)}_${Date.now()}`,
        }),
      });
    }

    const latestQuote = await getCombinedStockQuote(normalizedSymbol);
    const referencePrice = Number(
      latestQuote.ask || latestQuote.current || latestQuote.price || 0
    );

    if (!referencePrice || referencePrice <= 0) {
      throw new Error(`No valid after-hours limit price for ${normalizedSymbol}`);
    }

    const limitPrice = Number((referencePrice * 1.01).toFixed(2));
    const qty = Math.max(1, Math.floor(cleanNotional / limitPrice));

    return await alpacaTradingRequest("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: normalizedSymbol,
        qty: String(qty),
        side: "buy",
        type: "limit",
        limit_price: String(limitPrice),
        time_in_force: "day",
        extended_hours: true,
        client_order_id: `${AI_ORDER_PREFIX}_EXT_BUY_${normalizedSymbol}_${Math.round(score)}_${Date.now()}`,
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

function calculateTrendQualityHoldDuration(signal = {}) {
  const score = Number(signal.score || 0);
  const technicalScore = Number(signal.technicalScore || 0);
  const statisticalScore = Number(signal.statisticalScore || 0);
  const trendPersistenceScore = Number(signal.trendPersistenceScore || 0);
  const unrealizedPercent = Number(signal.unrealizedPercent || 0);
  const dropFromHigh = Number(signal.dropFromHigh || 0);

  const trendQualityScore = clampScore(
    score * 0.3 +
      technicalScore * 0.25 +
      statisticalScore * 0.2 +
      trendPersistenceScore * 0.25
  );

  const holdMode =
    trendQualityScore >= 80 && unrealizedPercent > 0 && dropFromHigh <= 2
      ? "EXTENDED_SWING_HOLD"
      : trendQualityScore >= 65 && dropFromHigh <= 1.5
      ? "NORMAL_SWING_HOLD"
      : "STANDARD_EXIT_RULES";

  const suggestedHoldDays =
    holdMode === "EXTENDED_SWING_HOLD"
      ? 5
      : holdMode === "NORMAL_SWING_HOLD"
      ? 3
      : 1;

  return {
    trendQualityScore,
    holdMode,
    suggestedHoldDays,
    shouldExtendHold:
      holdMode !== "STANDARD_EXIT_RULES",
  };
}

function calculateTrendPersistenceHoldDecision({
  unrealizedPercent = 0,
  dropFromHigh = 0,
  isRunner = false,
  highWater = 0,
  currentPrice = 0,
}) {
  const priceStillNearHigh =
    highWater > 0 && currentPrice > 0
      ? currentPrice >= highWater * 0.985
      : false;

  const strongRunner =
    isRunner &&
    unrealizedPercent >= CONFIG.runnerTriggerPercent &&
    dropFromHigh <= 1.25 &&
    priceStillNearHigh;

  const veryStrongRunner =
    isRunner &&
    unrealizedPercent >= 10 &&
    dropFromHigh <= 1.75;

  if (veryStrongRunner) {
    return {
      shouldHold: true,
      mode: "VERY_STRONG_TREND_HOLD",
      runnerTrailingStopPercent: 2,
      reason: "Very strong runner. Holding longer with wider trailing stop.",
    };
  }

  if (strongRunner) {
    return {
      shouldHold: true,
      mode: "STRONG_TREND_HOLD",
      runnerTrailingStopPercent: 1.5,
      reason: "Runner trend remains healthy. Avoiding premature exit.",
    };
  }

  return {
    shouldHold: false,
    mode: "NORMAL_EXIT_RULES",
    runnerTrailingStopPercent: CONFIG.runnerTrailingStopPercent,
    reason: "Normal exit rules apply.",
  };
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

const adaptiveSwingRisk = calculateAdaptiveSwingRisk(
  {
    symbol,
    current: currentPrice,
    price: currentPrice,
    high: highWater,
    low: Number(pos.avg_entry_price || currentPrice),
    score: engineState.aiEntryScores?.[symbol]?.score || 0,
    technicalScore:
      engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
    statisticalScore:
      engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
    trendPersistenceScore:
      engineState.trendPersistenceState?.heldSymbols?.[symbol]
        ?.trendPersistenceScore || 0,
    percentChange: unrealizedPercent,
    assetType: "stock",
  },
  { assetType: "stock" }
);

    const alreadyRunner = Boolean(engineState.runnerPositions[symbol]);
   const shouldActivateRunner =
  unrealizedPercent >=
  Math.max(
    CONFIG.runnerTriggerPercent,
    adaptiveSwingRisk.takeProfitPercent * 0.7
  );

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

    const shouldStopLoss = unrealizedPercent <= adaptiveSwingRisk.stopLossPercent;
    const shouldProtectProfit =
      unrealizedPercent >= 2 &&
      dropFromHigh >= 0.8;


const shouldNormalTrailingExit =
  !isRunner &&
  unrealizedPercent > 0 &&
  dropFromHigh >= Math.abs(adaptiveSwingRisk.trailingStopPercent);

  const trendQualityHold =
  calculateTrendQualityHoldDuration({
    symbol,
    score: engineState.aiEntryScores?.[symbol]?.score || 0,
    technicalScore:
      engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
    statisticalScore:
      engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
    trendPersistenceScore:
      engineState.trendPersistenceState?.heldSymbols?.[symbol]
        ?.trendPersistenceScore || 0,
    unrealizedPercent,
    dropFromHigh,
  });

    const trendHoldDecision =
      calculateTrendPersistenceHoldDecision({
        unrealizedPercent,
        dropFromHigh,
        isRunner,
        highWater,
        currentPrice,
      });

    const dynamicRunnerTrailingStopPercent =
      trendHoldDecision.runnerTrailingStopPercent;

    const shouldRunnerTrailingExit =
      isRunner && dropFromHigh >= dynamicRunnerTrailingStopPercent;
 if (
  (trendHoldDecision.shouldHold ||
    trendQualityHold.shouldExtendHold) &&
  !shouldStopLoss
) {
      saveRecentOrder("TREND_PERSISTENCE_HOLD", symbol, {
        qty,
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        isRunner,
        trendHoldMode: trendHoldDecision.mode,
        trendHoldReason: trendHoldDecision.reason,
        dynamicRunnerTrailingStopPercent,
      });

      continue;
    }

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
        trendHoldMode: trendHoldDecision.mode,
        trendHoldReason: trendHoldDecision.reason,
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

if (
  unrealizedPercent >=
  Number(CONFIG.runnerTriggerPercent || 6)
) {
  if (!engineState.statisticalMemoryState) {
    engineState.statisticalMemoryState = {
      updatedAt: new Date().toISOString(),
      setupHistory: [],
      setupPerformance: {},
      expectancyHistory: [],
      probabilityHistory: [],
    };
  }

  const reinforcementSetupType =
    engineState.aiEntryScores?.[symbol]
      ?.setupType || "UNKNOWN_SETUP";

  engineState.statisticalMemoryState.setupHistory.unshift({
    symbol,
    setupType: reinforcementSetupType,
    timestamp: new Date().toISOString(),
    profitPercent: Number(
      unrealizedPercent.toFixed(2)
    ),
    reinforcementSource: "LIVE_RUNNER_EXIT",
  });

  engineState.statisticalMemoryState.setupHistory =
    engineState.statisticalMemoryState.setupHistory.slice(
      0,
      500
    );
}

if (
  unrealizedPercent <=
  -Number(CONFIG.stopLossPercent || 1)
) {
  if (!engineState.statisticalMemoryState) {
    engineState.statisticalMemoryState = {
      updatedAt: new Date().toISOString(),
      setupHistory: [],
      setupPerformance: {},
      expectancyHistory: [],
      probabilityHistory: [],
    };
  }

  const weakeningSetupType =
    engineState.aiEntryScores?.[symbol]
      ?.setupType || "UNKNOWN_SETUP";

  engineState.statisticalMemoryState.setupHistory.unshift({
    symbol,
    setupType: weakeningSetupType,
    timestamp: new Date().toISOString(),
    profitPercent: Number(
      unrealizedPercent.toFixed(2)
    ),
    reinforcementSource: "LIVE_STOP_LOSS",
  });

  engineState.statisticalMemoryState.setupHistory =
    engineState.statisticalMemoryState.setupHistory.slice(
      0,
      500
    );
}

saveRecentOrder(reason, symbol, {
        dynamicRunnerTrailingStopPercent,
        trendHoldMode: trendHoldDecision.mode,
        trendHoldReason: trendHoldDecision.reason,
        qty,
        price: currentPrice,
        highWater,
        dropFromHigh,
        profitPercent: unrealizedPercent,
        isRunner,
        order,
      });
saveEngineState("PROBABILITY_REINFORCEMENT_UPDATED");
      rememberTradeResult(symbol, {
        profitPercent: unrealizedPercent,
        reason,
      });

saveEngineState("CRYPTO_PROBABILITY_REINFORCEMENT_UPDATED");

     journalTradeExit(symbol, {
  assetClass: "stock",
  exitType: "AUTO_STOCK_EXIT",
  exitPrice: currentPrice,
  profitPercent: unrealizedPercent,
  exitReason: reason,
});
      delete engineState.highWaterMarks[symbol];
      engineState.lastSoldAt[symbol] = Date.now();
      delete engineState.aiEntryScores[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {

      saveFailedOrder(`${reason}_FAILED`, symbol, err.message, {
        dynamicRunnerTrailingStopPercent,
        trendHoldMode: trendHoldDecision.mode,
        trendHoldReason: trendHoldDecision.reason,
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

const adaptiveSwingRisk = calculateAdaptiveSwingRisk(
  {
    symbol,
    current: currentPrice,
    price: currentPrice,
    high: highWater,
    low: Number(pos.avg_entry_price || currentPrice),
    score: engineState.aiEntryScores?.[symbol]?.score || 0,
    technicalScore:
      engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
    statisticalScore:
      engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
    trendPersistenceScore:
      engineState.trendPersistenceState?.heldSymbols?.[symbol]
        ?.trendPersistenceScore || 0,
    percentChange: profitPercent,
    assetType: "crypto",
  },
  { assetType: "crypto" }
);

const trendQualityHold =
  calculateTrendQualityHoldDuration({
    symbol,
    score: engineState.aiEntryScores?.[symbol]?.score || 0,
    technicalScore:
      engineState.aiEntryScores?.[symbol]?.technicalScore || 0,
    statisticalScore:
      engineState.aiEntryScores?.[symbol]?.statisticalScore || 0,
    trendPersistenceScore:
      engineState.trendPersistenceState?.heldSymbols?.[symbol]
        ?.trendPersistenceScore || 0,
    unrealizedPercent: profitPercent,
    dropFromHigh,
  });
const trailingActive =
  profitPercent >= adaptiveSwingRisk.takeProfitPercent * 0.5;

const shouldStopLoss =
  profitPercent <= adaptiveSwingRisk.stopLossPercent;

const shouldTrailingStop =
  trailingActive &&
  profitPercent >= 1.5 &&
  dropFromHigh >=

    Math.abs(adaptiveSwingRisk.trailingStopPercent);

    if (
  trendQualityHold.shouldExtendHold &&
  !shouldStopLoss
) {
  saveRecentOrder("CRYPTO_TREND_QUALITY_HOLD", symbol, {
    qty,
    currentPrice,
    profitPercent,
    highWater,
    dropFromHigh,
    trendQualityHold,
    adaptiveSwingRisk,
  });

  continue;
}

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

 journalTradeExit(symbol, {
  assetClass: "crypto",
  exitType: "AUTO_CRYPTO_EXIT",
  exitPrice: currentPrice,
  profitPercent,
  exitReason: reason,
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
    .filter((s) => Number(s.score || 0) >= CONFIG.minScoreToBuy)
    .filter((s) => !aiOwnedSymbols.has(normalizeSymbol(s.symbol)))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];

  if (!topCandidate) return false;

  const weakest = aiPositions.reduce((weak, pos) => {
    const weakSymbol = normalizeSymbol(weak.symbol);
    const posSymbol = normalizeSymbol(pos.symbol);

    const weakScore = Number(
      aiEntryScores[weakSymbol] ||
        engineState.aiEntryScores?.[weakSymbol]?.score ||
        engineState.aiEntryScores?.[weakSymbol] ||
        0
    );

    const posScore = Number(
      aiEntryScores[posSymbol] ||
        engineState.aiEntryScores?.[posSymbol]?.score ||
        engineState.aiEntryScores?.[posSymbol] ||
        0
    );

    return posScore < weakScore ? pos : weak;
  });

  const weakestSymbol = normalizeSymbol(weakest.symbol);

  const weakestScore = Number(
    aiEntryScores[weakestSymbol] ||
      engineState.aiEntryScores?.[weakestSymbol]?.score ||
      engineState.aiEntryScores?.[weakestSymbol] ||
      0
  );

  const scoreGap = Number(topCandidate.score || 0) - weakestScore;

  const rebalanceCheck = canRunSwingSafeRotation(weakest);

  if (!rebalanceCheck.allowed) {
    saveRecentOrder("REBALANCE_SKIPPED_SWING_SAFE", weakestSymbol, {
      replacementSymbol: topCandidate.symbol,
      replacementScore: topCandidate.score,
      weakestScore,
      scoreGap,
      reason: rebalanceCheck.reason,
    });

    return false;
  }

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

    markSwingSafeRotationUsed(weakestSymbol, topCandidate.symbol);

    setTimeout(async () => {
      try {
        const account = await getAccount();
        const freshPositions = await getPositions();
        const freshAiOwnedSymbols = await getAiOwnedSymbols();

        const freshAiPositions = freshPositions.filter((p) =>
          freshAiOwnedSymbols.has(normalizeSymbol(p.symbol))
        );

const portfolioManager =
  typeof calculateAiPortfolioManagerDecision === "function"
    ? calculateAiPortfolioManagerDecision(
        topCandidate,
        account,
        freshAiPositions,
        engineState.marketRegime || detectMarketRegime([])
      )
    : {
        approved: true,
        autoTradeApproved: true,
        aiPortfolioAction: "ALLOW",
        portfolioAction: "ALLOW",
        portfolioScore: 50,
        recommendedTradeAmount: 0,
        aiAllocationPercentOfBotBudget: 0,
        portfolioManagerReason:
          "AI_PORTFOLIO_MANAGER_UNAVAILABLE",
      };

        const tradeAmount = Number(
          portfolioManager.recommendedTradeAmount || 0
        );

        if (tradeAmount <= 0) {
          saveFailedOrder(
            "ROTATION_BUY_FAILED",
            topCandidate.symbol,
            "No capital available after rebalance"
          );
          return;
        }

        const buyOrder = await placeMarketBuy(
          topCandidate.symbol,
          tradeAmount,
          topCandidate.score
        );

        saveRecentOrder("ROTATED_IN_STRONGER_POSITION", topCandidate.symbol, {
          price: topCandidate.current,
          score: topCandidate.score,
          replacedSymbol: weakestSymbol,
          tradeAmount,
          portfolioManager,
          buyOrder,
        });
      } catch (err) {
        saveFailedOrder(
          "ROTATION_BUY_FAILED",
          topCandidate.symbol,
          err.message,
          {
            replacedSymbol: weakestSymbol,
            score: topCandidate.score,
          }
        );
      }
    }, 2500);

    return true;
  } catch (err) {
    saveFailedOrder(
      "ROTATION_SELL_FAILED",
      weakestSymbol,
      err.message,
      {
        replacementSymbol: topCandidate.symbol,
        replacementScore: topCandidate.score,
      }
    );

    return false;
  }
}

async function autoBuySignals(signals = []) {
  if (!["live_stock", "smart"].includes(TRADING_MODE)) return;

  const clock = await getClock();
  const allowClosedMarketStockBuying = true;

  if (!clock.is_open && !allowClosedMarketStockBuying) {
    saveRecentOrder("AUTO_STOCK_BUY_SKIPPED", "STOCK", {
      reason: "Market closed",
    });
    return;
  }

  if (!clock.is_open && allowClosedMarketStockBuying) {
    saveRecentOrder("AUTO_STOCK_AFTER_HOURS_ALLOWED", "STOCK", {
      reason: "Temporary override: stock buying allowed while market is closed",
    });
  }

  const account = await getAccount();
  const positions = await getPositions();
  const aiOwnedSymbols = await getAiOwnedSymbols();

  const aiPositions = positions.filter((position) =>
    aiOwnedSymbols.has(normalizeSymbol(position.symbol))
  );

    const aiStockPositions = aiPositions.filter((position) => {
    const symbol = normalizeSymbol(position.symbol);
    return !symbol.includes("/") && position.asset_class !== "crypto";
  });

  if (
    aiPositions.length >= CONFIG.maxOpenTrades ||
    aiStockPositions.length >= CONFIG.maxStockOpenTrades
  ) {
    const rotated = await replaceWeakestIfBetter(
      signals,
      positions,
      aiOwnedSymbols
    );

    if (!rotated) {
      saveRecentOrder("AUTO_STOCK_BUY_SKIPPED", "STOCK", {
        reason: "Max stock positions reached, no stronger rotation found",
      });
    }

    return;
  }


  const openSlots = Math.min(
    CONFIG.maxOpenTrades - aiPositions.length,
    CONFIG.maxStockOpenTrades - aiStockPositions.length
  );

const executableSymbols = new Set(
  (
    engineState.executionIntelligenceState?.topExecutableSignals || []
  ).map((signal) => normalizeSymbol(signal.symbol))
);

const candidates = signals
  .filter((signal) => {
    const symbol = normalizeSymbol(signal.symbol);
    const score = Number(signal.score || 0);
    const adaptiveMinScore = Number(
      engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
        CONFIG.minScoreToBuy
    );

    const executionApproved = executableSymbols.has(symbol);
    const normalQualified = signal.qualifiedToBuy === true;

    return (
      normalQualified ||
      (
        executionApproved &&
        score >= adaptiveMinScore &&
        signal.confirmations?.fakeBreakout !== true &&
        engineState.phase21AutonomousBrainState?.shouldBlockNewTrades !== true &&
        engineState.phase20AutonomousOrchestrationState?.shouldBlockNewTrades !== true
      )
    );
  })
  .filter((signal) => Number(signal.score || 0) >= CONFIG.minScoreToBuy)
    
    .filter((signal) => {
      const symbol = normalizeSymbol(signal.symbol);
      const lastSold = engineState.lastSoldAt[symbol] || 0;

      return (
        !aiOwnedSymbols.has(symbol) &&
        !positions.some((p) => normalizeSymbol(p.symbol) === symbol) &&
        Date.now() - lastSold > 120000
      );
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, openSlots);

  for (const candidate of candidates) {
    const symbol = normalizeSymbol(candidate.symbol);

    if (shouldSkipFromTradeMemory(symbol)) {
      saveRecentOrder("STOCK_SKIPPED_TRADE_MEMORY", symbol, {
        memory: engineState.tradeMemory?.[symbol],
      });
      continue;
    }

    const orchestratorGate =
      passesInstitutionalOrchestratorBuyGate(candidate);

    if (!orchestratorGate.allowed) {
      saveRecentOrder("STOCK_SKIPPED_ORCHESTRATOR", symbol, {
        reason: orchestratorGate.reason,
      });
      continue;
    }

    const parliamentGate =
      passesAutonomousParliamentGate(candidate);

    if (!parliamentGate.allowed) {
      saveRecentOrder("STOCK_SKIPPED_PARLIAMENT", symbol, {
        reason: parliamentGate.reason,
      });
      continue;
    }
const portfolioManager =
  typeof calculateAiPortfolioManagerDecision === "function"
    ? calculateAiPortfolioManagerDecision(
        candidate,
        account,
        aiPositions,
        engineState.marketRegime || detectMarketRegime([])
      )
    : {
        approved: true,
        autoTradeApproved: true,
        aiPortfolioAction: "ALLOW",
        portfolioAction: "ALLOW",
        portfolioScore: 50,
        recommendedTradeAmount: 0,
        aiAllocationPercentOfBotBudget: 0,
        portfolioManagerReason:
          "AI_PORTFOLIO_MANAGER_UNAVAILABLE",
      };

    const baseTradeAmount =
      Number(portfolioManager.recommendedTradeAmount || 0) ||
      getDynamicTradeAmount(account, aiPositions, candidate.score);

    const finalTradeAmount = Number(
      (
        baseTradeAmount *
        Number(orchestratorGate.orchestrator?.orchestratorMultiplier || 1) *
        Number(parliamentGate.multiplier || 1)
      ).toFixed(2)
    );

    if (!finalTradeAmount || finalTradeAmount <= 0) {
      saveRecentOrder("AUTO_STOCK_BUY_SKIPPED_SIZE_ZERO", symbol, {
        score: candidate.score,
        baseTradeAmount,
        portfolioManager,
        parliamentGate,
      });
      continue;
    }

    try {
      const adaptiveExecution =
        await executeAdaptiveBuyOrder({
          signal: candidate,
          totalAmount: finalTradeAmount,
          assetClass: "stock",
        });

      markAiManagedSymbol(symbol);

      engineState.aiEntryScores[symbol] = {
        score: candidate.score,
        institutionalScore: candidate.institutionalScore,
        technicalScore: candidate.technicalScore,
        statisticalScore: candidate.statisticalScore,
        setupType:
          classifyInstitutionalSetup({
            symbol,
            score: candidate.score,
            assetClass: "stock",
            marketRegime: engineState.marketRegime?.state,
            confirmations: candidate.confirmations || {},
            portfolioManager,
          }),
        enteredAt: new Date().toISOString(),
      };

      journalTradeEntry(symbol, {
        assetClass: "stock",
        entryType: "AUTO_STOCK_ENTRY",
        entryPrice: candidate.current || candidate.price,
        score: candidate.score,
        sector: candidate.estimatedSector || "General Market",
        marketRegime: engineState.marketRegime?.state,
        confirmations: candidate.confirmations || {},
        portfolioManager,
        tradeAmount: finalTradeAmount,
      });

      saveRecentOrder("AUTO_STOCK_BUY", symbol, {
        price: candidate.current || candidate.price,
        score: candidate.score,
        tradeAmount: finalTradeAmount,
        portfolioManager,
        orchestratorGate,
        parliamentGate,
        adaptiveExecution,
      });
    } catch (err) {
      saveFailedOrder("AUTO_STOCK_BUY_FAILED", symbol, err.message, {
        score: candidate.score,
        finalTradeAmount,
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
    if (!marketOpen && TRADING_MODE !== "live_crypto") {
    saveRecentOrder(
      "ROTATION_SKIPPED_MARKET_CLOSED",
      weakest?.symbol || "UNKNOWN",
      {
        replacementCandidate: topCandidate?.symbol,
      }
    );

    return false;
  }

  const weakestProfitPercent =
    Number(weakest.unrealized_plpc || 0) * 100;

  if (weakestProfitPercent >= 2) {
    saveRecentOrder(
      "ROTATION_SKIPPED_PROFITABLE_POSITION",
      weakest.symbol,
      {
        weakestProfitPercent,
        replacementCandidate: topCandidate.symbol,
      }
    );

    return false;
  }

  if (weakestProfitPercent > -4) {
    saveRecentOrder(
      "ROTATION_SKIPPED_POSITION_NOT_WEAK_ENOUGH",
      weakest.symbol,
      {
        weakestProfitPercent,
        replacementCandidate: topCandidate.symbol,
      }
    );

    return false;
  }

  const swingRotationCheck =
    canRunSwingSafeRotation(weakest);

  if (!swingRotationCheck.allowed) {
    saveRecentOrder(
      "CRYPTO_ROTATION_SKIPPED_SWING_SAFE",
      weakest.symbol,
      {
        replacementSymbol: topCandidate.symbol,
        replacementScore: topCandidate.score,
        reason: swingRotationCheck.reason,
        weakestProfitPercent,
      }
    );

    return false;
  }

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
       const tradeAmount = Math.min(cash, 25);

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

        journalTradeEntry(topCandidate.symbol, {
  entryType: "CRYPTO_ROTATED_IN",
  assetClass: "crypto",
  entryPrice:
    topCandidate.current || topCandidate.price || 0,
  score: topCandidate.score,
  strategy: "crypto_rotation",
  sector: "Crypto",
  marketRegime:
    engineState.marketRegime?.state || "unknown",
  confirmations: topCandidate.confirmations || {},
  tradeAmount,
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

function calculateAdaptiveCryptoPositionSize(signal = {}, account = {}) {
  const equity = Number(account?.equity || 0);
  const cash = Number(account?.cash || 0);
  const buyingPower = Number(account?.buying_power || cash || 0);

  const score = Number(signal.score || 0);
  const technicalScore = Number(signal.technicalScore || signal.technical?.score || 0);
  const statisticalScore = Number(signal.statisticalScore || 0);
  const percentChange = Math.abs(Number(signal.percentChange || 0));

  const baseCryptoBudget =
    equity * (CONFIG.maxBotExposurePercent / 100);

  const qualityMultiplier =
    score >= 90
      ? 1
      : score >= 80
      ? 0.75
      : score >= 70
      ? 0.5
      : 0.25;

  const technicalMultiplier =
    technicalScore >= 80 || statisticalScore >= 75
      ? 1
      : technicalScore >= 65
      ? 0.75
      : 0.5;

  const volatilityMultiplier =
    percentChange >= 12
      ? 0.35
      : percentChange >= 8
      ? 0.5
      : percentChange >= 5
      ? 0.75
      : 1;

  const macroMultiplier =
    engineState.macroRiskState?.shouldBlockNewTrades
      ? 0
      : Number(engineState.macroRiskState?.macroExposureMultiplier || 1);

  const recommendedAmount = Math.max(
    0,
    Math.min(
      baseCryptoBudget *
        qualityMultiplier *
        technicalMultiplier *
        volatilityMultiplier *
        macroMultiplier,
      cash,
      buyingPower
    )
  );

  return {
    recommendedAmount: Number(recommendedAmount.toFixed(2)),
    baseCryptoBudget: Number(baseCryptoBudget.toFixed(2)),
    qualityMultiplier,
    technicalMultiplier,
    volatilityMultiplier,
    macroMultiplier,
    reason:
      `Crypto size adjusted by quality x${qualityMultiplier}, ` +
      `technical x${technicalMultiplier}, volatility x${volatilityMultiplier}, ` +
      `macro x${macroMultiplier}`,
  };
}

async function autoBuyCryptoSignals(signals) {
  if (!["live_crypto", "live_stock", "smart"].includes(TRADING_MODE)) return;

  const account = await getAccount();

    const positions = await getPositions();
  const aiOwnedSymbols = await getAiOwnedSymbols();

  const aiPositions = positions.filter((position) =>
    aiOwnedSymbols.has(normalizeSymbol(position.symbol))
  );

  const aiCryptoPositions = aiPositions.filter((position) => {
    const symbol = normalizeSymbol(position.symbol);
    return symbol.includes("/") || position.asset_class === "crypto";
  });

  if (
    aiPositions.length >= CONFIG.maxOpenTrades ||
    aiCryptoPositions.length >= CONFIG.maxCryptoOpenTrades
  ) {
    saveRecentOrder("AUTO_CRYPTO_BUY_SKIPPED", "CRYPTO", {
      reason: "Max crypto or total AI positions reached",
      cryptoOpen: aiCryptoPositions.length,
      totalOpen: aiPositions.length,
      maxCryptoOpenTrades: CONFIG.maxCryptoOpenTrades,
      maxOpenTrades: CONFIG.maxOpenTrades,
    });
    return;
  }

  const openCryptoSlots = Math.min(
    CONFIG.maxOpenTrades - aiPositions.length,
    CONFIG.maxCryptoOpenTrades - aiCryptoPositions.length
  );

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
       signals
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
    .filter((s) => {
      const score = Number(s.score || 0);
      const spread = Number(s.spreadPercent || 0);
      const institutionalPassed =
        s.qualifiedToBuy === true ||
        s.cryptoInstitutionalQualification?.momentumPass === true;

      return (
        institutionalPassed &&
        score >= CONFIG.minScoreToBuy &&
        spread <= 0.85
      );
    })
    .filter((s) => {
      const sym = normalizeSymbol(s.symbol);
      const lastSold = engineState.lastSoldAt[sym] || 0;

      return !openSymbols.has(sym) && Date.now() - lastSold > 120000;
    })
    .slice(0, openSlots);

  for (const crypto of buyCandidates) {
    const symbol = normalizeSymbol(crypto.symbol);

const cryptoInstitutionalScore = Number(
  crypto.institutionalScore ||
  crypto.score ||
  0
);

const cryptoTechnicalScore = Number(
  crypto.technicalScore ||
  crypto.technicalIntelligence?.institutionalEntryScore ||
  0
);

const cryptoStatisticalScore = Number(
  crypto.statisticalScore ||
  crypto.statisticalEdge?.statisticalEdgeScore ||
  0
);

const cryptoBarsFound = Number(crypto.barsFound || 0);

const cryptoQualified =
  cryptoInstitutionalScore >= 60 &&
  cryptoTechnicalScore >= 55 &&
  cryptoStatisticalScore >= 50 &&
  cryptoBarsFound >= 10 &&
  crypto.qualifiedToBuy !== false;

if (!cryptoQualified) {
  saveRecentOrder("CRYPTO_SKIPPED_INSTITUTIONAL_FILTER", symbol, {
    institutionalScore: cryptoInstitutionalScore,
    technicalScore: cryptoTechnicalScore,
    statisticalScore: cryptoStatisticalScore,
    barsFound: cryptoBarsFound,
  });

  continue;
}

const cryptoOrchestratorGate =
  passesInstitutionalOrchestratorBuyGate({
    ...crypto,
    assetClass: "crypto",
    asset_class: "crypto",
  });

if (!cryptoOrchestratorGate.allowed) {
  saveRecentOrder("CRYPTO_SKIPPED_ORCHESTRATOR", symbol, {
    reason: cryptoOrchestratorGate.reason,
  });

  continue;
}

const cryptoParliamentGate =
  passesAutonomousParliamentGate({
    ...crypto,
    assetClass: "crypto",
    asset_class: "crypto",
  });

if (!cryptoParliamentGate.allowed) {
  saveRecentOrder("CRYPTO_SKIPPED_PARLIAMENT", symbol, {
    reason: cryptoParliamentGate.reason,
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



const adaptiveCryptoSizing =
  calculateAdaptiveCryptoPositionSize(
    crypto,
    account
  );

const finalTradeAmount =
  adaptiveCryptoSizing.recommendedAmount;

if (!finalTradeAmount || finalTradeAmount <= 0) {
  saveRecentOrder(
    "AUTO_CRYPTO_BUY_SKIPPED_SIZE_ZERO",
    crypto.symbol,
    {
      score: crypto.score,
      adaptiveCryptoSizing,
    }
  );

  continue;
}

const adaptiveExecution =
  await executeAdaptiveBuyOrder({
    signal: crypto,
    totalAmount:
      finalTradeAmount *
      Number(cryptoParliamentGate.multiplier || 1),
    assetClass: "crypto",
  });

markAiManagedSymbol(symbol);

journalTradeEntry(symbol, {
  assetClass: "crypto",
  entryType: "AUTO_CRYPTO_ENTRY",
  entryPrice: crypto.current || crypto.price,
  score: crypto.score,
  sector: "Crypto",
  confirmations: crypto.confirmations || {},
  tradeAmount: finalTradeAmount,
});

saveRecentOrder("AUTO_CRYPTO_BUY", crypto.symbol, {
  price: crypto.current,
  tradeAmount: finalTradeAmount,
  adaptiveCryptoSizing,
  cryptoOrchestratorGate,
  cryptoParliamentGate,
  adaptiveExecution,
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

    if (effectiveMode === "live_stock" || TRADING_MODE === "smart") {
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

for (const signal of allSignalsForAnalytics) {
  const cryptoRealism = calculateCryptoSignalRealismEngine(signal);

  signal.cryptoRealism = cryptoRealism;
  signal.realismAdjustedScore = cryptoRealism.realismScore;

  if (
    signal.assetClass === "crypto" ||
    signal.asset_class === "crypto" ||
    String(signal.symbol || "").includes("/")
  ) {
    signal.score = cryptoRealism.realismScore;
    signal.cryptoRiskPenalty = cryptoRealism.cryptoRiskPenalty;
    signal.cryptoRealismReason = cryptoRealism.cryptoRealismReason;

    signal.qualifiedToBuy =
      signal.qualifiedToBuy === true &&
      Number(signal.score || 0) >=
        Number(
          engineState.selfOptimizationState?.adaptiveMinScoreToBuy ||
            CONFIG.minScoreToBuy ||
            70
        );
  }
}

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

const capitalCompounding =
  calculateSmartCapitalCompoundingEngine(
    account,
    analyticsAiPositions
  );

engineState.capitalCompoundingState =
  capitalCompounding;

engineState.capitalCompoundingHistory.unshift(
  capitalCompounding
);

engineState.capitalCompoundingHistory =
  engineState.capitalCompoundingHistory.slice(0, 200);

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
const getUnifiedTechnicalScore = (signal = {}) => {
  const directScore = Number(
    signal.technicalIntelligence?.institutionalEntryScore ||
      signal.technicalScore ||
      0
  );

  if (directScore > 0) {
    return clampScore(directScore);
  }

  return clampScore(
    Number(signal.score || 0) * 0.85 +
      (Number(signal.barsFound || 0) >= 30
  ? 15
  : Number(signal.barsFound || 0) >= 20
  ? 10
  : Number(signal.barsFound || 0) >= 10
  ? 5
  : 0) +
      (signal.qualifiedToBuy !== false ? 5 : -20)
  );
};

const getUnifiedExhaustionRisk = (signal = {}) => {
  const directRisk = Number(
    signal.technicalIntelligence?.exhaustionRiskScore ||
      signal.exhaustionRiskScore ||
      0
  );

  if (directRisk > 0) {
    return clampScore(directRisk);
  }

  return clampScore(
    35 -
      (Number(signal.score || 0) >= 80 ? 10 : 0) +
      (signal.qualifiedToBuy === false ? 20 : 0)
  );
};

const technicalSignals =
  allSignalsForAnalytics.filter(
    (signal) => getUnifiedTechnicalScore(signal) >= 65
  );

const averageTechnicalScore =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) => sum + getUnifiedTechnicalScore(signal),
        0
      ) / allSignalsForAnalytics.length
    : 0;

const averageExhaustionRisk =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) => sum + getUnifiedExhaustionRisk(signal),
        0
      ) / allSignalsForAnalytics.length
    : 0;

engineState.technicalIntelligenceState = {
  updatedAt: new Date().toISOString(),
  qualifyingTechnicalSignals: technicalSignals.length,
  averageTechnicalScore: Number(averageTechnicalScore.toFixed(2)),
  averageExhaustionRisk: Number(averageExhaustionRisk.toFixed(2)),
  strongestTechnicalSetups:
    technicalSignals
      .slice(0, 5)
      .map((signal) => ({
        symbol: signal.symbol,
        score: signal.score,
        technicalScore: getUnifiedTechnicalScore(signal),
        exhaustionRisk: getUnifiedExhaustionRisk(signal),
      })),
};

engineState.technicalIntelligenceHistory.unshift(
  engineState.technicalIntelligenceState
);

engineState.technicalIntelligenceHistory =
  engineState.technicalIntelligenceHistory.slice(0, 200);

const orchestratedSignals =
  allSignalsForAnalytics.map((signal) => ({
    ...signal,
    institutionalOrchestrator:
      calculateInstitutionalAiPortfolioOrchestrator(signal),
  }));

for (const signal of orchestratedSignals) {
  const realismScore = Number(
    signal.realismAdjustedScore ||
    signal.cryptoRealism?.realismScore ||
    signal.score ||
    0
  );

  const spreadPercent = Number(
    signal.cryptoRealism?.spreadPercent || 0
  );

  const statisticalScore =
    Number(signal.statisticalScore || 0) +
    Number(signal.statisticalEdgeScore || 0) +
    Number(signal.statisticalEdge?.statisticalEdgeScore || 0);

  const timeframeDecision =
    signal.timeframeDecision || "WEAK_CONFIRMATION";

  const finalInstitutionalDecisionScore =
    Number(
      signal.institutionalOrchestrator
        ?.finalInstitutionalDecisionScore || 0
    );

  signal.qualifiedToBuy =
    realismScore >= CONFIG.minScoreToBuy &&
    finalInstitutionalDecisionScore >= 65 &&
    spreadPercent <= 0.65 &&
    timeframeDecision !== "TIMEFRAME_CONFLICT" &&
    (
      statisticalScore > 0 ||
      realismScore >= 85
    );
}

const deployableOrchestratedSignals =
  orchestratedSignals.filter((signal) => {
    const finalScore = Number(
      signal.institutionalOrchestrator?.finalInstitutionalDecisionScore || 0
    );

    const action =
      signal.institutionalOrchestrator?.orchestratorAction || "BLOCK_TRADE";

    const timeframeDecision =
      signal.timeframeDecision ||
      engineState.multiTimeframeState?.topAlignedSignals?.find(
        (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
      )?.timeframeDecision ||
      "WEAK_CONFIRMATION";

    return (
      finalScore >= 70 &&
      action !== "BLOCK_TRADE" &&
      timeframeDecision !== "TIMEFRAME_CONFLICT"
    );
  });

const averageOrchestratorScore =
  orchestratedSignals.length > 0
    ? orchestratedSignals.reduce(
        (sum, signal) =>
          sum +
          Number(
            signal.institutionalOrchestrator
              ?.finalInstitutionalDecisionScore || 0
          ),
        0
      ) / orchestratedSignals.length
    : 0;

    if (!engineState.statisticalMemoryState) {
  engineState.statisticalMemoryState = {
    updatedAt: new Date().toISOString(),
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  };
}

const reinforcedSignals =
  orchestratedSignals.filter(
    (signal) =>
      Number(
        signal.institutionalOrchestrator
          ?.probabilityReinforcement
          ?.reinforcedProbability || 0
      ) >= 70
  );

const weakeningSignals =
  orchestratedSignals.filter(
    (signal) =>
      signal.institutionalOrchestrator
        ?.probabilityReinforcement
        ?.reinforcementMode === "WEAKENING"
  );

const averageReinforcedProbability =
  orchestratedSignals.length > 0
    ? orchestratedSignals.reduce(
        (sum, signal) =>
          sum +
          Number(
            signal.institutionalOrchestrator
              ?.probabilityReinforcement
              ?.reinforcedProbability || 0
          ),
        0
      ) / orchestratedSignals.length
    : 0;

engineState.institutionalOrchestratorState = {
  updatedAt: new Date().toISOString(),
  totalSignals: orchestratedSignals.length,
  deployableSignals: deployableOrchestratedSignals.length,
  averageOrchestratorScore:
    Number(averageOrchestratorScore.toFixed(2)),

  reinforcedSignals: reinforcedSignals.length,

  weakeningSignals: weakeningSignals.length,

  averageReinforcedProbability:
    Number(
      averageReinforcedProbability.toFixed(2)
    ),

  strongestOrchestratedSignals:
    deployableOrchestratedSignals
      .slice(0, 5)
      .map((signal) => ({
        symbol: signal.symbol,
        score: signal.score,
        finalInstitutionalDecisionScore:
          signal.institutionalOrchestrator
            ?.finalInstitutionalDecisionScore,
        orchestratorAction:
          signal.institutionalOrchestrator
            ?.orchestratorAction,
        orchestratorMultiplier:
          signal.institutionalOrchestrator
            ?.orchestratorMultiplier,
      })),
};

engineState.institutionalOrchestratorHistory.unshift(
  engineState.institutionalOrchestratorState
);

engineState.institutionalOrchestratorHistory =
  engineState.institutionalOrchestratorHistory.slice(
    0,
    200
  );  

const dcfValuationSignals =
  allSignalsForAnalytics.filter(
    (signal) =>
      Number(signal.dcfValuationScore || 0) >= 65
  );

const highValuationRiskSignals =
  allSignalsForAnalytics.filter(
    (signal) =>
      Number(signal.valuationRiskScore || 0) >= 75
  );

const averageDcfValuationScore =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) =>
          sum +
          Number(signal.dcfValuationScore || 0),
        0
      ) / allSignalsForAnalytics.length
    : 0;

engineState.dcfValuationState = {
  updatedAt: new Date().toISOString(),

  qualifyingDcfSignals:
    dcfValuationSignals.length,

  highValuationRiskSignals:
    highValuationRiskSignals.length,

  averageDcfValuationScore:
    Number(
      averageDcfValuationScore.toFixed(2)
    ),

  strongestDcfSetups:
    dcfValuationSignals
      .slice(0, 5)
      .map((signal) => ({
        symbol: signal.symbol,
        score: signal.score,

        dcfValuationScore:
          signal.dcfValuationScore,

        valuationRiskScore:
          signal.valuationRiskScore,

        valuationLabel:
          signal.valuationLabel,

        qualityAdjustedMarginOfSafety:
          signal.qualityAdjustedMarginOfSafety,
      })),
};

engineState.dcfValuationHistory.unshift(
  engineState.dcfValuationState
);

engineState.dcfValuationHistory =
  engineState.dcfValuationHistory.slice(
    0,
    200
  );

const competitiveAdvantageSignals =
  allSignalsForAnalytics.filter(
    (signal) =>
      Number(signal.competitiveAdvantageScore || signal.moatScore || 0) >= 65
  );

const averageCompetitiveAdvantageScore =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) =>
          sum +
          Number(
            signal.competitiveAdvantageScore ||
              signal.moatScore ||
              0
          ),
        0
      ) / allSignalsForAnalytics.length
    : 0;

engineState.competitiveAdvantageState = {
  updatedAt: new Date().toISOString(),
  qualifyingMoatSignals: competitiveAdvantageSignals.length,
  averageCompetitiveAdvantageScore:
    Number(averageCompetitiveAdvantageScore.toFixed(2)),
  strongestMoatCandidates: competitiveAdvantageSignals
    .slice(0, 5)
    .map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      moatScore: signal.moatScore,
      competitiveAdvantageScore:
        signal.competitiveAdvantageScore,
      moatLabel: signal.moatLabel,
      estimatedSector: signal.estimatedSector,
    })),
};

engineState.competitiveAdvantageHistory.unshift(
  engineState.competitiveAdvantageState
);

engineState.competitiveAdvantageHistory =
  engineState.competitiveAdvantageHistory.slice(0, 200);

const earningsSignals =
  allSignalsForAnalytics.filter(
    (signal) => Number(signal.earningsScore || 0) >= 70
  );

const highEarningsRiskSignals =
  allSignalsForAnalytics.filter(
    (signal) =>
      signal.earningsRiskMode === "HIGH_EARNINGS_RISK" ||
      Number(signal.earningsVolatilityRiskScore || 0) >= 75
  );

const averageEarningsScore =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) =>
          sum + Number(signal.earningsScore || 0),
        0
      ) / allSignalsForAnalytics.length
    : 0;

const averageEarningsVolatilityRisk =
  allSignalsForAnalytics.length > 0
    ? allSignalsForAnalytics.reduce(
        (sum, signal) =>
          sum +
          Number(signal.earningsVolatilityRiskScore || 0),
        0
      ) / allSignalsForAnalytics.length
    : 0;

engineState.earningsIntelligenceState = {
  updatedAt: new Date().toISOString(),
  qualifyingEarningsSignals: earningsSignals.length,
  highEarningsRiskSignals: highEarningsRiskSignals.length,
  averageEarningsScore:
    Number(averageEarningsScore.toFixed(2)),
  averageEarningsVolatilityRisk:
    Number(averageEarningsVolatilityRisk.toFixed(2)),
  strongestEarningsSetups: earningsSignals
    .slice(0, 5)
    .map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      earningsScore: signal.earningsScore,
      earningsRiskMode: signal.earningsRiskMode,
      earningsAction: signal.earningsAction,
    })),
  riskiestEarningsSetups: highEarningsRiskSignals
    .slice(0, 5)
    .map((signal) => ({
      symbol: signal.symbol,
      score: signal.score,
      earningsScore: signal.earningsScore,
      earningsRiskMode: signal.earningsRiskMode,
      earningsVolatilityRiskScore:
        signal.earningsVolatilityRiskScore,
    })),
};

engineState.earningsIntelligenceHistory.unshift(
  engineState.earningsIntelligenceState
);

engineState.earningsIntelligenceHistory =
  engineState.earningsIntelligenceHistory.slice(0, 200);

  const portfolioOptimization =
  calculateBlackRockPortfolioOptimizer(
    account,
    analyticsAiPositions,
    allSignalsForAnalytics
  );
engineState.portfolioOptimizationState =
  portfolioOptimization;

engineState.portfolioOptimizationHistory.unshift(
  portfolioOptimization
);

engineState.portfolioOptimizationHistory =
  engineState.portfolioOptimizationHistory.slice(
    0,
    200
  );

const macroRisk =
  calculateBridgewaterMacroRiskEngine(
    allSignalsForAnalytics,
    engineState.marketRegime,
    marketCrashProtection,
    account
  );

engineState.macroRiskState = macroRisk;

engineState.macroRiskHistory.unshift(macroRisk);
engineState.macroRiskHistory =
  engineState.macroRiskHistory.slice(0, 200);

const marketCycleIntelligence =
  calculateAdaptiveMarketCycleIntelligence(
    allSignalsForAnalytics
  );

engineState.marketCycleIntelligenceState =
  marketCycleIntelligence;

engineState.marketCycleIntelligenceHistory.unshift(
  marketCycleIntelligence
);

engineState.marketCycleIntelligenceHistory =
  engineState.marketCycleIntelligenceHistory.slice(0, 200);

const liquidityIntelligence =
  calculateLiquidityIntelligenceEngine(
    allSignalsForAnalytics
  );

engineState.liquidityIntelligenceState =
  liquidityIntelligence;

engineState.liquidityIntelligenceHistory.unshift(
  liquidityIntelligence
);

engineState.liquidityIntelligenceHistory =
  engineState.liquidityIntelligenceHistory.slice(0, 200);

const correlationIntelligence =
  calculateCorrelationIntelligenceEngine(
    analyticsAiPositions,
    allSignalsForAnalytics
  );

engineState.correlationIntelligenceState =
  correlationIntelligence;

engineState.correlationIntelligenceHistory.unshift(
  correlationIntelligence
);

engineState.correlationIntelligenceHistory =
  engineState.correlationIntelligenceHistory.slice(0, 200);

const portfolioGovernor =
  calculateAutonomousPortfolioGovernor(
    account,
    analyticsAiPositions,
    allSignalsForAnalytics,
    engineState.portfolioOptimizationState,
    engineState.macroRiskState,
    marketCrashProtection
  );

engineState.portfolioGovernorState = portfolioGovernor;

engineState.portfolioGovernorHistory.unshift(portfolioGovernor);
engineState.portfolioGovernorHistory =
  engineState.portfolioGovernorHistory.slice(0, 200);

const selfOptimization =
  calculateAiSelfOptimizationLayer(
    allSignalsForAnalytics
  );

engineState.selfOptimizationState =
  selfOptimization;

engineState.selfOptimizationHistory.unshift(
  selfOptimization
);

engineState.selfOptimizationHistory =
  engineState.selfOptimizationHistory.slice(0, 200);

const reinforcementWeights =
  calculateReinforcementLearningWeightEngine(
    allSignalsForAnalytics
  );

engineState.reinforcementWeightState =
  reinforcementWeights;

engineState.reinforcementWeightHistory.unshift(
  reinforcementWeights
);

engineState.reinforcementWeightHistory =
  engineState.reinforcementWeightHistory.slice(0, 200);

const executionIntelligence =
  calculateInstitutionalExecutionIntelligence(
    allSignalsForAnalytics,
    analyticsAiPositions
  );

engineState.executionIntelligenceState =
  executionIntelligence;

engineState.executionIntelligenceHistory.unshift(
  executionIntelligence
);

engineState.executionIntelligenceHistory =
  engineState.executionIntelligenceHistory.slice(0, 200);

const autonomousTradingSystem =
  calculateFullInstitutionalAutonomousTradingSystem(
    allSignalsForAnalytics
  );

engineState.autonomousTradingSystemState =
  autonomousTradingSystem;

engineState.autonomousTradingSystemHistory.unshift(
  autonomousTradingSystem
);

engineState.autonomousTradingSystemHistory =
  engineState.autonomousTradingSystemHistory.slice(0, 200);

const phase20Orchestration =
  calculatePhase20AsyncMultiAgentOrchestration(
    allSignalsForAnalytics
  );

engineState.phase20AutonomousOrchestrationState =
  phase20Orchestration;

engineState.phase20AutonomousOrchestrationHistory.unshift(
  phase20Orchestration
);

engineState.phase20AutonomousOrchestrationHistory =
  engineState.phase20AutonomousOrchestrationHistory.slice(0, 200);

const crossEngineMemory =
  calculateCrossEngineMemoryEvolution(
    allSignalsForAnalytics
  );

engineState.crossEngineMemoryState = crossEngineMemory;

engineState.crossEngineMemoryHistory.unshift(
  crossEngineMemory
);

engineState.crossEngineMemoryHistory =
  engineState.crossEngineMemoryHistory.slice(0, 200);

const adaptiveExecutionTiming =
  calculateAdaptiveExecutionTimingIntelligence(
    allSignalsForAnalytics
  );

engineState.adaptiveExecutionTimingState =
  adaptiveExecutionTiming;

engineState.adaptiveExecutionTimingHistory.unshift(
  adaptiveExecutionTiming
);

engineState.adaptiveExecutionTimingHistory =
  engineState.adaptiveExecutionTimingHistory.slice(0, 200);

const phase21AutonomousBrain =
  calculatePhase21AutonomousInstitutionalBrain(
    allSignalsForAnalytics
  );

engineState.phase21AutonomousBrainState =
  phase21AutonomousBrain;

engineState.phase21AutonomousBrainHistory.unshift(
  phase21AutonomousBrain
);

engineState.phase21AutonomousBrainHistory =
  engineState.phase21AutonomousBrainHistory.slice(0, 200);

const liveAiPerformance =
  calculateLiveAiPerformanceAnalyticsEngine(
    account,
    analyticsAiPositions
  );

engineState.liveAiPerformanceState = liveAiPerformance;

engineState.liveAiPerformanceHistory.unshift(liveAiPerformance);
engineState.liveAiPerformanceHistory =
  engineState.liveAiPerformanceHistory.slice(0, 200);
  const selfHealingScanRecovery =
  calculateSelfHealingScanRecoveryEngine();

engineState.selfHealingScanState =
  selfHealingScanRecovery;

if (
  marketCrashProtection.shouldBlockNewTrades ||
  engineState.macroRiskState?.shouldBlockNewTrades ||
  engineState.portfolioGovernorState?.shouldBlockNewTrades
) {

  autoTradingEnabled = false;

  saveRecentOrder("AUTO_TRADING_BLOCKED_MACRO_RISK", "SYSTEM", {
    marketCrashProtection,
    macroRisk: engineState.macroRiskState,
  });
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
if (engineState.tradeJournalState) {
  const tradeJournalSnapshot = {
    timestamp: new Date().toISOString(),

    totalClosedTrades:
      engineState.tradeJournalState.totalClosedTrades || 0,

    winningTrades:
      engineState.tradeJournalState.winningTrades || 0,

    losingTrades:
      engineState.tradeJournalState.losingTrades || 0,

    averageProfitPercent:
      engineState.tradeJournalState.averageProfitPercent || 0,

    winRate:
      engineState.tradeJournalState.winRate || 0,
  };

  engineState.analyticsSnapshots.unshift({
    type: "TRADE_JOURNAL_ANALYTICS",
    ...tradeJournalSnapshot,
  });
}
engineState.analyticsSnapshots =
  engineState.analyticsSnapshots.slice(0, 300);
    saveEngineState("SCAN_COMPLETED");

    const marketStressLocked =
      engineState.marketStressLevel >= 25;

    const volatilityLocked =
      engineState.marketVolatility >= 18;

    const approvedStockSignals = stockSignals.filter(
      (signal) =>
        signal.qualifiedToBuy === true &&
        signal.autoTradeApproved === true &&
        Number(signal.score || 0) >= CONFIG.minScoreToBuy
    );

    const approvedCryptoSignals = cryptoSignals.filter(
      (signal) =>
        signal.qualifiedToBuy === true &&
        signal.autoTradeApproved === true &&
        Number(signal.score || 0) >= CONFIG.minScoreToBuy
    );

    const shouldRunStockAutoBuy =
      approvedStockSignals.length > 0 &&
      !tradingStoppedForDay &&
      !engineState.stockTradingStoppedForDay;

    const shouldRunCryptoAutoBuy =
      approvedCryptoSignals.length > 0 &&
      !tradingStoppedForDay &&
      !engineState.cryptoTradingStoppedForDay;

    const bestStockSignal = stockSignals
      .filter(
        (s) =>
          s.qualifiedToBuy === true &&
          s.autoTradeApproved === true
      )
      .sort((a, b) => b.score - a.score)[0];

    const bestCryptoSignal = cryptoSignals
      .filter(
        (s) =>
          s.qualifiedToBuy === true &&
          s.autoTradeApproved === true
      )
      .sort((a, b) => b.score - a.score)[0];

    const bestStockScore =
      bestStockSignal?.score || 0;

    const bestCryptoScore =
      bestCryptoSignal?.score || 0;

    if (TRADING_MODE === "smart") {
      effectiveMode =
        bestStockScore >= bestCryptoScore
          ? "live_stock"
          : "live_crypto";
    }

    if (
      autoTradingEnabled &&
      !engineState.dailyLossLocked &&
      !engineState.profitLocked &&
      !riskLocked
    ) {
      if (shouldRunStockAutoBuy) {
        await autoBuySignals(stockSignals);

        engineState.aiDecisionHistory.unshift({
          timestamp: new Date().toISOString(),
          type: marketOpen
            ? "AUTO_STOCK_BUY_EXECUTED"
            : "AUTO_STOCK_BUY_EXTENDED_HOURS_EXECUTED",
          signalCount: stockSignals.length,
          approvedSignalCount: approvedStockSignals.length,
          tradingMode: TRADING_MODE,
          effectiveMode,
          marketOpen,
        });

        engineState.aiDecisionHistory =
          engineState.aiDecisionHistory.slice(0, 300);
      }

      if (shouldRunCryptoAutoBuy) {
        await autoBuyCryptoSignals(cryptoSignals);

        engineState.aiDecisionHistory.unshift({
          timestamp: new Date().toISOString(),
          type: "AUTO_CRYPTO_BUY_EXECUTED",
          signalCount: cryptoSignals.length,
          approvedSignalCount: approvedCryptoSignals.length,
          tradingMode: TRADING_MODE,
          effectiveMode,
          marketOpen,
        });

        engineState.aiDecisionHistory =
          engineState.aiDecisionHistory.slice(0, 300);
      }

      if (!shouldRunStockAutoBuy && !shouldRunCryptoAutoBuy) {
        saveRecentOrder("AUTO_BUY_SKIPPED_NO_APPROVED_SIGNALS", "ALL", {
          stockApprovedCount: approvedStockSignals.length,
          cryptoApprovedCount: approvedCryptoSignals.length,
          tradingMode: TRADING_MODE,
          effectiveMode,
          marketOpen,
        });
      }
    }

    if (
      autoTradingEnabled &&
      !marketOpen &&
      !shouldRunStockAutoBuy &&
      !shouldRunCryptoAutoBuy
    ) {
      saveRecentOrder("BUY_SKIPPED_NO_APPROVED_EXTENDED_HOURS_SIGNAL", "ALL", {
        message:
          "Market closed, but extended-hours stock buying is allowed when approved stock signals exist.",
      });
    }
  } catch (err) {
    engineState.lastError = err.message;
    engineState.scanFailureCount =
  Number(engineState.scanFailureCount || 0) + 1;

engineState.selfHealingScanState = {
  updatedAt: new Date().toISOString(),
  recoveryAction: "SCAN_ERROR_RECORDED",
  recovered: false,
  error: err.message,
  scanFailureCount: engineState.scanFailureCount,
};

engineState.selfHealingScanHistory.unshift(
  engineState.selfHealingScanState
);

engineState.selfHealingScanHistory =
  engineState.selfHealingScanHistory.slice(0, 200);
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

        adaptiveSwingRisk: {
  mode: "SWING_ADAPTIVE",

  stock: {
    stopLossPercent: CONFIG.stopLossPercent,
    trailingStopPercent: CONFIG.trailingStopPercent,
    takeProfitPercent: CONFIG.takeProfitPercent,
  },

  crypto: {
    stopLossPercent: -4,
    trailingStopPercent: -3,
    takeProfitPercent: 8,
  },

  runner: {
    triggerPercent: CONFIG.runnerTriggerPercent,
    trailingStopPercent:
      CONFIG.runnerTrailingStopPercent,
  },

  engineState:
    engineState.adaptiveRiskState || null,

  description:
    "Adaptive swing exits active with wider institutional breathing room.",
},
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
                statisticalEdge:
          engineState.statisticalEdgeState || null,
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
        autonomousTradingSystem:
        engineState.autonomousTradingSystemState || null,
        phase20AutonomousOrchestration:
        engineState.phase20AutonomousOrchestrationState || null,
        crossEngineMemory:
        engineState.crossEngineMemoryState || null,
        adaptiveExecutionTiming:
        engineState.adaptiveExecutionTimingState || null,
        phase21AutonomousBrain:
        engineState.phase21AutonomousBrainState || null,
        executionIntelligence:
        engineState.executionIntelligenceState || null,
        reinforcementWeights:
        engineState.reinforcementWeightState || null,
        selfOptimization:
        engineState.selfOptimizationState || null,
        marketCycleIntelligence:
        engineState.marketCycleIntelligenceState || null,
        liquidityIntelligence:
        engineState.liquidityIntelligenceState || null,
        correlationIntelligence:
        engineState.correlationIntelligenceState || null,
        portfolioGovernor:
        engineState.portfolioGovernorState || null,
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
  statisticalMemoryState:
  engineState.statisticalMemoryState || {
    updatedAt: null,
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  },
institutionalWatchlist:
  engineState.institutionalWatchlist,
  analyticsSnapshots:
  engineState.analyticsSnapshots?.slice(0, 20) || [],

statisticalMemoryState:
  engineState.statisticalMemoryState || {
    updatedAt: null,
    setupHistory: [],
    setupPerformance: {},
    expectancyHistory: [],
    probabilityHistory: [],
  },
  statisticalEdgeState:
  engineState.statisticalEdgeState || null,

statisticalEdgeHistory:
  (engineState.statisticalEdgeHistory || []).slice(
    0,
    20
  ),
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
        runtimeConfig = saveRuntimeConfig({
      ...runtimeConfig,
      autoTradingEnabled,
    });
    saveEngineState("AUTO_TRADING_ENABLED");

    res.json({
      message: "Auto trading enabled",
      autoTradingEnabled,
    });
  });
  app.post("/reset-runtime-config", (req, res) => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }

    runtimeConfig = {};

    res.json({
      success: true,
      message:
        "runtime-config.json deleted successfully. Restart backend now.",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
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
      "maxStockOpenTrades",
      "maxCryptoOpenTrades",
      "autoTradingEnabled",
      "tradingMode",
      "tradingModeLocked",
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
  runtimeConfig = saveRuntimeConfig({
    ...CONFIG,
    tradingMode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
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

runtimeConfig = saveRuntimeConfig({
  ...runtimeConfig,
  tradingMode: TRADING_MODE,
  tradingModeLocked,
  autoTradingEnabled,
});

saveEngineState("TRADING_MODE_CHANGED");

console.log("MODE SWITCHED:", TRADING_MODE);

res.json({
  message: "Trading mode updated",
  mode: TRADING_MODE,
  tradingModeLocked,
  autoTradingEnabled,
});
});

app.post("/mode-lock/on", (req, res) => {
  tradingModeLocked = true;

  runtimeConfig = saveRuntimeConfig({
    ...runtimeConfig,
    tradingMode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
  });

  res.json({
    message: "Trading mode locked",
    mode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
  });
});

app.post("/mode-lock/off", (req, res) => {
  tradingModeLocked = false;

  runtimeConfig = saveRuntimeConfig({
    ...runtimeConfig,
    tradingMode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
  });

  res.json({
    message: "Trading mode unlocked",
    mode: TRADING_MODE,
    tradingModeLocked,
    autoTradingEnabled,
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

    app.get("/probability-reinforcement", async (req, res) => {
  try {
    res.json({
      ok: true,

      probabilityReinforcementState:
        engineState.probabilityReinforcementState || null,

      probabilityReinforcementHistory:
        (
          engineState.probabilityReinforcementHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

  app.get("/institutional-orchestrator", async (req, res) => {
  try {
    res.json({
      ok: true,

      institutionalOrchestratorState:
        engineState.institutionalOrchestratorState || null,

      institutionalOrchestratorHistory:
        (
          engineState.institutionalOrchestratorHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

  app.get("/dcf-valuation", async (req, res) => {
  try {
    res.json({
      ok: true,

      dcfValuationState:
        engineState.dcfValuationState || null,

      dcfValuationHistory:
        (
          engineState.dcfValuationHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

  app.get("/competitive-advantage", async (req, res) => {
  try {
    res.json({
      ok: true,

      competitiveAdvantageState:
        engineState.competitiveAdvantageState || null,

      competitiveAdvantageHistory:
        (
          engineState.competitiveAdvantageHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

  app.get("/earnings-intelligence", async (req, res) => {
  try {
    res.json({
      ok: true,

      earningsIntelligenceState:
        engineState.earningsIntelligenceState || null,

      earningsIntelligenceHistory:
        (
          engineState.earningsIntelligenceHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/portfolio-optimizer", async (req, res) => {
  try {
    res.json({
      ok: true,

      portfolioOptimizationState:
        engineState.portfolioOptimizationState || null,

      portfolioOptimizationHistory:
        (
          engineState.portfolioOptimizationHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

  app.get("/technical-intelligence", async (req, res) => {
  try {
    res.json({
      ok: true,
      technicalIntelligenceState:
        engineState.technicalIntelligenceState || null,

      technicalIntelligenceHistory:
        (
          engineState.technicalIntelligenceHistory || []
        ).slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

    app.get("/statistical-edge", async (req, res) => {
    try {
      res.json({
        ok: true,
        statisticalEdgeState:
          engineState.statisticalEdgeState || null,
        statisticalEdgeHistory:
          (engineState.statisticalEdgeHistory || []).slice(
            0,
            100
          ),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  });

  app.get("/capital-compounding", async (req, res) => {
  try {
    res.json({
      ok: true,
      capitalCompoundingState:
        engineState.capitalCompoundingState || null,
      equityCurveState:
        engineState.equityCurveState || null,
      drawdownRecoveryState:
        engineState.drawdownRecoveryState || null,
      adaptiveRiskState:
        engineState.adaptiveRiskState || null,
      capitalCompoundingHistory:
        (engineState.capitalCompoundingHistory || []).slice(
          0,
          100
        ),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
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
  app.get("/trade-journal", async (req, res) => {
  try {
    ensureTradeJournalState();

    res.json({
      ok: true,

      tradeJournalState:
        engineState.tradeJournalState,

      openEntries:
        engineState.tradeJournalOpenEntries,

      recentClosedTrades:
        (engineState.tradeJournalHistory || []).slice(
          0,
          100
        ),

      strategyPerformanceState:
        engineState.strategyPerformanceState,

      regimePerformanceState:
        engineState.regimePerformanceState,

      sectorPerformanceState:
        engineState.sectorPerformanceState,

      confirmationPerformanceState:
        engineState.confirmationPerformanceState,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
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
