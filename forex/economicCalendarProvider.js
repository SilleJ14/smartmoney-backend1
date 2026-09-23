import { defaultCalendarSnapshot, loadCalendarSnapshot, calendarForDecision } from "./calendarFeed.js";

const MINUTE = 60000;
const DAY = 86400000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 5000;
const CURRENCIES = Object.freeze(["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "NZD", "CAD"]);
const COUNTRY_CURRENCY = Object.freeze(Object.fromEntries([
  ["USD", ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]],
  ["EUR", ["EU", "EMU", "EA", "EURO AREA", "EURO ZONE", "EUROZONE", "EUROPEAN UNION", "DE", "GERMANY", "FR", "FRANCE", "IT", "ITALY", "ES", "SPAIN", "NL", "NETHERLANDS", "BE", "BELGIUM", "AT", "AUSTRIA", "FI", "FINLAND", "IE", "IRELAND", "PT", "PORTUGAL", "GR", "GREECE", "LU", "LUXEMBOURG", "SK", "SLOVAKIA", "SI", "SLOVENIA", "EE", "ESTONIA", "LV", "LATVIA", "LT", "LITHUANIA", "CY", "CYPRUS", "MT", "MALTA", "HR", "CROATIA"]],
  ["JPY", ["JP", "JPN", "JAPAN"]], ["GBP", ["GB", "UK", "GBR", "UNITED KINGDOM"]],
  ["CHF", ["CH", "CHE", "SWITZERLAND"]], ["AUD", ["AU", "AUS", "AUSTRALIA"]],
  ["NZD", ["NZ", "NZL", "NEW ZEALAND"]], ["CAD", ["CA", "CAN", "CANADA"]],
].flatMap(([currency, countries]) => [...countries, currency].map(country => [country, currency]))));

function fail(code) { throw Object.assign(new Error(code), { calendarCode: code }); }

export function calendarTimestamp(value, timezone = "") {
  if (typeof value !== "string") fail("CALENDAR_INVALID_EVENT_TIME");
  let text = value.trim().replace(" ", "T");
  // Do not let the server's local timezone interpret an unzoned provider time.
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(text)) {
    if (timezone !== "UTC") fail("CALENDAR_TIMEZONE_UNVERIFIED");
    text += "Z";
  }
  const match = text.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?(Z|[+-]\d\d:\d\d)$/);
  const stamp = Date.parse(text);
  if (!match || !Number.isFinite(stamp)) fail("CALENDAR_INVALID_EVENT_TIME");
  const parts = match.slice(1, 7).map(Number);
  const local = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (local.getUTCFullYear() !== parts[0] || local.getUTCMonth() !== parts[1] - 1 || local.getUTCDate() !== parts[2]
    || local.getUTCHours() !== parts[3] || local.getUTCMinutes() !== parts[4] || local.getUTCSeconds() !== parts[5]) fail("CALENDAR_INVALID_EVENT_TIME");
  return new Date(stamp).toISOString();
}

export function normalizeEconomicCalendar(payload, { from, to, requestedAt, timezone = "" }) {
  if (!payload || payload.error || !Array.isArray(payload.economicCalendar)) fail("CALENDAR_INVALID_RESPONSE");
  if (payload.partial === true || payload.truncated === true || payload.hasMore === true || payload.nextPage || payload.nextCursor) fail("CALENDAR_PARTIAL_RESPONSE");
  const rows = payload.economicCalendar;
  if (!rows.length) fail("CALENDAR_EMPTY_UNVERIFIED");
  if (rows.length >= MAX_EVENTS) fail("CALENDAR_RESPONSE_TOO_LARGE");
  const coveredFrom = `${from}T00:00:00.000Z`;
  const coveredThrough = new Date(Date.parse(`${to}T00:00:00Z`) + DAY).toISOString();
  const events = new Map();
  let lowImpactCount = 0;
  for (const row of rows) {
    if (!row || typeof row.event !== "string" || !row.event.trim() || typeof row.country !== "string" || !row.country.trim()) fail("CALENDAR_MALFORMED_EVENT");
    const start = calendarTimestamp(row.time, timezone);
    if (Date.parse(start) < Date.parse(coveredFrom) || Date.parse(start) >= Date.parse(coveredThrough)) fail("CALENDAR_OUT_OF_RANGE");
    const country = row.country.trim().toUpperCase();
    const currency = COUNTRY_CURRENCY[country] || "ALL"; // Unknown geography must never silently escape the gate.
    const title = row.event.trim().slice(0, 300);
    const impact = String(row.impact || "unknown").trim().toLowerCase();
    const centralBank = /central bank|interest rate|rate decision|monetary policy|federal reserve|\bfed\b|\bfomc\b|\becb\b|\bboj\b|\bboe\b|\brba\b|\brbnz\b|\bsnb\b|bank of (?:canada|england|japan)|\bboc\b/i.test(title);
    // Missing/unknown importance is conservative. Do not discard a central-bank speech tagged low.
    if (impact === "low" && !centralBank) { lowImpactCount++; continue; }
    const type = centralBank ? `central bank: ${title}` : title;
    const id = `${currency}:${start}:${title}`;
    events.set(id, { id, currency, type, start, end: start, impact, country });
  }
  return { source: "finnhub_economic_calendar", schemaVersion: 1, refreshedAt: new Date(requestedAt).toISOString(),
    coverageComplete: true, qualityStatus: "VALID", coveredFrom, coveredThrough, coveredCurrencies: CURRENCIES,
    // Coverage is the provider's requested global date range, not proof that no unscheduled event can occur.
    coverageBasis: "PROVIDER_GLOBAL_DATE_RANGE", receivedEventCount: rows.length, lowImpactCount,
    events: [...events.values()].sort((a,b) => Date.parse(a.start) - Date.parse(b.start)) };
}

async function boundedJson(response) {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) fail("CALENDAR_RESPONSE_TOO_LARGE");
  const chunks = [];
  let size = 0;
  if (!response.body) fail("CALENDAR_INVALID_RESPONSE");
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > MAX_BYTES) fail("CALENDAR_RESPONSE_TOO_LARGE");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("CALENDAR_INVALID_RESPONSE"); }
}

export function createEconomicCalendarProvider({ apiKey, filePath, provider = filePath ? "file" : "finnhub",
  timezone = "", fetchImpl = globalThis.fetch, nowFn = Date.now, timeoutMs = 10000 } = {}) {
  let snapshot = defaultCalendarSnapshot();
  let pending = null;
  let nextAttemptAt = 0;
  let lastAttemptAt = null;
  let lastError = null;
  let failures = 0;
  const status = () => {
    const now = nowFn();
    const valid = !lastError && calendarForDecision(snapshot, { now }).reason !== "CALENDAR_UNAVAILABLE";
    return { provider, source: snapshot.source, qualityStatus: valid ? "VALID" : lastError ? "ERROR" : "MISSING_OR_STALE",
      coverageComplete: valid, refreshing: Boolean(pending), lastAttemptAt, lastSuccessAt: snapshot.refreshedAt,
      nextAttemptAt: new Date(nextAttemptAt).toISOString(), error: lastError,
      coveredFrom: snapshot.coveredFrom || null, coveredThrough: snapshot.coveredThrough || null,
      eventCount: snapshot.events.length, receivedEventCount: snapshot.receivedEventCount ?? snapshot.events.length };
  };
  async function perform() {
    const requestedAt = nowFn(); lastAttemptAt = new Date(requestedAt).toISOString();
    try {
      let next;
      if (provider === "file") {
        next = loadCalendarSnapshot(filePath);
        if (calendarForDecision(next, { now: requestedAt }).reason === "CALENDAR_UNAVAILABLE") fail("CALENDAR_FILE_UNAVAILABLE");
      } else if (provider === "finnhub") {
        if (!apiKey) fail("CALENDAR_MISSING_API_KEY");
        const from = new Date(requestedAt - DAY).toISOString().slice(0,10);
        const to = new Date(requestedAt + 2 * DAY).toISOString().slice(0,10);
        const url = new URL("https://finnhub.io/api/v1/calendar/economic");
        url.searchParams.set("from", from); url.searchParams.set("to", to);
        // Header auth keeps the secret out of URLs and diagnostics; never propagate provider error bodies.
        const response = await fetchImpl(url.toString(), { headers: { "X-Finnhub-Token": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
        if (!response.ok) {
          const retry = Number(response.headers.get("retry-after"));
          if (response.status === 429 && retry > 0) nextAttemptAt = requestedAt + Math.min(retry * 1000, 3600000);
          await response.body?.cancel();
          fail(response.status === 401 || response.status === 403 ? "CALENDAR_ACCESS_DENIED"
            : response.status === 429 ? "CALENDAR_RATE_LIMITED" : "CALENDAR_PROVIDER_FAILED");
        }
        next = normalizeEconomicCalendar(await boundedJson(response), { from, to, requestedAt, timezone });
      } else fail("CALENDAR_PROVIDER_UNSUPPORTED");
      if (calendarForDecision(next, { now: nowFn() }).reason === "CALENDAR_UNAVAILABLE") fail("CALENDAR_STALE_RESPONSE");
      snapshot = Object.freeze({ ...next, events: Object.freeze(next.events.map(row => Object.freeze({ ...row }))) });
      lastError = null; failures = 0; nextAttemptAt = nowFn() + (provider === "file" ? MINUTE : 5 * MINUTE);
    } catch (error) {
      lastError = error.calendarCode || (error.name === "TimeoutError" || error.name === "AbortError" ? "CALENDAR_TIMEOUT" : "CALENDAR_NETWORK_ERROR");
      failures++;
      const delay = ["CALENDAR_ACCESS_DENIED", "CALENDAR_MISSING_API_KEY", "CALENDAR_TIMEZONE_UNVERIFIED"].includes(lastError)
        ? 15 * MINUTE : Math.min(15 * MINUTE, MINUTE * 2 ** Math.min(failures - 1, 4));
      nextAttemptAt = Math.max(nextAttemptAt, nowFn() + delay);
    }
    return status();
  }
  return {
    refresh() {
      if (pending) return pending;
      if (nowFn() < nextAttemptAt) return Promise.resolve(status());
      pending = perform().finally(() => { pending = null; });
      return pending;
    },
    getSnapshot() {
      const state = status();
      return state.coverageComplete ? snapshot : { ...snapshot, coverageComplete: false, qualityStatus: state.qualityStatus, error: state.error };
    },
    getStatus: status,
  };
}
