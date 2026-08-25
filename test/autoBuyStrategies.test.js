import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutoBuyStrategies,
  evaluateCanonicalStockAutoBuyEligibility,
  resolveCanonicalStockDecisionScore,
} from "../strategies/autoBuyStrategies.js";

test("stock auto-buy resolves the canonical Final Decision score before the legacy score", () => {
  assert.equal(resolveCanonicalStockDecisionScore({
    score: 55,
    stockDecisionScore: 86,
  }), 86);
  assert.equal(resolveCanonicalStockDecisionScore({
    score: 95,
    stockDecisionScore: 70,
    finalAutonomousDecisionScore: 82,
    masterFinalScore: 84,
  }), 84);
});

test("canonical stock approval ignores stale legacy booleans but preserves explicit safety blocks", () => {
  const signal = {
    score: 55,
    masterFinalScore: 86,
    entryQualityScore: 82,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    quoteFetchedAt: new Date().toISOString(),
    qualifiedToBuy: false,
    autoTradeApproved: false,
  };
  const canonical = evaluateCanonicalStockAutoBuyEligibility(signal, 78);
  assert.equal(canonical.approved, true);
  const suppressed = evaluateCanonicalStockAutoBuyEligibility({
    ...signal,
    phase9LiquiditySuppressed: true,
  }, 78);
  assert.equal(suppressed.approved, false);
  assert.ok(suppressed.evidence.reasons.includes("EXPLICIT_BUY_BLOCK"));
});

test("auto-buy strategies read trading mode at invocation time", async () => {
  let mode = "paper";
  let clockCalls = 0;
  const strategies = createAutoBuyStrategies({
    getTradingMode: () => mode,
    resetDailyMorningTradeCounter() {},
    canTakeMoreMorningTrades: () => true,
    getClock: async () => {
      clockCalls += 1;
      return { is_open: false };
    },
    recordOrder() {},
  });

  await strategies.autoBuySignals([]);
  assert.equal(clockCalls, 0);

  mode = "live_stock";
  await strategies.autoBuySignals([]);
  assert.equal(clockCalls, 1);
});

test("crypto auto-buy exits before broker access outside live modes", async () => {
  const strategies = createAutoBuyStrategies({
    getTradingMode: () => "paper",
    getAccount: async () => assert.fail("broker should not be called"),
  });

  await strategies.autoBuyCryptoSignals([]);
});

test("crypto auto-buy fails closed when spread availability has no measurement", async () => {
  let executionCalls = 0;
  const strategies = createAutoBuyStrategies({
    CONFIG: {
      maxCryptoOpenTrades: 3,
      maxOpenTrades: 8,
      minScoreToBuy: 70,
    },
    engineState: { aiManagedSymbols: [], lastSoldAt: {} },
    getTradingMode: () => "smart",
    getAccount: async () => ({ cash: 1_000, equity: 1_000 }),
    getPositions: async () => [],
    getBotOwnedSymbols: async () => new Set(),
    isAiManagedOpenPosition: () => false,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    rotateWeakCryptoIfBetter: async () => false,
    getDynamicTradeAmount: () => 100,
    getEffectiveBuyThreshold: () => 70,
    recordOrder() {},
    recordFailedOrder() {},
    executeAdaptiveBuyOrder: async () => {
      executionCalls += 1;
    },
  });

  await strategies.autoBuyCryptoSignals([{
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 100,
    windowDollarVolume: 1_000_000,
    spreadAvailable: true,
    spreadPercent: null,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(executionCalls, 0);

  await strategies.autoBuyCryptoSignals([{
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 95,
    bid: 90,
    ask: 100,
    spreadAvailable: true,
    spreadPercent: 0,
    windowDollarVolume: 1_000_000,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(
    executionCalls,
    0,
    "cached spreadPercent must not override a wide live bid/ask"
  );
});

test("crypto auto-buy fails closed without source-aware liquidity evidence", async () => {
  let executionCalls = 0;
  const strategies = createAutoBuyStrategies({
    CONFIG: {
      maxCryptoOpenTrades: 3,
      maxOpenTrades: 8,
      minScoreToBuy: 70,
    },
    engineState: { aiManagedSymbols: [], lastSoldAt: {} },
    getTradingMode: () => "smart",
    getAccount: async () => ({ cash: 1_000, equity: 1_000 }),
    getPositions: async () => [],
    getBotOwnedSymbols: async () => new Set(),
    isAiManagedOpenPosition: () => false,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    rotateWeakCryptoIfBetter: async () => false,
    getDynamicTradeAmount: () => 100,
    getEffectiveBuyThreshold: () => 70,
    recordOrder() {},
    recordFailedOrder() {},
    executeAdaptiveBuyOrder: async () => {
      executionCalls += 1;
    },
  });

  await strategies.autoBuyCryptoSignals([{
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 95,
    bid: 94.95,
    ask: 95.05,
    spreadAvailable: true,
    spreadPercent: 0.1,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(executionCalls, 0);

  await strategies.autoBuyCryptoSignals([{
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 95,
    bid: 94.95,
    ask: 95.05,
    spreadAvailable: true,
    spreadPercent: 0.1,
    dollarVolume24h: 0,
    windowDollarVolume: 100_000,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(
    executionCalls,
    0,
    "an explicit zero reported 24-hour volume must override a passing bar window"
  );
});

test("crypto auto-buy accepts complete evidence and trusts a narrow live quote over stale spread", async () => {
  let executionCalls = 0;
  const strategies = createAutoBuyStrategies({
    CONFIG: {
      maxCryptoOpenTrades: 3,
      maxOpenTrades: 8,
      minScoreToBuy: 70,
      maxBotExposurePercent: 80,
      cryptoMaxExposureShareOfBotExposure: 30,
      minCryptoTradeAmount: 25,
    },
    engineState: {
      aiManagedSymbols: [],
      lastSoldAt: {},
      tradeMemory: {},
    },
    getTradingMode: () => "smart",
    getAccount: async () => ({
      cash: 1_000,
      equity: 1_000,
      crypto_buying_power: 1_000,
    }),
    getPositions: async () => [],
    getBotOwnedSymbols: async () => new Set(),
    isAiManagedOpenPosition: () => false,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    rotateWeakCryptoIfBetter: async () => false,
    getDynamicTradeAmount: () => 100,
    getEffectiveBuyThreshold: () => 70,
    getCryptoAvailableBuyingPower: () => 1_000,
    getBotExposure: () => 0,
    isCrypto: () => true,
    passesInstitutionalOrchestratorBuyGate: () => ({ allowed: true }),
    passesAutonomousParliamentGate: () => ({ allowed: true, multiplier: 1 }),
    shouldSkipFromTradeMemory: () => false,
    calculateAdaptiveCryptoPositionSize: () => ({ recommendedAmount: 100 }),
    calculateFinalMasterDecisionProfile: () => ({
      finalScore: 90,
      finalSizingMultiplier: 1,
      suppressEntry: false,
      finalExitProfile: {},
    }),
    markAiManagedSymbol() {},
    journalTradeEntry() {},
    recordOrder() {},
    recordFailedOrder() {},
    executeAdaptiveBuyOrder: async () => {
      executionCalls += 1;
      return { ok: true };
    },
  });

  await strategies.autoBuyCryptoSignals([{
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    barsFound: 30,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    spreadAvailable: true,
    spreadPercent: 5,
    windowDollarVolume: 1_000_000,
    centralAutonomousDecisionCore: {
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(
    executionCalls,
    1,
    "complete evidence must still reach execution when the live quote is narrow"
  );
});
