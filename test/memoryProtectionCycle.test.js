import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineCycle } from '../engine/createEngineCycle.js';

for (const [marketOpen, lastMarketOpen] of [[true, true], [false, false], [true, false]]) {
  test(`memory pressure preserves exits and skips scans (market: ${lastMarketOpen} → ${marketOpen})`, async () => {
    const calls = [];
    const state = { lastMarketOpen, lastTradingDayKey: new Date().toISOString().slice(0,10),
      aiManagedSymbols: ['AAPL', 'BTC/USD'], dailyLossLocked: true };
    const record = name => async () => { calls.push(name); };
    const { executeEngineCycleBody } = createEngineCycle({
      engineState: state,
      getRuntime: () => ({ TRADING_MODE: 'smart', autoTradingEnabled: true, FINNHUB_API_KEY: 'fixture' }),
      getAlpacaKeys: () => ({ key: 'fixture', secret: 'fixture' }),
      getAccount: async () => ({ equity: 1000 }), resetDailySafetyStateIfNewDay: () => {},
      getPositions: async () => [{ symbol: 'AAPL', qty: 1 }, { symbol: 'BTC/USD', qty: 1 }],
      getBotOwnedSymbols: async () => new Set(['AAPL', 'BTC/USD']), normalizeSymbol: s => s,
      getClock: async () => ({ is_open: marketOpen }), getEffectiveTradingMode: () => 'smart',
      getEnabledStrategyModes: () => ({ stockModeEnabled: true, cryptoModeEnabled: true }),
      checkDailyLossAndProfitLock: async () => true,
      executePendingExits: record('pendingExits'), flattenStocksBeforeMarketClose: record('flatten'),
      autoExitPositions: record('stockExits'), autoExitCryptoPositions: record('cryptoExits'),
      getMemoryGuardState: () => ({ shouldPauseHeavyWork: true, pressure: 'critical' }),
      scanMarket: record('stockScan'), scanCryptoMarket: record('cryptoScan'),
      autoBuySignals: record('stockBuy'), autoBuyCryptoSignals: record('cryptoBuy'),
      runFastRunnerEngine: record('openingScan'), runQuickInstitutionalGate: record('openingGate'),
      runFullBrainFastSync: record('openingAnalysis'), runLiveStarterBuyGate: record('openingBuy'),
    });
    await executeEngineCycleBody();
    assert.deepEqual(calls, [...(marketOpen ? ['pendingExits'] : []), 'flatten', 'stockExits', 'cryptoExits']);
    assert.equal(state.lastEngineStopReason, 'MEMORY_GUARD_HEAVY_SCAN_SKIPPED');
    assert.equal(state.dailyLossLocked, true);
    assert.equal(state.cachedPositions.length, 2);
  });
}
