import { boundedJson, finiteOrNull, freshness, provenance, providerFailure } from "./providerUtils.js";

const ENDPOINT = "https://finnhub.io/api/v1/calendar/economic";

export function normalizeFinnhubMacroEvent(row) {
  if (!row || (!row.time && !row.date) || !row.event) throw new Error("FINNHUB_SCHEMA_INVALID");
  const timestamp = row.time
    ? new Date(Number(row.time) < 1e12 ? Number(row.time) * 1000 : Number(row.time)).toISOString()
    : new Date(row.date).toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("FINNHUB_SCHEMA_INVALID");
  return Object.freeze({
    event: String(row.event),
    country: row.country == null ? null : String(row.country),
    currency: row.currency == null ? null : String(row.currency),
    impact: row.impact == null ? null : String(row.impact),
    timestamp,
    actual: finiteOrNull(row.actual),
    estimate: finiteOrNull(row.estimate),
    previous: finiteOrNull(row.prev ?? row.previous),
    unit: row.unit == null ? null : String(row.unit),
  });
}

export function createFinnhubMacroProvider({
  apiKey,
  fetchImpl,
  endpoint = ENDPOINT,
  timeoutMs,
  maxBytes,
  maxAgeMs = 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  return Object.freeze({
    async observations({ from, to } = {}) {
      const observedAt = new Date(now()).toISOString();
      try {
        if (!from || !to) throw new Error("FINNHUB_SCHEMA_RANGE_REQUIRED");
        const url = new URL(endpoint);
        url.searchParams.set("from", from);
        url.searchParams.set("to", to);
        if (apiKey) url.searchParams.set("token", apiKey);
        const { data, sourceUrl } = await boundedJson(url, { fetchImpl, timeoutMs, maxBytes });
        const sourceRows = data?.economicCalendar;
        if (!Array.isArray(sourceRows)) throw new Error("FINNHUB_SCHEMA_INVALID");
        const rows = sourceRows.map(normalizeFinnhubMacroEvent);
        const publishedAt = rows.reduce((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest) ? row.timestamp : latest, null);
        return Object.freeze({
          ...freshness(publishedAt, { now: now(), maxAgeMs }),
          observations: Object.freeze(rows),
          provenance: provenance({ provider: "FINNHUB_MACRO", sourceUrl, observedAt, publishedAt }),
        });
      } catch (error) {
        return providerFailure(error, "FINNHUB_MACRO", observedAt);
      }
    },
  });
}
