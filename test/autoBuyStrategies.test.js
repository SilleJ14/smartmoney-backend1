import test from "node:test";
import { cryptoSetupEvidence } from './fixtures/cryptoSetupFixture.js';
import assert from "node:assert/strict";
import {
  applyLiveCryptoContextSizing,
  createAutoBuyStrategies,
  evaluateCanonicalStockAutoBuyEligibility,
  resolveCanonicalStockDecisionScore,
} from "../strategies/autoBuyStrategies.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";

test("live crypto order sizing applies breadth and BTC sharp-decline multipliers", () => {
  const sized = applyLiveCryptoContextSizing(200, {
    cryptoAnalyticalShadow: { S: { regimeMultiplier: 0.5 } },
    btcRegime: {
      available: true,
      state: "SHARP_DECLINE",
      suggestedRiskMultiplier: 0.5,
    },
  });
  assert.equal(sized.amount, 50);
  assert.equal(sized.breadthMultiplier, 0.5);
  assert.equal(sized.btcMultiplier, 0.5);
});

test("an automated crypto order receives the existing BTC decline size reduction", async () => {
  const now = Date.now();
  const setup = cryptoSetupEvidence(100, now);
  const candidate = {
    symbol: "BTC/USD",
    assetClass: "crypto",
    ...setup,
    barsFound: 220,
    current: 100,
    price: 100,
    bid: 99.95,
    ask: 100.05,
    spreadAvailable: true,
    priceIsLive: true,
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString(),
    liveQuoteSource: "alpaca_crypto_latest",
    spreadSource: "alpaca_crypto_latest",
    dollarVolume24h: 5_000_000_000,
    intendedNotional: 200,
    finalApprovedTradeAmount: 200,
    cryptoPeerChanges: [-1, -1, -1, -1, -1],
    cryptoDiscoveryScorecard: {
      score: 82,
      coverage: 1,
      calculatedAt: new Date(now).toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    btcRegime: {
      available: true,
      state: "SHARP_DECLINE",
      suggestedRiskMultiplier: 0.5,
    },
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
    authorizedDecisionValid: true,
    decisionUpdatedAt: new Date(now).toISOString(),
  };
  const evidence = buildCryptoDecisionScore(candidate, { now });
  assert.equal(evidence.cryptoAnalyticalShadow.E.state, "PASS");
  assert.equal(evidence.cryptoAnalyticalShadow.S.regimeMultiplier, 0.5);
  candidate.cryptoAnalyticalShadow = evidence.cryptoAnalyticalShadow;
  candidate.centralAutonomousDecisionCore = {
    action: "ALLOW",
    updatedAt: new Date(now).toISOString(),
    cryptoDecisionEvidence: evidence,
  };

  let submittedAmount = null;
  const strategies = createAutoBuyStrategies({
    CONFIG: {
      maxCryptoOpenTrades: 3,
      maxOpenTrades: 8,
      maxBotExposurePercent: 80,
      cryptoMaxExposureShareOfBotExposure: 30,
      minCryptoTradeAmount: 25,
    },
    engineState: { aiManagedSymbols: [], lastSoldAt: {}, tradeMemory: {} },
    getTradingMode: () => "smart",
    getAccount: async () => ({ cash: 10_000, equity: 10_000, crypto_buying_power: 10_000 }),
    getPositions: async () => [],
    getBotOwnedSymbols: async () => new Set(),
    isAiManagedOpenPosition: () => false,
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    rotateWeakCryptoIfBetter: async () => false,
    getDynamicTradeAmount: () => 200,
    getEffectiveBuyThreshold: () => 70,
    getCryptoAvailableBuyingPower: () => 10_000,
    getBotExposure: () => 0,
    isCrypto: () => true,
    shouldSkipFromTradeMemory: () => false,
    calculateAdaptiveCryptoPositionSize: () => ({ recommendedAmount: 200 }),
    calculateFinalMasterDecisionProfile: () => ({
      finalScore: 82,
      finalSizingMultiplier: 1,
      suppressEntry: false,
      finalExitProfile: {},
    }),
    markAiManagedSymbol() {},
    journalTradeEntry() {},
    recordOrder() {},
    recordFailedOrder() {},
    executeAdaptiveBuyOrder: async ({ totalAmount }) => {
      submittedAmount = totalAmount;
      return { ok: true };
    },
  });
  await strategies.autoBuyCryptoSignals([candidate]);
  assert.equal(submittedAmount, 50);
});

test("stock auto-buy resolves the canonical Final Decision score before the legacy score", () => {
  assert.equal(resolveCanonicalStockDecisionScore({
    score: 55,
    stockDecisionScore: 86,
    stockDecisionScoreAvailable: true,
  }), 86);
  assert.equal(resolveCanonicalStockDecisionScore({
    score: 95,
    stockDecisionScore: 70,
    finalAutonomousDecisionScore: 82,
    masterFinalScore: 84,
    stockDecisionScoreAvailable: true,
  }), 70);
});

test("canonical stock auto-buy requires explicit approvals and preserves safety blocks", () => {
  const now = new Date().toISOString();
  const signal = {
    score: 55,
    masterFinalScore: 86,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 82,
    entryQualityScorecard: { approved: true, coverage: 1 },
    discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1,
    centralAutonomousAction: "ALLOW",
    riskScore: 70,
    bid: 99.9,
    ask: 100.1,
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: now,
    qualifiedToBuy: false,
    autoTradeApproved: false,
    approved: false,
    backendApproved: false,
  };
  const canonical = evaluateCanonicalStockAutoBuyEligibility(signal, 78);
  assert.equal(canonical.approved, false);
  const explicitlyApproved = {
    ...signal,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
  };
  assert.equal(
    evaluateCanonicalStockAutoBuyEligibility(explicitlyApproved, 78).approved,
    true
  );
  const legacyPhase = evaluateCanonicalStockAutoBuyEligibility({
    ...explicitlyApproved,
    phase9LiquiditySuppressed: true,
  }, 78);
  assert.equal(legacyPhase.approved, true);
  const blocked = evaluateCanonicalStockAutoBuyEligibility({
    ...explicitlyApproved,
    blockBuying: true,
  }, 78);
  assert.equal(blocked.approved, false);
});

test("canonical stock auto-buy still requires approval at Final Decision 70", () => {
  const now = new Date().toISOString();
  const result = evaluateCanonicalStockAutoBuyEligibility({
    masterFinalScore: 70,
    stockDecisionScoreAvailable: true,
    entryQualityScore: 40,
    entryQualityScorecard: { approved: false, coverage: 0.2 },
    discoveryScorecard: { coverage: 0.2 },
    decisionScoreCoverage: 0.2,
    centralAutonomousAction: "WATCH",
    spreadPercent: 0.2,
    liveQuoteUpdatedAt: now,
    spreadUpdatedAt: now,
    liveQuoteSource: "alpaca_latest_stock_quote",
    spreadSource: "alpaca_latest_stock_quote",
    priceIsLive: true,
    decisionUpdatedAt: now,
  });
  assert.equal(result.approved, false);
  assert.equal(result.minimumScore, 70);
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
    ...cryptoSetupEvidence(),
    symbol: "BTC/USD",
    score: 90,
    masterFinalScore: 90,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
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

test("a legacy crypto score of 65 does not buy without the live analytical permission", async () => {
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
    score: 65,
    masterFinalScore: 65,
    ...cryptoSetupEvidence(),
    finalApprovedTradeAmount: 25,
    recommendedTradeAmount: 25,
    finalTradeAmount: 25,
    qualifiedToBuy: true,
    autoTradeApproved: true,
    approved: true,
    backendApproved: true,
    barsFound: 30,
    current: 100,
    bid: 99.95,
    ask: 100.05,
    spreadAvailable: true,
    spreadPercent: 5,
    windowDollarVolume: 1_000_000,
    priceIsLive: true,
    liveQuoteUpdatedAt: new Date().toISOString(),
    liveQuoteSource: "alpaca_crypto_latest",
    spreadUpdatedAt: new Date().toISOString(),
    spreadSource: "alpaca_crypto_latest",
    multiDayContinuationScore: 75,
    multiDayAccumulation: { seenDays: [1, 2].map((days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)) },
    cryptoDiscoveryScorecard: {
      stage: "CRYPTO_EARLY_DISCOVERY",
      score: 90,
      coverage: 1,
      calculatedAt: new Date().toISOString(),
      extension: { alreadyExtended: false },
    },
    newsCatalyst: { dataAvailable: true, riskDetected: false },
    centralAutonomousDecisionCore: {
      updatedAt: new Date().toISOString(), action: "ALLOW",
      cryptoDecisionEvidence: { coreEvidencePass: true },
    },
  }]);

  assert.equal(executionCalls, 0);
});
