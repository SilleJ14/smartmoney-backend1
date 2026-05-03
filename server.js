import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
const CONFIG_FILE = path.resolve(process.cwd(), "runtime-config.json");

console.log("ENV CHECK:", {
  ALPACA_KEY: process.env.ALPACA_KEY ? "FOUND" : "MISSING",
  ALPACA_SECRET: process.env.ALPACA_SECRET ? "FOUND" : "MISSING",
  ALPACA_LIVE_SECRET: process.env.ALPACA_SECRET_KEY ? "FOUND" : "MISSING",
  ALPACA_LIVE_KEY: process.env.ALPACA_LIVE_KEY? "FOUND" : "MISSING",
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ? "FOUND" : "MISSING",
});

const app = express();
app.use(cors());
app.use(express.json());

let runtimeAlpacaKeys = {
  paperKey: process.env.ALPACA_PAPER_KEY || "",
  paperSecret: process.env.ALPACA_PAPER_SECRET || "",
  liveKey: process.env.ALPACA_LIVE_KEY || "",
  liveSecret: process.env.ALPACA_LIVE_SECRET || "",
};

app.post("/alpaca-keys", (req, res) => {
  const { paperKey, paperSecret, liveKey, liveSecret } = req.body;

  runtimeAlpacaKeys = {
    paperKey: paperKey || runtimeAlpacaKeys.paperKey,
    paperSecret: paperSecret || runtimeAlpacaKeys.paperSecret,
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

const runtimeConfig = loadRuntimeConfig();

// 🔥 Trading Mode (PERSISTED)
let TRADING_MODE =
  runtimeConfig.tradingMode ||
  process.env.TRADING_MODE ||
  "paper_stock";
  let tradingModeLocked =
  runtimeConfig.tradingModeLocked === true ||
  process.env.TRADING_MODE_LOCKED === "true";

function getAlpacaKeys() {
  if (TRADING_MODE === "paper_stock") {
    return {
      key: runtimeAlpacaKeys.paperKey || process.env.ALPACA_PAPER_KEY,
      secret: runtimeAlpacaKeys.paperSecret || process.env.ALPACA_PAPER_SECRET,
    };
  }

  if (TRADING_MODE === "live_stock" || TRADING_MODE === "live_crypto") {
    return {
      key: runtimeAlpacaKeys.liveKey || process.env.ALPACA_LIVE_KEY,
      secret: runtimeAlpacaKeys.liveSecret || process.env.ALPACA_LIVE_SECRET,
    };
  }

  return {
    key: runtimeAlpacaKeys.paperKey || process.env.ALPACA_PAPER_KEY,
    secret: runtimeAlpacaKeys.paperSecret || process.env.ALPACA_PAPER_SECRET,
  };
}

function getTradingBaseUrl() {
  if (TRADING_MODE === "paper_stock") {
    return "https://paper-api.alpaca.markets";
  }

  if (TRADING_MODE === "live_stock" || TRADING_MODE === "live_crypto") {
    return "https://api.alpaca.markets";
  }

  return "https://paper-api.alpaca.markets";
}

const ALPACA_DATA_BASE_URL =
  process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets";

let autoTradingEnabled = process.env.AUTO_TRADING === "true";

const AI_ORDER_PREFIX = "SM_AI";


const CONFIG = {
  maxOpenTrades: Number(process.env.MAX_OPEN_TRADES || 5),

  minStockPrice: Number(process.env.MIN_STOCK_PRICE || 1),
  maxStockPrice: 0,

  minScoreToBuy: Number(process.env.MIN_SCORE_TO_BUY || 80),
  replaceWeakestMinScoreGap: Number(process.env.REPLACE_SCORE_GAP || 5),

  maxBotExposurePercent: Number(process.env.MAX_BOT_EXPOSURE_PERCENT || 5),

  // EXIT SETTINGS
  takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT || 6),
  stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || 0.5),
  trailingStopPercent: Number(process.env.TRAILING_STOP_PERCENT || 0.5),

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
  maxPercentChange: Number(process.env.MAX_PERCENT_CHANGE || 60),
  maxSignalsToReturn: Number(process.env.MAX_SIGNALS_TO_RETURN || 40),

  topAutoTradeCandidates: Number(process.env.TOP_AUTO_TRADE_CANDIDATES || 5),

  // ADVANCED FILTERS (FIXED)
    // ADVANCED FILTERS
  enableAdvancedFilters: process.env.ENABLE_ADVANCED_FILTERS !== "false",
  minVolumeSpikeRatio: Number(process.env.MIN_VOLUME_SPIKE_RATIO || 0.5),
  minCloseNearHighPercent: Number(process.env.MIN_CLOSE_NEAR_HIGH_PERCENT || 35),
  fakeBreakoutMaxHighPullbackPercent: Number(
    process.env.FAKE_BREAKOUT_MAX_HIGH_PULLBACK_PERCENT || 2
  ),
  maxGapUpPercent: Number(process.env.MAX_GAP_UP_PERCENT || 30),

  // 🔥 IMPORTANT FIX
  requireAboveVwap: process.env.REQUIRE_ABOVE_VWAP === "true",

   enableNewsRiskFilter: process.env.ENABLE_NEWS_RISK_FILTER === "true",
  newsLookbackDays: Number(process.env.NEWS_LOOKBACK_DAYS || 3),
};

let engineState = {
  running: false,
  lastScanAt: null,
  lastError: null,
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
  marketOpen: false,

  highWaterMarks: {},
  tradeMemory: {},
  aiEntryScores: {},

   runnerPositions: {},
  lastSoldAt: {},
  peaksByMode: {},
  cachedPositions: [],
};

const sellingNow = new Set();
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
  const mode = TRADING_MODE || "paper_stock";
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
function saveFailedOrder(type, symbol, reason, extra = {}) {
  engineState.failedOrders.unshift({
    type,
    symbol,
    reason,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.failedOrders = engineState.failedOrders.slice(0, 100);
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
}

function saveSkippedSymbol(symbol, reason) {
  engineState.skippedSymbols.unshift({
    symbol,
    reason,
    at: new Date().toISOString(),
  });

  engineState.skippedSymbols = engineState.skippedSymbols.slice(0, 150);
}

function getBotExposure(openPositions = []) {
  return openPositions.reduce((sum, position) => {
    return sum + Math.abs(Number(position.market_value || 0));
  }, 0);
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
    throw new Error(
      data?.message ||
        data?.error ||
        `Alpaca trading error ${res.status}: ${JSON.stringify(data)}`
    );
  }

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

  const badEndings = ["W", "WS", "WT", "R", "RT", "U", "UN", "P", "PR"];

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
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    symbol
  )}&token=${FINNHUB_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || !data || typeof data.c !== "number") {
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
    };
  }

  const today = new Date();
  const from = new Date();

  from.setDate(today.getDate() - CONFIG.newsLookbackDays);

  const toDate = today.toISOString().slice(0, 10);
  const fromDate = from.toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(
    symbol
  )}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !Array.isArray(data)) {
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
      const text = `${item.headline || ""} ${item.summary || ""}`.toLowerCase();
      return riskyWords.some((word) => text.includes(word));
    });

    return {
      risk: riskyNews.length > 0,
      reason:
        riskyNews.length > 0
          ? "Risky news detected"
          : "No major risky news detected",
      headlines: riskyNews.slice(0, 3).map((item) => item.headline),
    };
 } catch {
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
if (q.current >= 5) score += 5;        // avoid penny stocks
if (q.volume >= 1000000) score += 10; // strong liquidity = institutions

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
function passesQualityFilters(q) {
  if (!q.current || q.current <= 0) {
    return { ok: false, reason: "No valid price" };
  }

  // 🔥 LIQUIDITY FILTER
 if (CONFIG.minScanVolume > 0 && q.volume < CONFIG.minScanVolume) {
  return {
    ok: false,
    reason: `Low volume (<${CONFIG.minScanVolume})`,
  };
}

  // 🔥 REMOVE DEAD / SLOW STOCKS
  if (Math.abs(q.percentChange) < 0.5) {
    return { ok: false, reason: "No meaningful movement" };
  }

  if (
    q.current < CONFIG.minStockPrice ||
    (CONFIG.maxStockPrice > 0 && q.current > CONFIG.maxStockPrice)
  ) {
    return { ok: false, reason: `Price outside range: $${q.current}` };
  }

  if (q.percentChange <= 0) {
    return { ok: false, reason: "No positive momentum" };
  }

  if (q.percentChange > CONFIG.maxPercentChange) {
    return {
      ok: false,
      reason: `Too extended: ${q.percentChange.toFixed(2)}%`,
    };
  }

  if (q.open > 0 && q.current < q.open) {
    return { ok: false, reason: "Below open price" };
  }

  if (q.previousClose > 0 && q.current < q.previousClose) {
    return { ok: false, reason: "Below previous close" };
  }
    const marketIsOpen = engineState.marketOpen === true;

  if (!marketIsOpen && q.percentChange > 25) {
    return {
      ok: false,
      reason: `After-hours move too extended: ${q.percentChange.toFixed(2)}%`,
    };
  }

  if (!marketIsOpen && q.confirmations?.pullbackFromHighPercent > 1.5) {
    return {
      ok: false,
      reason: `After-hours pullback risk: ${q.confirmations.pullbackFromHighPercent}%`,
    };
  }

   if (CONFIG.enableAdvancedFilters && q.confirmations) {
    const hasValidVolumeData =
      q.confirmations.barsFound > 0 &&
      q.confirmations.volumeSpikeRatio > 0;

    // Only enforce volume rule if data is valid
    if (hasValidVolumeData && !q.confirmations.volumeSpike) {
      return {
        ok: false,
        reason: `No volume spike. Ratio: ${q.confirmations.volumeSpikeRatio}`,
      };
    }
    if (CONFIG.requireAboveVwap && !q.confirmations.aboveVwap) {
      return { ok: false, reason: "Below VWAP confirmation" };
    }

    if (!q.confirmations.closeNearHigh) {
      return {
        ok: false,
        reason: `Not closing near high: ${q.confirmations.closeNearHighPercent}%`,
      };
    }

    if (q.confirmations.fakeBreakout) {
      return {
        ok: false,
        reason: `Fake breakout risk. Pulled back ${q.confirmations.pullbackFromHighPercent}% from high`,
      };
    }

    if (q.confirmations.gapTooHigh) {
      return {
        ok: false,
        reason: `Gap-up too high: ${q.confirmations.gapUpPercent}%`,
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
 if (TRADING_MODE !== "live_crypto" && TRADING_MODE !== "live_stock") {
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
        qualifiedToBuy: score >= 65,
      });
    } catch (err) {
      saveSkippedSymbol(symbol, err.message);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

async function placeCryptoMarketBuy(symbol, dollars) {
 if (TRADING_MODE !== "live_crypto" && TRADING_MODE !== "live_stock") {
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
  if (TRADING_MODE !== "live_crypto" && TRADING_MODE !== "live_stock") {
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
  const maxAssetsFallback = Number(process.env.MAX_ASSETS_FALLBACK || 0);

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

  const combinedSymbols = [...new Set([...moverSymbols, ...fallbackSymbols])];

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

      const quote = await finnhubQuote(symbol);

      const bars = await getRecentBars(symbol, "5Min", 30);
      const barStats = calculateBarStats(bars);

      quote.volume = Math.max(
        Number(quote.volume || 0),
        Number(barStats.lastVolume || 0)
      );

      quote.barVolume = Number(barStats.lastVolume || 0);
      quote.avgBarVolume = Math.round(Number(barStats.avgVolume || 0));

      if (CONFIG.enableAdvancedFilters) {
        quote.confirmations = await getAdvancedConfirmations(quote);
      }

      const quality = passesQualityFilters(quote);

      if (!quality.ok) {
        saveSkippedSymbol(symbol, quality.reason);
        return null;
      }

      const score = scoreStock(quote);

      return {
        ...quote,
        score,
        qualifiedToBuy: score >= CONFIG.minScoreToBuy,
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

  const assetCheck = await isAssetBuyEligible(normalizedSymbol);

  if (!assetCheck.ok) {
    throw new Error(assetCheck.reason);
  }

  const order = await alpacaTradingRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      symbol: normalizedSymbol,
      notional: Number(dollars.toFixed(2)),
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: `${AI_ORDER_PREFIX}_BUY_${normalizedSymbol}_${Date.now()}`,
    }),
  });

  engineState.aiEntryScores[normalizedSymbol] = score;

  return order;
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

  if (alreadyPending) return;

  engineState.pendingExits.unshift({
    symbol: normalizedSymbol,
    qty,
    reason,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.pendingExits = engineState.pendingExits.slice(0, 100);
}

async function forceCloseAllPositions(reason, marketOpen) {
  const positions = await getPositions();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);
    const qty = Number(pos.qty);

    if (!qty || qty <= 0) continue;

    if (!marketOpen) {
      addPendingExit(symbol, qty, reason, {
        message: "Market closed. Exit queued for next market open.",
      });

      saveRecentOrder("FORCE_CLOSE_PENDING_MARKET_CLOSED", symbol, {
        qty,
        reason,
      });

      continue;
    }

    try {
      const order = await placeMarketSell(symbol, qty, reason);

      saveRecentOrder("FORCE_CLOSE_EXECUTED", symbol, {
        qty,
        reason,
        order,
      });

      delete engineState.highWaterMarks[symbol];

      delete engineState.aiEntryScores[symbol];
      delete engineState.runnerPositions[symbol];
    } catch (err) {
      saveFailedOrder("FORCE_CLOSE_FAILED", symbol, err.message, {
        qty,
        reason,
      });
    }
  }
}

async function checkDailyLossAndProfitLock(account, marketOpen) {
  const equity = Number(account.equity || 0);
  const currentMode = TRADING_MODE || "paper_stock";

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

    if (!aiOwnedSymbols.has(symbol)) continue;

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
  if (TRADING_MODE !== "live_crypto" && TRADING_MODE !== "live_stock") return;

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

   const tradeAmount = getDynamicTradeAmount(
   account,
   freshAiPositions,
   topCandidate.score
 );

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

        saveRecentOrder("ROTATED_IN_STRONGER_POSITION", topCandidate.symbol, {
          price: topCandidate.current,
          score: topCandidate.score,
          confirmations: topCandidate.confirmations || null,
          replacedSymbol: weakestSymbol,
          tradeAmount,
          maxBotExposurePercent: CONFIG.maxBotExposurePercent,
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
    .filter((s) => s.score >= CONFIG.minScoreToBuy)
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => Number(s.percentChange || 0) >= 1.5)
    .filter((s) => Number(s.percentChange || 0) <= 25)
    .filter((s) => s.confirmations?.fakeBreakout !== true)
    .filter((s) => s.confirmations?.gapTooHigh !== true)
    .filter((s) => !openSymbols.has(normalizeSymbol(s.symbol)))
    .filter((s) => isNormalStockSymbol(s.symbol))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.min(openSlots, CONFIG.topAutoTradeCandidates));

for (const stock of buyCandidates) {
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

  const tradeAmount = getDynamicTradeAmount(
    account,
    freshAiPositions,
    stock.score
  );

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

    const order = await placeMarketBuy(stock.symbol, tradeAmount, stock.score);

    saveRecentOrder("AUTO_BUY", stock.symbol, {
      price: stock.current,
      score: stock.score,
      percentChange: stock.percentChange,
      confirmations: stock.confirmations || null,
      tradeAmount,
      maxBotExposurePercent: CONFIG.maxBotExposurePercent,
      order,
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
  if (TRADING_MODE !== "live_crypto") return false;

  const cryptoPositions = positions.filter((p) =>
    normalizeSymbol(p.symbol).endsWith("USD")
  );

  if (cryptoPositions.length < 3) return false;

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
 if (TRADING_MODE !== "live_crypto" && TRADING_MODE !== "live_stock") return;

  const account = await getAccount();
  const positions = await getPositions();
  const openSymbols = new Set(positions.map((p) => normalizeSymbol(p.symbol)));
const cash = Number(account.cash || 0);
const maxCryptoPositions = 3;

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
  .filter((s) => Number(s.score || 0) >= 85)
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
  engineState.lastError = null;
  engineState.cachedPositions = await getPositions();
  engineState.cachedAccount = await getAccount();

  try {
    const { key, secret } = getAlpacaKeys();

    if (!key || !secret || !FINNHUB_API_KEY) {
      throw new Error("Missing API keys in environment variables");
    }

    const account = await getAccount();
    const clock = await getClock();
    const marketOpen = Boolean(clock.is_open);

    engineState.marketOpen = marketOpen;

    const riskLocked = await checkDailyLossAndProfitLock(account, marketOpen);

    if (marketOpen) {
      await executePendingExits();
    }

await autoExitPositions(marketOpen);

const cryptoEnabled =
  TRADING_MODE === "live_crypto" || TRADING_MODE === "live_stock";

if (cryptoEnabled) {
  await autoExitCryptoPositions();
}

let stockSignals = [];
let cryptoSignals = [];

if (TRADING_MODE === "live_crypto") {
  cryptoSignals = await scanCryptoMarket();
} else if (TRADING_MODE === "live_stock") {
  if (marketOpen) {
    stockSignals = await scanMarket();
  }

  cryptoSignals = await scanCryptoMarket();
} else {
  stockSignals = await scanMarket();
}

const signals = [...stockSignals, ...cryptoSignals];

engineState.lastSignals = signals;
engineState.lastStockSignals = stockSignals;
engineState.lastCryptoSignals = cryptoSignals;
engineState.lastScanAt = new Date().toISOString();

if (
  autoTradingEnabled &&
  !engineState.dailyLossLocked &&
  !engineState.profitLocked &&
  !riskLocked
) {
  if (TRADING_MODE === "live_crypto") {
    await autoBuyCryptoSignals(cryptoSignals);
  } else if (TRADING_MODE === "live_stock") {
    if (marketOpen) {
      await autoBuySignals(stockSignals);
    }

    await autoBuyCryptoSignals(cryptoSignals);
  } else if (marketOpen) {
    await autoBuySignals(stockSignals);
  }
}

    if (autoTradingEnabled && !marketOpen) {
      saveRecentOrder("BUY_SKIPPED_MARKET_CLOSED", "ALL", {
        message: "Market closed. No new buys were placed.",
      });
    }
  } catch (err) {
    engineState.lastError = err.message;
    console.error("Engine error:", err.message);
  } finally {
    engineState.running = false;
  }
}

cron.schedule("* * * * *", async () => {
  console.log("Running SmartMoney Pro engine...");
  await engineTick();
});

app.get("/", (req, res) => {
  res.json({


    app: "SmartMoney Pro Backend",
    status: "online",
    autoTradingEnabled,
    config: CONFIG,
    engineState,
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
    if (TRADING_MODE !== "live_crypto") {
      return res.status(403).json({
        error: "Crypto is live trade only. Switch to live_crypto mode.",
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  res.json({
    message: "Remote config updated",
    config: CONFIG,
  });
});
app.post("/mode", (req, res) => {
  const { mode } = req.body;

  const validModes = ["paper_stock", "live_stock", "live_crypto"];
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
  await engineTick();
});
