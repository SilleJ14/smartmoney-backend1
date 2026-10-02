function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values, fraction) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  return rows[Math.min(rows.length - 1, Math.max(0, Math.ceil(rows.length * fraction) - 1))];
}

export function createForexDataQualityMonitor({
  nowFn = Date.now,
  maxEvents = 500,
  maxLatencySamples = 300,
} = {}) {
  const providers = new Map();
  const pairs = new Map();
  const events = [];
  const latency = new Map();

  function pushEvent(event) {
    events.push(Object.freeze({
      ...event,
      at: event.at || new Date(nowFn()).toISOString(),
    }));
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
  }

  return {
    recordProvider(provider, {
      ok,
      connected,
      entitled,
      measuredAt,
      heartbeatAt,
      error = null,
      limitation = null,
    } = {}) {
      const row = Object.freeze({
        provider,
        ok: ok === true,
        connected: connected === true,
        entitled: typeof entitled === "boolean" ? entitled : null,
        measuredAt: measuredAt || null,
        heartbeatAt: heartbeatAt || null,
        error,
        limitation,
        checkedAt: new Date(nowFn()).toISOString(),
      });
      providers.set(provider, row);
      if (!row.ok || row.error) pushEvent({ type: "PROVIDER_HEALTH", provider, error: row.error || "UNHEALTHY" });
      return row;
    },
    recordPairEvidence(symbol, {
      quoteAvailable,
      spreadAvailable,
      candlesAvailable,
      contextAvailable,
      quoteAgeMs,
      reasons = [],
    } = {}) {
      const row = Object.freeze({
        symbol,
        quoteAvailable: quoteAvailable === true,
        spreadAvailable: spreadAvailable === true,
        candlesAvailable: candlesAvailable === true,
        contextAvailable: contextAvailable === true,
        quoteAgeMs: finite(quoteAgeMs),
        reasons: [...new Set(reasons.filter(Boolean))],
        checkedAt: new Date(nowFn()).toISOString(),
      });
      pairs.set(symbol, row);
      if (row.reasons.length) pushEvent({ type: "PAIR_EVIDENCE", symbol, reasons: row.reasons });
      return row;
    },
    recordLatency(stage, milliseconds) {
      const parsed = finite(milliseconds);
      if (parsed === null || parsed < 0) {
        pushEvent({ type: "MALFORMED_LATENCY", stage });
        return false;
      }
      const rows = latency.get(stage) || [];
      rows.push(parsed);
      if (rows.length > maxLatencySamples) rows.splice(0, rows.length - maxLatencySamples);
      latency.set(stage, rows);
      return true;
    },
    recordMalformed(provider, reason, details = null) {
      pushEvent({ type: "MALFORMED_EVIDENCE", provider, reason, details });
    },
    snapshot() {
      return Object.freeze({
        generatedAt: new Date(nowFn()).toISOString(),
        providerHealth: Object.fromEntries(providers),
        pairEvidence: Object.fromEntries(pairs),
        latency: Object.fromEntries([...latency].map(([stage, rows]) => [stage, {
          count: rows.length,
          p50Ms: percentile(rows, 0.5),
          p95Ms: percentile(rows, 0.95),
          maxMs: rows.length ? Math.max(...rows) : null,
        }])),
        recentEvents: events.slice(-100),
      });
    },
  };
}
