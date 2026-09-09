import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { updateQuietCandidateOutcomes, normalizeOutcomeObservation, isOutcomeEvidenceQuarantined } from './quietCandidateOutcomeTracker.js';

// Durable pages, not one ever-growing engine-state object. Completed pages are
// retained for research; active pages are visited round-robin with bounded I/O.
export function createDiscoveryOutcomeStore(directory, { pageBytes = 2 * 1024 * 1024, maxRows = 1000, maxActivePages = 32768 } = {}) {
  let queue = Promise.resolve(), cursor = '', pending = 0;
  const queueLimit = 64;
  let peakPending = 0, rejected = 0, completed = 0, failed = 0;
  let indexed = false;
  const activePages = new Set();
  async function ensureIndex() {
    if (indexed) return;
    await fs.mkdir(directory, { recursive: true });
    activePages.clear();
    const iterator = await fs.opendir(directory);
    for await (const entry of iterator) {
      if (!entry.isFile() || !/^(stock|crypto)-\d{4}-\d{2}-\d{2}-[a-f0-9]{2}\.json$/.test(entry.name)) continue;
      if (activePages.size >= maxActivePages) throw new Error('Active outcome page index capacity exceeded');
      activePages.add(entry.name);
    }
    indexed = true;
  }
  const serial = work => {
    if (pending >= queueLimit) {
      rejected++;
      const error = new Error('Outcome storage queue full; retry required');
      error.code = 'OUTCOME_STORAGE_BACKPRESSURE';
      return Promise.reject(error);
    }
    pending++;
    peakPending = Math.max(peakPending, pending);
    const job = queue.then(work).then(result => { completed++; return result; }, error => {
      failed++; throw error;
    }).finally(() => { pending--; });
    queue = job.catch(() => {});
    return job;
  };
  const symbolOf = row => String(row.symbol || row.s || row.T || '').trim().toUpperCase();
  const filename = (asset, day, symbol) => `${asset}-${day}-${createHash('sha256').update(symbol).digest('hex').slice(0, 2)}.json`;
  async function read(file) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > pageBytes) throw new Error('Outcome page oversized');
      const page = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(page.observations) || !Array.isArray(page.missingBaselines) || page.observations.length > maxRows) throw new Error('Invalid outcome page');
      return { ...page, observations: page.observations.map(normalizeOutcomeObservation) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (path.dirname(file) === directory) return read(path.join(directory, 'archive', path.basename(file)));
        return { observations: [], missingBaselines: [] };
      }
      throw error;
    }
  }
  async function write(file, page) {
    const name = path.basename(file);
    if (!activePages.has(name) && activePages.size >= maxActivePages) throw new Error('Active outcome page capacity exceeded');
    const json = JSON.stringify(page);
    if (Buffer.byteLength(json) > pageBytes || page.observations.length + page.missingBaselines.length > maxRows) throw new Error('Outcome page capacity exceeded');
    const temporary = `${file}.tmp`;
    const handle = await fs.open(temporary, 'w');
    try { await handle.writeFile(json); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    activePages.add(name);
  }
  async function ingestNow(candidates, prices, options) {
    if (!['stock', 'crypto'].includes(options.assetClass) || !/^\d{4}-\d{2}-\d{2}$/.test(options.dayKey)) throw new Error('Invalid discovery cohort');
    await ensureIndex();
    const groups = new Map();
    for (const row of candidates) {
      const symbol = symbolOf(row);
      if (!symbol || symbol.length > 32) throw new Error('Invalid discovery symbol');
      const name = filename(options.assetClass, options.dayKey, symbol);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    // Update all still-active cohorts for observed symbols, not just today's
    // registration. This persists real peaks and later trade participation
    // across restarts without storing an unbounded tick history.
    const affected = new Set([...candidates, ...prices,
      ...(options.tradedSymbols || []).map(s => typeof s === 'string' ? { symbol: s } : s)]
      .map(row => filename(options.assetClass, options.dayKey, symbolOf(row)).slice(-7)));
    for (const name of activePages) {
      if (name.startsWith(`${options.assetClass}-`) && affected.has(name.slice(-7)) && !groups.has(name)) groups.set(name, []);
    }
    let registered = 0, missing = 0;
    for (const [name, rows] of groups) {
      const file = path.join(directory, name);
      const old = await read(file);
      const next = updateQuietCandidateOutcomes(old, rows, prices, { ...options, fullPopulationPage: true });
      const ids = new Set(next.observations.map(o => o.id));
      const failures = new Map(old.missingBaselines.map(o => [o.id, o]));
      for (const row of rows) {
        const symbol = symbolOf(row), id = `${options.assetClass}:${symbol}:${options.dayKey}`;
        if (ids.has(id)) { failures.delete(id); registered++; }
        else {
          failures.set(id, { id, symbol, observedDay: options.dayKey, observedAt: options.now || Date.now(), status: 'MISSING_BASELINE_EVIDENCE' });
          missing++;
        }
      }
      const page = { assetClass: options.assetClass, dayKey: old.dayKey || options.dayKey,
        observations: next.observations, missingBaselines: [...failures.values()] };
      if (JSON.stringify(page) !== JSON.stringify(old)) await write(file, page);
    }
    return { policy: 'DURABLE_FULL_POPULATION', registered, missingBaselines: missing, untracked: 0 };
  }
  async function processNow(fetchPrices, { maxPages = 8, now = Date.now(), tradeEvents = [] } = {}) {
    maxPages = Math.max(1, Math.min(256, Number(maxPages) || 8));
    await ensureIndex();
    // The capped index is loaded once, then updated atomically with our writes.
    // Worker runs no longer enumerate every filesystem entry on every tick.
    const next = [], first = [];
    const retain = (list, name) => { list.push(name); list.sort(); if (list.length > maxPages) list.pop(); };
    for (const name of activePages) {
      retain(first, name);
      if (name > cursor) retain(next, name);
    }
    const names = next.length ? next : first;
    let measured = 0;
    const errors = [];
    const recentMeasurements = [];
    for (const name of names) {
      try {
      const file = path.join(directory, name), page = await read(file);
      const dayKey = page.assetClass === 'stock'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(now)) : new Date(now).toISOString().slice(0, 10);
      // Confirmed fills may arrive even after the position was already sold.
      // Apply those events independently from due price measurements.
      if (tradeEvents.length) {
        const before = JSON.stringify(page.observations);
        page.observations = updateQuietCandidateOutcomes(page, [], [], {
          assetClass: page.assetClass, dayKey, now, tradeEvents, fullPopulationPage: true,
        }).observations;
        if (JSON.stringify(page.observations) !== before) await write(file, page);
      }
      const needsMeasurement = (o, d) => !isOutcomeEvidenceQuarantined(o) && (!o.measurements?.[d] ||
        (o.measurements[d].status !== 'MISSED_TARGET_WINDOW' && Object.keys(o.benchmarks || {}).some(b => o.benchmarks[b].baselinePrice > 0 && o.benchmarkMeasurements?.[d]?.[b] == null) &&
          (page.assetClass === 'stock' ? dayKey === o.targets?.[d] : now <= o.targetTimestamps?.[d] + 6 * 3600000)));
      const due = page.observations.filter(o => [1, 3, 5].some(d => needsMeasurement(o, d) &&
        (page.assetClass === 'stock' ? o.targets?.[d] <= dayKey : o.targetTimestamps?.[d] <= now)));
      if (due.length) {
        const symbols = [...new Set(due.flatMap(o => [o.symbol, ...Object.values(o.benchmarks || {}).filter(b => b.baselinePrice > 0).map(b => b.symbol)]))].filter(Boolean);
        const prices = [];
        for (let i = 0; i < symbols.length; i += 50) prices.push(...await fetchPrices(page.assetClass, symbols.slice(i, i + 50)));
        const result = updateQuietCandidateOutcomes(page, [], prices, { assetClass: page.assetClass, dayKey, now, fullPopulationPage: true });
        page.observations = result.observations;
        await write(file, page);
        measured += result.observations.filter(o => !isOutcomeEvidenceQuarantined(o) && Object.keys(o.measurements || {}).length).length;
      }
      recentMeasurements.push(...page.observations);
      recentMeasurements.sort((a, b) => b.observedAt - a.observedAt);
      recentMeasurements.splice(600);
      // Completed cohorts leave the active rotation, but are never deleted.
      const baselineRetryExpired = now - Date.parse(`${page.dayKey}T00:00:00Z`) > 10 * 86400000;
      const terminalMissing = page.missingBaselines.length === 0 || baselineRetryExpired;
      if (terminalMissing && page.observations.every(o => [1, 3, 5].every(d => !needsMeasurement(o, d)))) {
        page.missingBaselines = page.missingBaselines.map(o => ({ ...o, status: 'UNMEASURABLE_BASELINE', terminalAt: now }));
        page.completionStatus = page.missingBaselines.length || page.observations.some(o =>
          isOutcomeEvidenceQuarantined(o) ||
          [1, 3, 5].some(d => o.measurements?.[d]?.evidenceVerified !== true) ||
          Object.values(o.benchmarks || {}).some(b => !(b.baselinePrice > 0)) ||
          [1, 3, 5].some(d => Object.keys(o.benchmarks || {}).some(b => o.benchmarkMeasurements?.[d]?.[b] == null)))
          ? 'COMPLETE_WITH_UNAVAILABLE_EVIDENCE' : 'COMPLETE';
        await write(file, page);
        await fs.mkdir(path.join(directory, 'archive'), { recursive: true });
        await fs.rename(file, path.join(directory, 'archive', name));
        activePages.delete(name);
      }
      } catch (error) { errors.push({ page: name, error: error.message }); }
      finally { cursor = name; }
    }
    let oldestActiveDay = null;
    for (const name of activePages) {
      const cohortDay = name.slice(name.indexOf('-') + 1, name.indexOf('-') + 11);
      if (oldestActiveDay === null || cohortDay < oldestActiveDay) oldestActiveDay = cohortDay;
    }
    return { pagesProcessed: names.length, activePages: activePages.size, oldestActiveDay,
      oldestActiveAgeDays: oldestActiveDay ? Math.max(0, Math.floor((now - Date.parse(`${oldestActiveDay}T00:00:00Z`)) / 86400000)) : 0,
      measured, cursor, recentMeasurements, errors };
  }
  async function importNow(observations) {
    await ensureIndex();
    for (const observation of observations) {
      if (!['stock', 'crypto'].includes(observation.assetClass) || !/^\d{4}-\d{2}-\d{2}$/.test(observation.observedDay)) continue;
      const file = path.join(directory, filename(observation.assetClass, observation.observedDay, observation.symbol));
      const page = await read(file);
      if (!page.observations.some(o => o.id === observation.id)) {
        page.observations.push(observation);
        await write(file, { ...page, assetClass: observation.assetClass, dayKey: observation.observedDay });
      }
    }
  }
  return { getStatus: () => ({ pending, peakPending, queueLimit, rejected, completed, failed }),
    ingest: (rows, prices, options) => serial(() => ingestNow(rows, prices, options)),
    importObservations: rows => serial(() => importNow(rows)),
    process: (fetchPrices, options) => serial(() => processNow(fetchPrices, options)),
    readPage: (asset, day, symbol) => serial(() => read(path.join(directory, filename(asset, day, symbol)))) };
}
