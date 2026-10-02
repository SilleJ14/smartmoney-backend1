import { boundedFetch, finiteOrNull, freshness, provenance, providerFailure } from "./providerUtils.js";

function csvRows(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("CME_MALFORMED_CSV");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseCmeDelayedCsv(text) {
  const rows = csvRows(String(text || ""));
  if (rows.length < 2) throw new Error("CME_SCHEMA_INVALID");
  const headers = rows[0].map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const pick = (record, names) => names.map((name) => record[name]).find((value) => value !== undefined);
  return rows.slice(1).map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const symbol = pick(record, ["symbol", "product", "contract", "globex"]);
    const timestamp = pick(record, ["timestamp", "updated", "last_update", "trade_date", "date"]);
    if (!symbol || !timestamp) throw new Error("CME_SCHEMA_INVALID");
    return Object.freeze({
      symbol: String(symbol).trim(),
      timestamp: String(timestamp).trim(),
      last: finiteOrNull(pick(record, ["last", "last_price", "settle", "settlement"])),
      open: finiteOrNull(record.open),
      high: finiteOrNull(record.high),
      low: finiteOrNull(record.low),
      volume: finiteOrNull(record.volume),
      openInterest: finiteOrNull(pick(record, ["open_interest", "openinterest", "oi"])),
    });
  });
}

export function createCmeDelayedProvider({
  endpoint,
  fetchImpl,
  timeoutMs,
  maxBytes,
  maxAgeMs = 60 * 60 * 1000,
  now = () => Date.now(),
  parser = parseCmeDelayedCsv,
} = {}) {
  return Object.freeze({
    async observations() {
      const observedAt = new Date(now()).toISOString();
      try {
        if (!endpoint) throw new Error("CME_SCHEMA_ENDPOINT_REQUIRED");
        const { text, sourceUrl } = await boundedFetch(endpoint, { fetchImpl, timeoutMs, maxBytes });
        const rows = parser(text);
        if (!Array.isArray(rows)) throw new Error("CME_SCHEMA_INVALID");
        const publishedAt = rows.reduce((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest) ? row.timestamp : latest, null);
        return Object.freeze({
          ...freshness(publishedAt, { now: now(), maxAgeMs }),
          observations: Object.freeze(rows),
          provenance: provenance({ provider: "CME_DELAYED", sourceUrl, observedAt, publishedAt }),
        });
      } catch (error) {
        return providerFailure(error, "CME_DELAYED", observedAt);
      }
    },
  });
}
