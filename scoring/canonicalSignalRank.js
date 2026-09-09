import { mergeLiveQuoteEvidence } from "../live/liveQuoteCache.js";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCryptoSignal(signal = {}) {
  const symbol = String(signal.symbol || "").trim().toUpperCase();
  const assetClass = String(
    signal.assetClass || signal.asset_class || signal.assetType || ""
  ).toLowerCase();
  const withoutProviderPrefix = symbol.replace(/^X:/, "");
  return assetClass === "crypto" ||
    withoutProviderPrefix.includes("/") ||
    /-(USD|USDT)$/.test(withoutProviderPrefix) ||
    withoutProviderPrefix.endsWith("USDT") ||
    (
      withoutProviderPrefix.endsWith("USD") &&
      withoutProviderPrefix.length > 5
    );
}

function canonicalSignalKey(signal, normalizeSymbol) {
  const normalized = normalizeSymbol(signal?.symbol);
  if (!normalized) return "";
  if (!isCryptoSignal({ ...signal, symbol: normalized })) {
    return `STOCK:${normalized}`;
  }
  const canonicalCrypto = String(normalized)
    .toUpperCase()
    .replace(/^X:/, "")
    .replace(/[\/-]/g, "");
  return `CRYPTO:${canonicalCrypto}`;
}

export function getCanonicalFinalScore(signal = {}) {
  if (isCryptoSignal(signal)) {
    if (signal.cryptoDecisionScoreAvailable === false) return null;
    const score = finite(
      signal.cryptoDecisionScore ??
      signal.masterFinalScore ??
      signal.finalAutonomousDecisionScore ??
      signal.centralAutonomousDecisionCore?.cryptoDecisionScore
    );
    // Use the current revalidated evidence before the original central snapshot,
    // just as score publication does. A stale available flag is not stronger
    // evidence than a current failed scorecard.
    const evidence = signal.cryptoScoreTelemetry?.decision ||
      signal.centralAutonomousDecisionCore?.cryptoDecisionEvidence;
    const available = typeof evidence?.coreEvidencePass === "boolean"
      ? evidence.coreEvidencePass
      : signal.cryptoDecisionScoreAvailable === true;
    return available && score !== null ? score : null;
  }

  if (signal.stockDecisionScoreAvailable === false) return null;
  const score = finite(
    signal.masterFinalScore ??
    signal.finalAutonomousDecisionScore ??
    signal.stockDecisionScore ??
    signal.decisionScoreTelemetry?.scores?.decision
  );
  const evidence = signal.stockDecisionEvidence ||
    signal.centralAutonomousDecisionCore?.stockDecisionEvidence ||
    signal.decisionScoreTelemetry?.stages?.decision;
  const available = typeof evidence?.coreEvidencePass === "boolean"
    ? evidence.coreEvidencePass
    : signal.stockDecisionScoreAvailable === true;
  return available && score !== null ? score : null;
}

export function hasExplicitTradeApproval(signal = {}) {
  return signal.qualifiedToBuy === true &&
    signal.autoTradeApproved === true &&
    signal.approved === true &&
    signal.backendApproved === true;
}

export function compareCanonicalSignals(left = {}, right = {}) {
  const executable = (signal) => hasExplicitTradeApproval(signal) &&
    signal.executionEligibility?.approved !== false && signal.buyableNow !== false &&
    getCanonicalFinalScore(signal) !== null;
  const confirmed = (signal) => executable(signal) &&
    (signal.executionEligibility?.approved === true || signal.buyableNow === true);
  const confirmedGap = Number(confirmed(right)) - Number(confirmed(left));
  if (confirmedGap !== 0) return confirmedGap;
  const approvalGap = Number(executable(right)) - Number(executable(left));
  if (approvalGap !== 0) return approvalGap;
  const leftFinal = getCanonicalFinalScore(left);
  const rightFinal = getCanonicalFinalScore(right);
  const availabilityGap = Number(rightFinal !== null) - Number(leftFinal !== null);
  if (availabilityGap !== 0) return availabilityGap;
  if (leftFinal !== null && rightFinal !== null && leftFinal !== rightFinal) {
    return rightFinal - leftFinal;
  }
  return Math.abs(Number(right.changePercent || right.percentChange || 0)) -
    Math.abs(Number(left.changePercent || left.percentChange || 0));
}

// Display capacity is not an execution gate. Keep both asset classes reachable
// even when one class fills the entire highest-score window.
export function selectCandidateDisplayWindow(signals = [], limit = 50) {
  const parsed = Number(limit);
  const capacity = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.floor(parsed))) : 50;
  const ranked = signals.filter(Boolean).slice().sort(compareCanonicalSignals);
  const stocks = ranked.filter(s => !isCryptoSignal(s));
  const crypto = ranked.filter(isCryptoSignal);
  const reserve = Math.floor(capacity / 2);
  const selected = new Set([...stocks.slice(0, reserve), ...crypto.slice(0, reserve)]);
  for (const signal of ranked) {
    if (selected.size >= capacity) break;
    selected.add(signal);
  }
  return ranked.filter(signal => selected.has(signal)).slice(0, capacity);
}

const RAW_MOVER_FILL_FIELDS = Object.freeze([
  "price",
  "current",
  "livePrice",
  "displayPrice",
  "previousClose",
  "open",
  "dayOpen",
  "bid",
  "ask",
  "spread",
  "spreadPercent",
  "spreadAvailable",
  "spreadUpdatedAt",
  "bidAskUpdatedAt",
  "spreadSource",
  "percentChange",
  "changePercent",
  "dayChangePercent",
  "percentChangeAvailable",
  "changePercentAvailable",
  "dayChangePercentAvailable",
  "percentChangeReferencePrice",
  "percentChangeReferenceType",
  "percentChangeSource",
  "liveQuoteUpdatedAt",
  "liveQuoteSource",
  "priceIsLive",
  "volume",
  "earlyMover",
]);

function signalEvidenceAuthority(signal = {}) {
  const canonicalFinal = getCanonicalFinalScore(signal) !== null;
  const explicitlyApproved = hasExplicitTradeApproval(signal);
  const rawOnly = signal.rawEarlyMover === true;
  const availableScoreCount = [
    signal.discoveryScoreAvailable,
    signal.entryQualityScoreAvailable,
    signal.stockDecisionScoreAvailable,
    signal.cryptoDiscoveryScoreAvailable,
    signal.cryptoEntryScoreAvailable,
    signal.cryptoDecisionScoreAvailable,
    signal.multiDayScoreAvailable,
  ].filter((value) => value === true).length;
  const evidenceObjectCount = [
    signal.discoveryScorecard,
    signal.entryQualityScorecard,
    signal.cryptoDiscoveryScorecard,
    signal.cryptoEntryScorecard,
    signal.decisionScoreTelemetry,
    signal.centralAutonomousDecisionCore,
    signal.finalStockExecutionGate,
  ].filter(Boolean).length;
  const timestamp = Date.parse(String(
    signal.decisionUpdatedAt ||
    signal.centralAutonomousDecisionCore?.updatedAt ||
    signal.scanCompletedAt ||
    signal.scanBuiltAt ||
    ""
  ));
  return {
    canonicalFinal,
    explicitlyApproved,
    rawOnly,
    availableScoreCount,
    evidenceObjectCount,
    timestamp: Number.isFinite(timestamp) && timestamp <= Date.now() + 5000 ? timestamp : 0,
  };
}

function prefersNextSignal(current = {}, next = {}) {
  const left = signalEvidenceAuthority(current);
  const right = signalEvidenceAuthority(next);
  // Quote-only discoveries carry no authority to replace a decision. Between
  // real decisions, a newer rejection/reset must supersede an older approval.
  if (hasDecisionUpdate(current) && hasDecisionUpdate(next) &&
      left.timestamp !== right.timestamp) return right.timestamp > left.timestamp;
  const invalidated = (signal) => [signal.stockDecisionScoreAvailable, signal.cryptoDecisionScoreAvailable,
    signal.approved, signal.backendApproved, signal.autoTradeApproved, signal.qualifiedToBuy,
    signal.executionEligibility?.approved].some((value) => value === false);
  if (hasDecisionUpdate(current) && hasDecisionUpdate(next) && invalidated(current) !== invalidated(next)) return invalidated(next);
  if (hasDecisionUpdate(current) && hasDecisionUpdate(next) &&
      left.explicitlyApproved !== right.explicitlyApproved) return !right.explicitlyApproved;
  if (left.canonicalFinal !== right.canonicalFinal) return right.canonicalFinal;
  if (left.explicitlyApproved !== right.explicitlyApproved) return right.explicitlyApproved;
  if (left.rawOnly !== right.rawOnly) return !right.rawOnly;
  if (left.availableScoreCount !== right.availableScoreCount) {
    return right.availableScoreCount > left.availableScoreCount;
  }
  if (left.evidenceObjectCount !== right.evidenceObjectCount) {
    return right.evidenceObjectCount > left.evidenceObjectCount;
  }
  if (left.timestamp !== right.timestamp) return right.timestamp > left.timestamp;
  const absoluteMove = (signal) => {
    const supplied = finite(signal.changePercent ?? signal.percentChange);
    if (supplied !== null) return Math.abs(supplied);
    const price = finite(signal.price ?? signal.current);
    const reference = finite(signal.previousClose ?? signal.prevClose ?? signal.pc);
    return price !== null && reference !== null && reference > 0
      ? Math.abs(((price - reference) / reference) * 100)
      : 0;
  };
  const currentMove = absoluteMove(current);
  const nextMove = absoluteMove(next);
  return nextMove > currentMove;
}

function hasDecisionUpdate(signal = {}) {
  return signal.rawEarlyMover !== true &&
    signal.payloadType !== "quote_update" &&
    [signal.stockDecisionScoreAvailable, signal.cryptoDecisionScoreAvailable,
      signal.approved, signal.backendApproved, signal.executionEligibility?.approved]
      .some((value) => typeof value === "boolean");
}

function mergeSecondaryEvidence(preferred = {}, secondary = {}) {
  const merged = { ...preferred };
  const quoteFields = ["price", "current", "livePrice", "displayPrice", "liveQuoteUpdatedAt", "liveQuoteSource", "priceIsLive"];
  const spreadFields = ["bid", "ask", "spread", "spreadPercent", "spreadAvailable", "spreadUpdatedAt", "bidAskUpdatedAt", "spreadSource"];
  const secondaryIsRaw = secondary.rawEarlyMover === true;
  const newerDecision = hasDecisionUpdate(preferred) && hasDecisionUpdate(secondary);
  // Missing fields in a new decision are not permission to restore stale
  // approval, sizing or score evidence from the previous decision.
  const fields = secondaryIsRaw || newerDecision ? RAW_MOVER_FILL_FIELDS : Object.keys(secondary);
  for (const field of fields) {
    if (quoteFields.includes(field) || spreadFields.includes(field)) continue;
    if (
      (merged[field] === null || merged[field] === undefined || merged[field] === "") &&
      secondary[field] !== null &&
      secondary[field] !== undefined &&
      secondary[field] !== ""
    ) {
      merged[field] = secondary[field];
    }
  }
  const time = (signal) => {
    const value = Date.parse(signal.liveQuoteUpdatedAt || "");
    return Number.isFinite(value) && value <= Date.now() + 5000 ? value : 0;
  };
  const quoteOwner = time(secondary) > time(preferred) ? secondary : preferred;
  for (const field of quoteFields) merged[field] = quoteOwner[field];
  Object.assign(merged, mergeLiveQuoteEvidence(secondary, preferred, {
    price: Number(merged.price || merged.current || 0),
    quoteSource: preferred.liveQuoteSource,
  }));
  if (secondaryIsRaw && preferred.rawEarlyMover !== true) {
    merged.rawEarlyMover = false;
    merged.earlyMover = true;
    merged.earlyMoverEvidence = {
      source: secondary.candidateSource || "RAW_EARLY_MOVER",
      missingEvidenceReasons: Array.isArray(secondary.missingEvidenceReasons)
        ? secondary.missingEvidenceReasons
        : [],
    };
  }
  return merged;
}

export function dedupeSignalsByCanonicalAuthority(
  signals = [],
  { normalizeSymbol = (value) => String(value || "").toUpperCase() } = {}
) {
  const bySymbol = new Map();
  for (let signal of Array.isArray(signals) ? signals : []) {
    if (!signal || typeof signal !== "object") continue;
    const decisionTime = Date.parse(signal.decisionUpdatedAt || signal.centralAutonomousDecisionCore?.updatedAt || "");
    if (decisionTime > Date.now() + 5000) signal = { ...signal,
      approved: false, backendApproved: false, autoTradeApproved: false, qualifiedToBuy: false,
      stockDecisionScoreAvailable: false, cryptoDecisionScoreAvailable: false,
      recommendedTradeAmount: 0, finalApprovedTradeAmount: 0, buyableNow: false,
      executionEligibility: { approved: false, reasons: ["FUTURE_DECISION_TIMESTAMP"] } };
    const symbol = normalizeSymbol(signal.symbol);
    if (!symbol) continue;
    const key = canonicalSignalKey(signal, normalizeSymbol);
    const current = bySymbol.get(key);
    if (!current) {
      bySymbol.set(key, { ...signal, symbol });
      continue;
    }
    const preferNext = prefersNextSignal(current, signal);
    const preferred = preferNext ? signal : current;
    const secondary = preferNext ? current : signal;
    bySymbol.set(key, {
      ...mergeSecondaryEvidence(preferred, secondary),
      symbol: normalizeSymbol(preferred.symbol) || symbol,
    });
  }
  return [...bySymbol.values()];
}
