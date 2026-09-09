import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const soakMs = Math.max(0, Math.min(600000, Number(process.env.SMARTMONEY_SOAK_MS) || 0));
const scenarios = process.env.SMARTMONEY_FIXTURE_POLYGON ? [process.env.SMARTMONEY_FIXTURE_POLYGON]
  : ['', 'healthy', 'oversized', 'stalled', 'unavailable', 'malformed'];
for (const polygonFault of scenarios) {
test(`actual server boots, serves stocks and crypto, and completes a scan without trading (Polygon: ${polygonFault || 'disabled'})`, { timeout: 80000 + soakMs }, async t => {
  const fullLoad = process.env.SMARTMONEY_FIXTURE_LOAD === 'full' || polygonFault === 'healthy';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smartmoney-isolated-server-'));
  const token = 'isolated-fixture-admin-not-a-real-credential';
  const row = symbol => ({ symbol, price: 100, current: 100, assetClass: symbol.includes('/') ? 'crypto' : 'stock',
    approved: false, backendApproved: false, qualifiedToBuy: false, autoTradeApproved: false });
  await fs.writeFile(path.join(directory, 'engine-state.json'), JSON.stringify({
    quietCandidateOutcomeState: null, lastStockSignals: [row('AAPL')], lastCryptoSignals: [row('BTC/USD')],
  }));
  // No inherited provider credentials, .env or production persistence directory.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: directory, TMP: directory,
    PORT: '0', DATA_DIR: directory, ADMIN_API_TOKEN: token, AUTO_TRADING_ENABLED: 'false',
    REAL_CASH_TRADING_UNLOCKED: 'false', TRADING_MODE: 'smart', RUN_STARTUP_ENGINE_SCAN: 'true',
    ALPACA_LIVE_KEY: 'fixture', ALPACA_LIVE_SECRET: 'fixture', FINNHUB_API_KEY: 'fixture',
    ENABLE_POLYGON: polygonFault ? 'true' : 'false', POLYGON_API_KEY: 'fixture', SMARTMONEY_FIXTURE_POLYGON: polygonFault,
    ENABLE_POLYGON_WEBSOCKET: 'false', ENABLE_FINNHUB_WEBSOCKET: 'false',
    SMARTMONEY_FIXTURE_LOAD: fullLoad ? 'full' : 'small',
    SMARTMONEY_FIXTURE_PROFILE: process.env.SMARTMONEY_FIXTURE_PROFILE || 'false',
    MAX_SYMBOLS_TO_SCAN: fullLoad ? '60' : '3',
    MIN_SYMBOLS_NEEDED: '3', MAX_ASSETS_FALLBACK: '60',
    ENABLE_LIVE_STARTER_BUY: 'false', ENABLE_LIVE_SCALE_IN: 'false', ENABLE_LIVE_POSITION_MANAGEMENT: 'false' };
  let log = '', metrics = {}, unsafe = false, peakRss = 0, profiles = [];
  const child = fork(fileURLToPath(new URL('../scripts/isolated-server-fixture.mjs', import.meta.url)), [], {
    cwd: directory, env, execArgv: ['--max-old-space-size=768'], silent: true,
  });
  child.stdout.on('data', d => { log = (log + d).slice(-16000); });
  child.stderr.on('data', d => { log = (log + d).slice(-16000); });
  child.on('message', m => {
    if (m.type === 'metrics') { metrics = m; peakRss = Math.max(peakRss, m.rss || 0); }
    if (m.type === 'unsafe-write') unsafe = true;
    if (m.type === 'profile') profiles = [...profiles.slice(-7), m];
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Boot deadline: ${log}`)), 15000);
      child.on('message', m => { if (m.type === 'listening') { clearTimeout(timer); resolve(m.port); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)); });
    });
    const read = async route => {
      let response;
      try {
        response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
        assert.equal(response.status, 200, `${route}: ${log}`);
        return await response.json();
      } catch (error) {
        // Keep the original timeout a failure, but allow a blocked event loop to
        // emit its diagnostic profile before the test-only child is terminated.
        if (env.SMARTMONEY_FIXTURE_PROFILE === 'true') await new Promise(resolve => setTimeout(resolve, 5000));
        throw new Error(`Request failed: ${route}; metrics=${JSON.stringify(metrics)}; profiles=${JSON.stringify(profiles)}\n${log.slice(-1000)}`, { cause: error });
      }
    };
    const initial = await read('/frontend/snapshot');
    assert.ok(initial.stockSignals.some(s => s.symbol === 'AAPL'), 'restart must preserve stock visibility');
    assert.ok(initial.cryptoSignals.some(s => s.symbol === 'BTC/USD'), 'restart must preserve crypto visibility');
    let health;
    const deadline = Date.now() + 55000;
    do {
      health = await read('/health');
      assert.equal(health.autoTradingEnabled, false);
      assert.equal(unsafe, false, 'fixture observed a provider mutation');
      if (health.engine.lastError) assert.fail(`${health.engine.lastError}\n${log}`);
      if (health.engine.lastSuccessfulCycleAt) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    assert.ok(health.engine.lastSuccessfulCycleAt, `Scan did not finish: ${log}`);
    assert.ok(peakRss < 1024 * 1024 * 1024, 'isolated server exceeded 1GB RSS');
    assert.equal(metrics.writes || 0, 0);
    if (polygonFault) assert.ok(metrics.polygonReads > 0, 'fixture did not exercise Polygon snapshot path');
    const snapshot = await read('/frontend/snapshot');
    const trace = await read('/discovery/trace?symbol=AAPL');
    assert.ok(trace.events.some(event => event.stage === 'SCAN_SELECTED'), 'real scan did not record candidate selection');
    assert.ok(trace.events.some(event => event.stage === 'SCAN_SCORED' || event.stage === 'SKIPPED'), 'real scan did not record outcome');
    assert.equal(trace.lastError, null);
    const unauthorizedTrace = await fetch(`http://127.0.0.1:${port}/discovery/trace?symbol=AAPL`);
    assert.equal(unauthorizedTrace.status, 401);
    assert.ok(snapshot.stockSignals.length > 0, `scan lost all stock candidates: ${log}`);
    assert.ok(snapshot.cryptoSignals.length > 0, `scan lost all crypto candidates: ${log}`);
    const soakDeadline = Date.now() + soakMs;
    let requests = 0;
    while (Date.now() < soakDeadline) {
      const sample = await read('/health');
      assert.equal(sample.engine.lastError, null, log);
      assert.notEqual(sample.outcomeWorker?.ok, false, JSON.stringify(sample.outcomeWorker));
      assert.equal(sample.autoTradingEnabled, false);
      assert.equal(unsafe, false);
      peakRss = Math.max(peakRss, metrics.rss || 0);
      assert.ok(peakRss < 1024 * 1024 * 1024, 'soak exceeded 1GB RSS');
      await read('/frontend/signals');
      requests++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    t.diagnostic(JSON.stringify({ soakMs, requests, peakRssMB: Math.round(peakRss / 1048576),
      providerReads: metrics.reads, polygonReads: metrics.polygonReads, providerWrites: metrics.writes || 0,
      stocks: health.candidates?.stocks, crypto: health.candidates?.crypto }));
  } finally {
    if (child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exit;
    }
    // Only this test-created directory, never a production state path.
    await fs.rm(directory, { recursive: true, force: true });
  }
});
}
