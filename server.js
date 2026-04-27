import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

console.log("ENV CHECK:", {
  ALPACA_KEY: process.env.ALPACA_KEY ? "FOUND" : "MISSING",
  ALPACA_SECRET: process.env.ALPACA_SECRET ? "FOUND" : "MISSING",
  FINNHUB_API_KEY: process.env.FINNHUB_API_KEY ? "FOUND" : "MISSING",
});

const app = express();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 5000);

const ALPACA_KEY_ID = process.env.ALPACA_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

const ALPACA_TRADING_BASE_URL =
  process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";

const ALPACA_DATA_BASE_URL =
  process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets";

let autoTradingEnabled = process.env.AUTO_TRADING === "true";

const AI_ORDER_PREFIX = "SM_AI";

const CONFIG = {
  maxOpenTrades: Number(process.env.MAX_OPEN_TRADES || 5),
  minStockPrice: Number(process.env.MIN_STOCK_PRICE || 10),
  maxStockPrice: Number(process.env.MAX_STOCK_PRICE || 500),

  minScoreToBuy: Number(process.env.MIN_SCORE_TO_BUY || 90),

  baseTradeAmount: Number(process.env.BASE_TRADE_AMOUNT || 100),
  midTradeAmount: Number(process.env.MID_TRADE_AMOUNT || 150),
  highTradeAmount: Number(process.env.HIGH_TRADE_AMOUNT || 200),

  takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT || 8),
  stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || 4),
  trailingStopPercent: Number(process.env.TRAILING_STOP_PERCENT || 2),

  dailyLossLimitPercent: Number(process.env.DAILY_LOSS_LIMIT_PERCENT || 5),

  moversTop: Number(process.env.MOVERS_TOP || 100),
  minVolume: Number(process.env.MIN_VOLUME || 300000),
  maxPercentChange: Number(process.env.MAX_PERCENT_CHANGE || 35),
  maxSignalsToReturn: Number(process.env.MAX_SIGNALS_TO_RETURN || 40),
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
  dailyLossLocked: false,
  marketOpen: false,
};

const sellingNow = new Set();

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

  engineState.failedOrders = engineState.failedOrders.slice(0, 50);
}

function saveRecentOrder(type, symbol, extra = {}) {
  engineState.recentOrders.unshift({
    type,
    symbol,
    at: new Date().toISOString(),
    ...extra,
  });

  engineState.recentOrders = engineState.recentOrders.slice(0, 50);
}

function saveSkippedSymbol(symbol, reason) {
  engineState.skippedSymbols.unshift({
    symbol,
    reason,
    at: new Date().toISOString(),
  });

  engineState.skippedSymbols = engineState.skippedSymbols.slice(0, 100);
}

function getDynamicTradeAmount(score) {
  if (score >= 97) return CONFIG.highTradeAmount;
  if (score >= 93) return CONFIG.midTradeAmount;
  if (score >= CONFIG.minScoreToBuy) return CONFIG.baseTradeAmount;
  return 0;
}

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
    "Content-Type": "application/json",
  };
}

async function alpacaTradingRequest(path, options = {}) {
  const res = await fetch(`${ALPACA_TRADING_BASE_URL}${path}`, {
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

    if (asset.fractionable !== true) {
      return { ok: false, reason: "Asset is not fractionable" };
    }

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

function scoreStock(q) {
  let score = 0;

  if (q.current >= CONFIG.minStockPrice && q.current <= CONFIG.maxStockPrice) {
    score += 20;
  }

  if (q.percentChange > 0) score += 15;
  if (q.percentChange >= 1) score += 10;
  if (q.percentChange >= 2 && q.percentChange <= 20) score += 20;
  if (q.percentChange > 20 && q.percentChange <= CONFIG.maxPercentChange)
    score += 8;

  if (q.current > q.open) score += 20;
  if (q.current > q.previousClose) score += 15;

  if (q.current >= q.low && q.high > q.low) {
    const closeNearHigh = ((q.current - q.low) / (q.high - q.low)) * 100;
    if (closeNearHigh >= 70) score += 10;
  }

  if (q.volume >= CONFIG.minVolume) score += 10;

  return Math.min(score, 100);
}

function passesQualityFilters(q) {
  if (!q.current || q.current <= 0) {
    return { ok: false, reason: "No valid price" };
  }

  if (q.current < CONFIG.minStockPrice || q.current > CONFIG.maxStockPrice) {
    return { ok: false, reason: `Price outside range: $${q.current}` };
  }

  if (q.percentChange <= 0) {
    return { ok: false, reason: "No positive momentum" };
  }

  if (q.percentChange > CONFIG.maxPercentChange) {
    return { ok: false, reason: `Too extended: ${q.percentChange.toFixed(2)}%` };
  }

  if (q.open > 0 && q.current < q.open) {
    return { ok: false, reason: "Below open price" };
  }

  if (q.previousClose > 0 && q.current < q.previousClose) {
    return { ok: false, reason: "Below previous close" };
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
  return alpacaTradingRequest("/v2/orders?status=all&limit=100&direction=desc");
}

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

async function getTopMovers() {
  try {
    const top = Math.min(Math.max(CONFIG.moversTop, 1), 100);

    const data = await alpacaDataRequest(
      `/v1beta1/screener/stocks/movers?top=${top}`
    );

    const gainers = Array.isArray(data.gainers) ? data.gainers : [];
    const losers = Array.isArray(data.losers) ? data.losers : [];

    const symbols = [...gainers, ...losers]
      .map((item) => item.symbol)
      .filter(Boolean)
      .filter(isNormalStockSymbol);

    const uniqueSymbols = [...new Set(symbols)];

    if (uniqueSymbols.length > 0) {
      return uniqueSymbols;
    }

    console.log("No Alpaca movers found. Using Alpaca assets fallback...");
  } catch (err) {
    console.log("Alpaca movers failed. Using assets fallback:", err.message);
  }

  const assets = await alpacaTradingRequest(
    "/v2/assets?status=active&asset_class=us_equity"
  );

  const fallbackSymbols = assets
    .filter((asset) => asset.tradable === true)
    .filter((asset) => asset.fractionable === true)
    .map((asset) => asset.symbol)
    .filter(isNormalStockSymbol)
    .slice(0, 250);

  return [...new Set(fallbackSymbols)];
}

async function scanMarket() {
  const symbols = await getTopMovers();
  const results = [];

  engineState.skippedSymbols = [];

  console.log(`Scanning ${symbols.length} symbols...`);

  for (const symbol of symbols) {
    try {
      const assetCheck = await isAssetBuyEligible(symbol);

      if (!assetCheck.ok) {
        saveSkippedSymbol(symbol, assetCheck.reason);
        continue;
      }

      const quote = await finnhubQuote(symbol);
      const quality = passesQualityFilters(quote);

      if (!quality.ok) {
        saveSkippedSymbol(symbol, quality.reason);
        continue;
      }

      const score = scoreStock(quote);

      results.push({
        ...quote,
        score,
        qualifiedToBuy: score >= CONFIG.minScoreToBuy,
      });
    } catch (err) {
      saveSkippedSymbol(symbol, err.message);
      console.log(`Skipped ${symbol}: ${err.message}`);
    }
  }

  console.log(`Scan finished. Found ${results.length} stocks.`);

  return results
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.percentChange - a.percentChange;
    })
    .slice(0, CONFIG.maxSignalsToReturn);
}

async function placeMarketBuy(symbol, dollars) {
  const normalizedSymbol = normalizeSymbol(symbol);

  const assetCheck = await isAssetBuyEligible(normalizedSymbol);

  if (!assetCheck.ok) {
    throw new Error(assetCheck.reason);
  }

  return alpacaTradingRequest("/v2/orders", {
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

async function checkDailyLoss(account) {
  const equity = Number(account.equity || 0);

  if (!engineState.dailyStartEquity) {
    engineState.dailyStartEquity = equity;
    return false;
  }

  const lossPercent =
    ((engineState.dailyStartEquity - equity) / engineState.dailyStartEquity) *
    100;

  if (lossPercent >= CONFIG.dailyLossLimitPercent) {
    engineState.dailyLossLocked = true;
    autoTradingEnabled = false;

    saveRecentOrder("DAILY_LOSS_LOCKED", "ACCOUNT", {
      lossPercent,
      dailyLossLimitPercent: CONFIG.dailyLossLimitPercent,
    });

    return true;
  }

  return false;
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

  engineState.pendingExits = engineState.pendingExits.slice(0, 50);
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
    } catch (err) {
      saveFailedOrder("PENDING_EXIT_FAILED", exit.symbol, err.message, exit);
    }
  }
}

async function autoExitPositions(marketOpen) {
  const positions = await getPositions();
  const aiOwnedSymbols = await getAiOwnedSymbols();

  for (const pos of positions) {
    const symbol = normalizeSymbol(pos.symbol);

    if (!aiOwnedSymbols.has(symbol)) {
      continue;
    }

    const qty = Number(pos.qty);
    const currentPrice = Number(pos.current_price);
    const unrealizedPercent = Number(pos.unrealized_plpc) * 100;

    if (!qty || !currentPrice) continue;

    const shouldTakeProfit = unrealizedPercent >= CONFIG.takeProfitPercent;
    const shouldStopLoss = unrealizedPercent <= -CONFIG.stopLossPercent;

    if (!shouldTakeProfit && !shouldStopLoss) continue;

    const reason = shouldTakeProfit ? "TAKE_PROFIT" : "STOP_LOSS";

    if (!marketOpen) {
      addPendingExit(symbol, qty, reason, {
        price: currentPrice,
        profitPercent: unrealizedPercent,
      });

      saveRecentOrder("EXIT_PENDING_MARKET_CLOSED", symbol, {
        qty,
        price: currentPrice,
        profitPercent: unrealizedPercent,
        reason,
      });

      continue;
    }

    try {
      const order = await placeMarketSell(symbol, qty, reason);

      saveRecentOrder(reason, symbol, {
        qty,
        price: currentPrice,
        profitPercent: unrealizedPercent,
        order,
      });
    } catch (err) {
      saveFailedOrder(`${reason}_FAILED`, symbol, err.message, {
        qty,
        price: currentPrice,
        profitPercent: unrealizedPercent,
      });

      console.log(`Exit failed for ${symbol}:`, err.message);
    }
  }
}

async function autoBuySignals(signals) {
  const positions = await getPositions();
  const openSymbols = new Set(positions.map((p) => normalizeSymbol(p.symbol)));

  if (positions.length >= CONFIG.maxOpenTrades) return;

  const openSlots = CONFIG.maxOpenTrades - positions.length;

  const buyCandidates = signals
    .filter((s) => s.score >= CONFIG.minScoreToBuy)
    .filter((s) => s.qualifiedToBuy === true)
    .filter((s) => !openSymbols.has(normalizeSymbol(s.symbol)))
    .filter((s) => isNormalStockSymbol(s.symbol))
    .slice(0, openSlots);

  for (const stock of buyCandidates) {
    const tradeAmount = getDynamicTradeAmount(stock.score);

    if (tradeAmount <= 0) continue;

    try {
      const order = await placeMarketBuy(stock.symbol, tradeAmount);

      saveRecentOrder("AUTO_BUY", stock.symbol, {
        price: stock.current,
        score: stock.score,
        percentChange: stock.percentChange,
        tradeAmount,
        order,
      });
    } catch (err) {
      saveFailedOrder("AUTO_BUY_FAILED", stock.symbol, err.message, {
        price: stock.current,
        score: stock.score,
        tradeAmount,
      });

      console.log(`Buy failed for ${stock.symbol}:`, err.message);
    }
  }
}

async function engineTick() {
  if (engineState.running) return;

  engineState.running = true;
  engineState.lastError = null;

  try {
    if (!ALPACA_KEY_ID || !ALPACA_SECRET_KEY || !FINNHUB_API_KEY) {
      throw new Error("Missing API keys in environment variables");
    }

    const account = await getAccount();
    const clock = await getClock();
    const marketOpen = Boolean(clock.is_open);

    engineState.marketOpen = marketOpen;

    await checkDailyLoss(account);

    if (marketOpen) {
      await executePendingExits();
    }

    await autoExitPositions(marketOpen);

    const signals = await scanMarket();

    engineState.lastSignals = signals;
    engineState.lastScanAt = new Date().toISOString();

    if (autoTradingEnabled && !engineState.dailyLossLocked && marketOpen) {
      await autoBuySignals(signals);
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
  console.log("Running SmartMoney engine...");
  await engineTick();
});

app.get("/", (req, res) => {
  res.json({
    app: "SmartMoney Backend",
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
    const movers = await getTopMovers();

    res.json({
      ok: true,
      accountStatus: account.status,
      marketOpen: clock.is_open,
      moversCount: movers.length,
      firstMovers: movers.slice(0, 20),
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
    const clock = await getClock();

    res.json({
      online: true,
      autoTradingEnabled,
      config: CONFIG,
      account,
      clock,
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();

    res.json({
      alpacaOrders: orders,
      aiAlpacaOrders: orders.filter(isAiOrder),
      backendOrders: engineState.recentOrders,
      failedOrders: engineState.failedOrders,
      pendingExits: engineState.pendingExits,
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

  autoTradingEnabled = true;

  res.json({
    message: "Auto trading enabled",
    autoTradingEnabled,
  });
});

app.post("/auto-trading/off", (req, res) => {
  autoTradingEnabled = false;

  res.json({
    message: "Auto trading disabled",
    autoTradingEnabled,
  });
});

app.post("/close-position", async (req, res) => {
  const { symbol } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  try {
    const result = await closePosition(symbol.toUpperCase());

    saveRecentOrder("MANUAL_CLOSE", symbol.toUpperCase(), {
      result,
    });

    res.json({
      message: `Close position submitted for ${symbol.toUpperCase()}`,
      result,
    });
  } catch (err) {
    saveFailedOrder("MANUAL_CLOSE_FAILED", symbol.toUpperCase(), err.message);

    res.status(500).json({ error: err.message });
  }
});

app.post("/reset-daily-lock", (req, res) => {
  engineState.dailyLossLocked = false;
  engineState.dailyStartEquity = null;

  res.json({
    message: "Daily lock reset",
    engineState,
  });
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`SmartMoney backend running on port ${PORT}`);
  console.log(`Auto trading enabled: ${autoTradingEnabled}`);

  console.log("Running first SmartMoney scan on startup...");
  await engineTick();
});