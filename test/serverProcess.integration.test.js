import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const soakMs = Math.max(0, Math.min(600000, Number(process.env.SMARTMONEY_SOAK_MS) || 0));
const scenarios = process.env.SMARTMONEY_FIXTURE_POLYGON ? [process.env.SMARTMONEY_FIXTURE_POLYGON]
  : ['', 'healthy', 'stream-burst', 'oversized', 'stalled', 'unavailable', 'malformed'];
for (const polygonFault of scenarios) {
test(`actual server boots, serves stocks and crypto, and completes a scan without trading (Polygon: ${polygonFault || 'disabled'})`, { timeout: 80000 + soakMs }, async t => {
  const fullLoad = process.env.SMARTMONEY_FIXTURE_LOAD === 'full' || polygonFault === 'healthy';
  const streamBurst = polygonFault === 'stream-burst';
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
    ENABLE_POLYGON_WEBSOCKET: 'false', ENABLE_FINNHUB_WEBSOCKET: streamBurst ? 'true' : 'false',
    SMARTMONEY_FIXTURE_STREAM: streamBurst ? 'finnhub' : '',
    SMARTMONEY_FIXTURE_LOAD: fullLoad ? 'full' : 'small',
    SMARTMONEY_FIXTURE_POPULATION: process.env.SMARTMONEY_FIXTURE_POPULATION || '',
    SMARTMONEY_FIXTURE_PROFILE: process.env.SMARTMONEY_FIXTURE_PROFILE || 'false',
    MAX_SYMBOLS_TO_SCAN: fullLoad ? '60' : '3',
    MIN_SYMBOLS_NEEDED: '3', MAX_ASSETS_FALLBACK: '60',
    ENABLE_LIVE_STARTER_BUY: 'false', ENABLE_LIVE_SCALE_IN: 'false', ENABLE_LIVE_POSITION_MANAGEMENT: 'false' };
  let log = '', metrics = {}, unsafe = false, peakRss = 0, profiles = [], burst = null;
  let maxRequestMs = 0, deliveredBurstTrades = 0;
  const profileTotals = new Map();
  const child = fork(fileURLToPath(new URL('../scripts/isolated-server-fixture.mjs', import.meta.url)), [], {
    cwd: directory, env, execArgv: ['--max-old-space-size=768'], silent: true,
  });
  child.stdout.on('data', d => { log = (log + d).slice(-16000); });
  child.stderr.on('data', d => { log = (log + d).slice(-16000); });
  child.on('message', m => {
    if (m.type === 'metrics') { metrics = m; peakRss = Math.max(peakRss, m.rss || 0); }
    if (m.type === 'unsafe-write') unsafe = true;
    if (m.type === 'profile') {
      profiles = [...profiles.slice(-7), m];
      for (const row of m.top) {
        const key = `${row.file}:${row.line}:${row.name}`;
        profileTotals.set(key, (profileTotals.get(key) || 0) + row.ms);
      }
    }
    if (m.type === 'burst-delivered') { burst = m; deliveredBurstTrades += m.count; }
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Boot deadline: ${log}`)), 15000);
      child.on('message', m => { if (m.type === 'listening') { clearTimeout(timer); resolve(m.port); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${log}`)); });
    });
    const read = async route => {
      let response;
      const requestStarted = performance.now();
      try {
        response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
        assert.equal(response.status, 200, `${route}: ${log}`);
        const body = await response.json();
        maxRequestMs = Math.max(maxRequestMs, performance.now() - requestStarted);
        return body;
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
    // Metrics arrive over IPC once a second, independently of the HTTP scan result.
    // Await that observation rather than racing a fast successful scan.
    const metricsDeadline = Date.now() + 3000;
    while ((!metrics.rss || (polygonFault && !metrics.polygonReads)) && Date.now() < metricsDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
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
    if (streamBurst) {
      for (let burstIndex = 0; burstIndex < 3; burstIndex++) {
        burst = null;
        child.send({ type: 'finnhub-burst', count: 200, separateFrames: burstIndex === 1 });
        const deliveryDeadline = Date.now() + 5000;
        while (!burst && Date.now() < deliveryDeadline && child.exitCode === null) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(child.exitCode, null, `stream burst crashed process: ${log}`);
        assert.equal(burst?.count, 200, `real Finnhub handler did not receive burst: ${log}`);
        assert.ok(burst.subscriptions >= 2);
        assert.ok(burst.crypto.includes(':'), 'crypto provider symbol was not subscribed');
        const afterBurst = await read('/health');
        assert.equal(afterBurst.autoTradingEnabled, false);
        assert.equal(unsafe, false);
        assert.equal(afterBurst.outcomeStorage?.rejected, 0, 'stream triggers exceeded durable outcome queue capacity');
        assert.ok(afterBurst.outcomeStorage?.peakPending <= afterBurst.outcomeStorage?.queueLimit);
        await read('/frontend/signals');
        await new Promise(resolve => setTimeout(resolve, 2200));
      }
      // Rejections happen in a later microtask, not inside onmessage's try/catch.
      assert.equal(child.exitCode, null, `stream burst caused an unhandled rejection: ${log}`);
      assert.equal((await read('/health')).engine.lastError, null);
      assert.doesNotMatch(log, /UNCAUGHT_EXCEPTION|Outcome storage queue full/);
    }
    const soakDeadline = Date.now() + soakMs;
    let requests = 0;
    const firstCycleAt = health.engine.lastSuccessfulCycleAt;
    let latestCycleAt = firstCycleAt;
    let outcomeStorage = health.outcomeStorage;
    let lastProgressAt = Date.now();
    while (Date.now() < soakDeadline) {
      const sample = await read('/health');
      latestCycleAt = sample.engine.lastSuccessfulCycleAt;
      outcomeStorage = sample.outcomeStorage;
      assert.equal(sample.engine.lastError, null, log);
      assert.notEqual(sample.outcomeWorker?.ok, false, JSON.stringify(sample.outcomeWorker));
      assert.equal(sample.autoTradingEnabled, false);
      assert.equal(unsafe, false);
      assert.equal(outcomeStorage?.rejected, 0, 'soak overflowed durable outcome queue');
      assert.ok(outcomeStorage?.peakPending <= outcomeStorage?.queueLimit);
      peakRss = Math.max(peakRss, metrics.rss || 0);
      assert.ok(peakRss < 1024 * 1024 * 1024, 'soak exceeded 1GB RSS');
      await read('/frontend/signals');
      if (streamBurst && requests % 10 === 0) child.send({ type: 'finnhub-burst', count: 200, separateFrames: requests % 20 === 0 });
      requests++;
      if (Date.now() - lastProgressAt >= 60000) {
        lastProgressAt = Date.now();
        console.log('SOAK_PROGRESS', JSON.stringify({ requests,
          remainingSeconds: Math.max(0, Math.ceil((soakDeadline - Date.now()) / 1000)),
          peakRssMB: Math.round(peakRss / 1048576), maxEventLoopDelayMs: metrics.maxEventLoopDelayMs,
          maxRequestMs: Math.round(maxRequestMs), deliveredBurstTrades,
          latestCycleAt, outcomeStorage, providerWrites: metrics.writes || 0 }));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (soakMs >= 360000) assert.notEqual(latestCycleAt, firstCycleAt, 'soak never completed the second scheduled scan');
    t.diagnostic(JSON.stringify({ soakMs, requests, peakRssMB: Math.round(peakRss / 1048576),
      providerReads: metrics.reads, polygonReads: metrics.polygonReads, providerWrites: metrics.writes || 0,
      maxEventLoopDelayMs: metrics.maxEventLoopDelayMs,
      maxRequestMs: Math.round(maxRequestMs), deliveredBurstTrades, nodeVersion: process.version,
      firstCycleAt, latestCycleAt, marketPopulation: env.SMARTMONEY_FIXTURE_POPULATION || (fullLoad ? '60' : '3'),
      outcomeStorage,
      stocks: health.candidates?.stocks, crypto: health.candidates?.crypto,
      ...(profileTotals.size ? { profileTotals: [...profileTotals].sort((a, b) => b[1] - a[1]).slice(0, 15) } : {}) }));
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
