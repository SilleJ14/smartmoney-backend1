import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { redactSecrets } from '../config/redactSecrets.js';
import { registerOperationalControlRoutes } from '../routes/operationalControlRoutes.js';

test('config responses never carry broker credentials', () => {
  const config = { maxStockPrice: 50, alpacaLiveKey: 'AK123', alpacaLiveSecret: 'shh', oandaPracticeToken: 'tok',
    oandaAccountId: '101-001', someApiKey: 'x', resendToken: '', stopLossPercent: -2 };
  const redacted = redactSecrets(config);
  assert.equal(redacted.maxStockPrice, 50);
  assert.equal(redacted.stopLossPercent, -2);
  for (const key of ['alpacaLiveKey', 'alpacaLiveSecret', 'oandaPracticeToken', 'oandaAccountId', 'someApiKey']) {
    assert.equal(redacted[key], '[redacted]', key);
  }
  assert.equal(redacted.resendToken, '', 'an unset secret stays visibly unset');
  assert.equal(config.alpacaLiveSecret, 'shh', 'the live CONFIG object is not mutated');
  assert.doesNotMatch(JSON.stringify(redacted), /AK123|shh|tok"|101-001/);
});

test('every server.js response that returns CONFIG or runtimeConfig is redacted', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  for (const pattern of [/status: "online",\s*autoTradingEnabled,\s*config: redactSecrets\(CONFIG\)/,
    /emergencyStopActive,\s*config: redactSecrets\(CONFIG\),\s*\}\)/,
    /registerConfigRoutes\(app, \{\s*requireAdmin,\s*getConfig: \(\) => redactSecrets\(CONFIG\)/,
    /registerDiagnosticRoutes\(app, \{\s*requireAdmin,\s*getState: \(\) => engineState,\s*getConfig: \(\) => redactSecrets\(CONFIG\)/]) {
    assert.match(source, pattern);
  }
  assert.doesNotMatch(source, /config: CONFIG,\s*runtimeConfig,/);
  assert.doesNotMatch(source, /permanent: true, config: CONFIG, runtimeConfig/);
});

test('an empty forex-credentials request does not erase stored credentials', () => {
  const routes = new Map();
  const updates = [];
  registerOperationalControlRoutes({ post: (path, _guard, handler) => routes.set(path, handler), get() {} }, {
    requireAdmin: (_req, _res, next) => next(), getControlState: () => ({}),
    updateControlState: (patch) => { updates.push(patch); return { forexAutoEnabled: false }; },
    recordOrder() {}, getClientIp: () => '1', saveEngineState() {}, resetDailyLossLock() {},
  });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const empty = response();
  routes.get('/forex-credentials')({ body: {} }, empty);
  assert.equal(empty.code, 400);
  assert.equal(updates.length, 0);
  routes.get('/forex-credentials')({ body: { token: 'new-token' } }, response());
  assert.deepEqual(updates, [{ oandaPracticeToken: 'new-token' }], 'a token-only update keeps the stored account ID');
});
