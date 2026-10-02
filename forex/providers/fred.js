import { boundedJson, finiteOrNull, freshness, provenance, providerFailure } from "./providerUtils.js";

const ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";

export function createFredProvider({
  apiKey,
  fetchImpl,
  endpoint = ENDPOINT,
  timeoutMs,
  maxBytes,
  maxAgeMs = 36 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  async function observations(seriesId, { vintageDate, limit = 1000 } = {}) {
    const observedAt = new Date(now()).toISOString();
    try {
      if (!seriesId || !vintageDate) throw new Error("FRED_SCHEMA_VINTAGE_REQUIRED");
      const url = new URL(endpoint);
      url.searchParams.set("series_id", seriesId);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("realtime_start", vintageDate);
      url.searchParams.set("realtime_end", vintageDate);
      url.searchParams.set("limit", String(Math.min(10000, Math.max(1, limit))));
      if (apiKey) url.searchParams.set("api_key", apiKey);
      const { data, sourceUrl } = await boundedJson(url, { fetchImpl, timeoutMs, maxBytes });
      if (!Array.isArray(data?.observations)) throw new Error("FRED_SCHEMA_INVALID");
      const rows = data.observations.map((row) => {
        if (!row || typeof row.date !== "string") throw new Error("FRED_SCHEMA_INVALID");
        return Object.freeze({
          seriesId: String(seriesId),
          date: row.date,
          value: finiteOrNull(row.value),
          realtimeStart: row.realtime_start || vintageDate,
          realtimeEnd: row.realtime_end || vintageDate,
        });
      });
      const publishedAt = rows.at(-1)?.date || null;
      return Object.freeze({
        ...freshness(publishedAt, { now: now(), maxAgeMs }),
        observations: Object.freeze(rows),
        provenance: provenance({ provider: "FRED/ALFRED", sourceUrl, observedAt, publishedAt, vintageAt: vintageDate }),
      });
    } catch (error) {
      return providerFailure(error, "FRED/ALFRED", observedAt);
    }
  }
  return Object.freeze({ observations });
}
