import { STOCK_EXECUTION_THRESHOLDS } from "./stockQualificationPolicy.js";
import { CRYPTO_MAX_ENTRY_SPREAD_PERCENT } from "./cryptoScoring.js";

// Execution limits are not discovery filters and they do not change D, E, or F.
// A cached quote may be old enough to display and still be too old to trade.

export const STOCK_EXECUTION_POLICY = Object.freeze({
  quoteAgeMs: STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds * 1000,
  spreadAgeMs: STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds * 1000,
  maxQuotedSpreadPercent: STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
  quoteType: "CONSOLIDATED_LIVE_QUOTE",
});

export const CRYPTO_EXECUTION_POLICY = Object.freeze({
  maxQuotedSpreadPercent: CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
});

export const REGULAR_MOVER_DISCOVERY_MAX_SPREAD = 2;
export const PREMARKET_MOVER_DISCOVERY_MAX_SPREAD = 3;

const DISPLAY_QUOTE_MAX_MS = 15000;

export function evidenceAgeMs({ measuredAt = null, now = Date.now() } = {}) {
  const measured = typeof measuredAt === "number" ? measuredAt : Date.parse(String(measuredAt || ""));
  if (!Number.isFinite(measured)) {
    return { evidenceAgeMs: null, state: "DATA_UNAVAILABLE", reason: "MEASURED_AT_MISSING" };
  }
  return {
    evidenceAgeMs: now - measured,
    measuredAt: new Date(measured).toISOString(),
    usedCacheInsertionTime: false,
    state: "PASS",
    reason: null,
  };
}

export function classifyQuotePurpose({
  measuredAt = null,
  cacheStoredAt = null,
  now = Date.now(),
} = {}) {
  const age = evidenceAgeMs({ measuredAt, now });
  if (age.evidenceAgeMs === null) {
    return { ...age, quotePurpose: null, executionGrade: false };
  }
  const quoteAgeMs = age.evidenceAgeMs;
  const executionGrade = quoteAgeMs >= -5000 && quoteAgeMs <= STOCK_EXECUTION_POLICY.quoteAgeMs;
  return {
    quoteAgeMs,
    measuredAt: age.measuredAt,
    cacheStoredAt: cacheStoredAt || null,
    usedCacheInsertionTime: false,
    executionGrade,
    purposes: {
      DISPLAY: quoteAgeMs <= DISPLAY_QUOTE_MAX_MS,
      DISCOVERY: quoteAgeMs <= DISPLAY_QUOTE_MAX_MS,
      ANALYTICAL: true,
      EXECUTION: executionGrade,
    },
  };
}

export function classifyStockExecution({
  quoteAgeMs = null,
  spreadAgeMs = null,
  spreadPercent = null,
  quoteConsolidated = true,
  bookAvailable = true,
  sizeExceedsDepth = false,
} = {}) {
  if (quoteAgeMs === null || spreadAgeMs === null || spreadPercent === null) {
    return { state: "EXECUTION_NOT_READY", reason: "POLICY_MISSING", changesFinalScore: false };
  }
  if (quoteAgeMs > STOCK_EXECUTION_POLICY.quoteAgeMs) {
    return { state: "EXECUTION_NOT_READY", reason: "QUOTE_STALE", changesFinalScore: false };
  }
  if (spreadAgeMs > STOCK_EXECUTION_POLICY.spreadAgeMs) {
    return { state: "EXECUTION_NOT_READY", reason: "SPREAD_STALE", changesFinalScore: false };
  }
  if (quoteConsolidated !== true) {
    return { state: "EXECUTION_NOT_READY", reason: "CONSOLIDATED_QUOTE_UNAVAILABLE", changesFinalScore: false };
  }
  if (Number(spreadPercent) > STOCK_EXECUTION_POLICY.maxQuotedSpreadPercent) {
    return { state: "EXECUTION_NOT_READY", reason: "SPREAD_TOO_WIDE", changesFinalScore: false };
  }
  if (bookAvailable === false) {
    return { state: "EXECUTION_NOT_READY", reason: "BOOK_UNAVAILABLE", changesFinalScore: false };
  }
  if (sizeExceedsDepth === true) {
    return { state: "EXECUTION_NOT_READY", reason: "SIZE_EXCEEDS_DEPTH", changesFinalScore: false };
  }
  return { state: "PASS", reason: null, changesFinalScore: false };
}

export function classifyCryptoExecution({
  spreadPercent = null,
  bookAvailable = true,
  sizeExceedsDepth = false,
} = {}) {
  if (spreadPercent === null) {
    return { state: "EXECUTION_NOT_READY", reason: "POLICY_MISSING", changesFinalScore: false };
  }
  if (Number(spreadPercent) > CRYPTO_EXECUTION_POLICY.maxQuotedSpreadPercent) {
    return { state: "EXECUTION_NOT_READY", reason: "SPREAD_TOO_WIDE", changesFinalScore: false };
  }
  if (bookAvailable === false) {
    return { state: "EXECUTION_NOT_READY", reason: "BOOK_UNAVAILABLE", changesFinalScore: false };
  }
  if (sizeExceedsDepth === true) {
    return { state: "EXECUTION_NOT_READY", reason: "SIZE_EXCEEDS_DEPTH", changesFinalScore: false };
  }
  return { state: "PASS", reason: null, changesFinalScore: false };
}

export function discoverySpreadAllowsWatch(spreadPercent, { session = "REGULAR" } = {}) {
  const limit = session === "PREMARKET"
    ? PREMARKET_MOVER_DISCOVERY_MAX_SPREAD
    : REGULAR_MOVER_DISCOVERY_MAX_SPREAD;
  return Number(spreadPercent) <= limit;
}

export function streamTiming(url = "") {
  const delayed = /delayed/i.test(String(url));
  return { timing: delayed ? "DELAYED" : "REALTIME", realtime: !delayed };
}

export function applyNewsEvent(cache = {}, event = {}, now = Date.now()) {
  const article = event.article || null;
  return {
    ...cache,
    at: now,
    available: true,
    invalidatedByEvent: true,
    eventAt: event.measuredAt || new Date(now).toISOString(),
    articles: article ? [article, ...(cache.articles || [])] : (cache.articles || []),
    waitedForPoll: false,
  };
}

export function pipelineLatency({
  discoveredAt = null,
  deepScoredAt = null,
  measuredAt = null,
  now = Date.now(),
} = {}) {
  const discovered = Date.parse(discoveredAt || "");
  const scored = Date.parse(deepScoredAt || "");
  const measured = Date.parse(measuredAt || "");
  return {
    discoveryLatencyMs: Number.isFinite(discovered) ? Math.max(0, now - discovered) : null,
    deepScoreLatencyMs: Number.isFinite(discovered) && Number.isFinite(scored) ? Math.max(0, scored - discovered) : null,
    executionEvidenceAgeMs: Number.isFinite(measured) ? now - measured : null,
  };
}
