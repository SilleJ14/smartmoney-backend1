import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRuntimeConfig, saveRuntimeConfig } from '../state/runtimeConfig.js';
import { resolveAutoTradingEnabled } from '../config/runtimePolicy.js';
import { resetDailySafetyState, recordTradingModeWithoutResettingSafety } from '../state/dailySafetyState.js';
import { assertPreTradeRisk } from '../risk/preTradeRiskGate.js';
import { createOrderService } from '../execution/orderService.js';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('async function checkDailyLossAndProfitLock(');
const stop = source.indexOf('\nfunction calculatePyramidScalingOpportunity', start);
const actualDailyCheck = source.slice(start, stop);

test('actual daily-loss and profit handlers preserve ON while locking buys and requesting exits', async () => {
  for (const profit of [false, true]) {
    const state = { lastMode: 'smart', dailyStartEquity: 1000, dailyPeakEquity: profit ? 1100 : 1000,
      profitLockFloorEquity: profit ? 1050 : null };
    const exits = [], saves = [];
    const check = new Function('engineState', 'CONFIG', 'forceCloseAllPositions', 'saveEngineState',
      'recordTradingModeWithoutResettingSafety', `let autoTradingEnabled = true; const TRADING_MODE = 'smart';
      const recordOrder = () => {}; ${actualDailyCheck}
      return async account => ({ locked: await checkDailyLossAndProfitLock(account, true), autoTradingEnabled });`)(
      state, { dailyLossLimitPercent: 2, profitLockTriggerPercent: 5, profitLockProtectPercent: 50 },
      async reason => exits.push(reason), reason => saves.push(reason), recordTradingModeWithoutResettingSafety);
    const result = await check({ equity: profit ? 1040 : 970 });
    assert.equal(result.locked, true);
    assert.equal(result.autoTradingEnabled, true);
    assert.equal(state[profit ? 'profitLocked' : 'dailyLossLocked'], true);
    assert.equal(exits.length, 1);
    assert.equal(saves.length, 1);
    assert.equal(resetDailySafetyState(state, { todayKey: '2026-09-11', equity: 1000 }).reset, true);
    assert.equal(state.dailyLossLocked, false);
    assert.equal(state.profitLocked, false);
    assert.equal((await check({ equity: 1000 })).autoTradingEnabled, true);
  }
});

test('ON and explicit OFF survive settings saves and reloads without environment overrides', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmoney-autopilot-test-'));
  try {
    const file = path.join(directory, 'runtime-config.json');
    for (const enabled of [true, false]) {
      saveRuntimeConfig(file, { autoTradingEnabled: enabled });
      saveRuntimeConfig(file, { tradingMode: 'live_crypto', maxBotExposurePercent: 20 });
      assert.equal(resolveAutoTradingEnabled(loadRuntimeConfig(file), String(!enabled)), enabled);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('order service buys only while enabled, allows exits through risk pauses, and resumes after transient failure', async () => {
  const context = { autoTradingEnabled: true, realCashTradingUnlocked: true, isCrypto: true,
    account: { equity: 1000, cash: 1000, buying_power: 1000 }, positions: [], price: 100,
    quoteIsLive: true, quoteAgeSeconds: 1, spreadAvailable: true, spreadPercent: .1,
    maxExposurePercent: 50, maxQuoteAgeSeconds: 5, maxSpreadPercent: 1 };
  const calls = []; let fail = false;
  const service = createOrderService({ normalizeSymbol: String,
    tradingRequest: async (_url, options) => {
      if (fail) { fail = false; throw new Error('temporary provider failure'); }
      calls.push(JSON.parse(options.body)); return { id: String(calls.length), status: 'new' };
    },
    preTradeRiskGuard: { assertAllowed: async (order, options) => {
      const check = () => assertPreTradeRisk({ order, options, context });
      check(); return { assertCurrent: check };
    } },
  });
  await service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 });
  context.dailyLossLocked = true;
  await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /Daily loss/);
  await service.cryptoMarketSell({ symbol: 'BTC/USD', qty: .1 });
  assert.equal(context.autoTradingEnabled, true);
  context.dailyLossLocked = false;
  fail = true;
  await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /temporary/);
  await service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 });
  context.autoTradingEnabled = false;
  await assert.rejects(service.cryptoMarketBuy({ symbol: 'BTC/USD', dollars: 25 }), /disabled/);
  await service.cryptoMarketSell({ symbol: 'BTC/USD', qty: .1 });
  assert.deepEqual(calls.map(call => call.side), ['buy', 'sell', 'buy', 'sell']);
});
