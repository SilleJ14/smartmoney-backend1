import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForexDailyLoss, validateForexSettings } from '../forex/settingsControl.js';
import { createMemoryStore } from '../forex/durableStore.js';
import { resolveForexAutoEnabled } from '../config/runtimePolicy.js';
import { saveRuntimeConfig, loadRuntimeConfig } from '../state/runtimeConfig.js';
import { registerOperationalControlRoutes } from '../routes/operationalControlRoutes.js';

test('forex settings survive config reload; daily lock overrides environment ON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-settings-'));
  const file = path.join(dir, 'config.json');
  try {
    saveRuntimeConfig(file, { autoTradingEnabled: true, forexAutoEnabled: true, forexEmergencyStopActive: false });
    assert.equal(resolveForexAutoEnabled(loadRuntimeConfig(file), 'false'), true);
    saveRuntimeConfig(file, { forexAutoEnabled: false, forexDailyLossLocked: true });
    assert.equal(resolveForexAutoEnabled(loadRuntimeConfig(file), 'true'), false);
    assert.equal(loadRuntimeConfig(file).autoTradingEnabled, true);
    assert.equal(resolveForexAutoEnabled({ forexAutoEnabled: true, forexDailyLossLocked: true }), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('forex save validates confirmation, locks, and only returns forex controls', () => {
  const body = { forexAutoEnabled: true, forexEmergencyStopActive: false, autoTradingEnabled: false };
  assert.deepEqual(validateForexSettings(body, {}), { forexAutoEnabled: true, forexEmergencyStopActive: false });
  assert.throws(() => validateForexSettings(body, { forexDailyLossLocked: true }));
  assert.throws(() => validateForexSettings(body, { forexEmergencyStopActive: true }));
  assert.throws(() => validateForexSettings({ ...body, resetDailyLoss: true }, {}));
  assert.throws(() => validateForexSettings({ ...body, forexEmergencyStopActive: true }, {}));
  assert.doesNotThrow(() => validateForexSettings({ ...body, resetDailyLoss: true, confirmReset: true, confirmRelease: true }, { forexDailyLossLocked: true, forexEmergencyStopActive: true }));
});

test('daily reset uses fresh NAV and preserves unrelated locks and exposure', async () => {
  const store = createMemoryStore({ treatAsDurable: true });
  await store.commit(l => { l.incidentLocks.a = { reason: 'DAILY_LOSS_LOCK' }; l.incidentLocks.b = { reason: 'OTHER' };
    l.peakEquity.a = 2000; l.intents.push({ state: 'OUTCOME_UNKNOWN' }); });
  const client = { getAccount: async () => ({ account: { id: 'a', NAV: '1000', lastTransactionID: '15' } }) };
  await resetForexDailyLoss({ store, client, now: Date.parse('2026-09-23T15:00:00Z') });
  let ledger = await store.load();
  assert.equal(ledger.dayStart.a.equity, 1000);
  assert.equal(ledger.incidentLocks.a, undefined);
  assert.equal(ledger.incidentLocks.b.reason, 'OTHER');
  assert.equal(ledger.peakEquity.a, 2000);
  assert.equal(ledger.intents[0].state, 'OUTCOME_UNKNOWN');
  await store.commit(l => { l.incidentLocks.a = { reason: 'DRAWDOWN_LIMIT' }; });
  await resetForexDailyLoss({ store, client });
  ledger = await store.load();
  assert.equal(ledger.incidentLocks.a.reason, 'DRAWDOWN_LIMIT');
  await assert.rejects(resetForexDailyLoss({ store, client: { getAccount: async () => ({ account: { id: 'a', NAV: 'bad' } }) } }));
  store.setAvailable(false);
  await assert.rejects(resetForexDailyLoss({ store, client }));
});

test('settings API reports save failure and home toggle cannot bypass daily lock', async () => {
  const routes = new Map();
  let writes = 0;
  registerOperationalControlRoutes({ post: (p, ...h) => routes.set(p, h.at(-1)) }, {
    requireAdmin() {}, getControlState: () => ({ forexDailyLossLocked: true }),
    updateControlState: () => { writes++; }, saveForexSettings: async () => { throw new Error('disk unavailable'); },
  });
  const response = () => ({ status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } });
  const save = response(); await routes.get('/forex-settings')({ body: {} }, save);
  assert.equal(save.code, 409); assert.equal(save.body.ok, false);
  const on = response(); await routes.get('/forex-auto/on')({}, on);
  assert.equal(on.code, 423); assert.equal(writes, 0);
});
