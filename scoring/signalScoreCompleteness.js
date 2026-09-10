import { hasDecisionAnalysis } from './decisionAnalysis.js';
function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueReasons(values = []) {
  return [...new Set(
    values
      .flatMap(asArray)
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function isCryptoSignal(signal = {}) {
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

function resolveContinuation(signal = {}) {
  return signal.continuationScorecard ||
    signal.multiDayContinuation ||
    signal.cryptoScoreTelemetry?.continuation ||
    null;
}

export function normalizeSignalScoreCompleteness(signal = {}) {
  if (!signal || typeof signal !== "object") return signal;

  const crypto = isCryptoSignal(signal);
  const continuation = resolveContinuation(signal);
  const continuationScore = finiteNumber(
    signal.multiDayContinuationScore,
    signal.multiDayScore,
    continuation?.score
  );
  const continuationAvailable = continuationScore !== null && (
    typeof signal.multiDayScoreAvailable === "boolean"
      ? signal.multiDayScoreAvailable
      : continuation?.available === true ||
        (!crypto && continuation?.sessionEvidenceVerified === true)
  );

  if (crypto) {
    const discovery = signal.cryptoDiscoveryScorecard || signal.discoveryScorecard || null;
    const entry = signal.cryptoEntryScorecard || signal.cryptoScoreTelemetry?.entry || null;
    const decisionEvidence =
      signal.cryptoScoreTelemetry?.decision ||
      signal.centralAutonomousDecisionCore?.cryptoDecisionEvidence ||
      null;
    const discoveryScore = finiteNumber(
      signal.cryptoDiscoveryScore,
      signal.rawCryptoScore,
      discovery?.score
    );
    const entryScore = finiteNumber(
      signal.cryptoEntryScore,
      entry?.score,
      decisionEvidence?.componentsByName?.execution?.value
    );
    const finalScore = finiteNumber(
      signal.cryptoDecisionScore,
      signal.centralAutonomousDecisionCore?.cryptoDecisionScore,
      signal.masterFinalScore,
      signal.finalAutonomousDecisionScore
    );
    const discoveryCoverage = Number(discovery?.coverage || 0);
    const discoveryAvailable = discoveryScore !== null && (
      typeof signal.cryptoDiscoveryScoreAvailable === "boolean"
        ? signal.cryptoDiscoveryScoreAvailable
        : discovery?.available === true || discoveryCoverage >= 0.5
    );
    const centralEntryAvailable =
      decisionEvidence?.componentsByName?.execution?.available;
    const entryAvailable = signal.cryptoEntryScoreAvailable !== false && entryScore !== null && (
      typeof centralEntryAvailable === "boolean"
        ? centralEntryAvailable
        : typeof signal.cryptoEntryScoreAvailable === "boolean"
          ? signal.cryptoEntryScoreAvailable
          : entry?.available === true
    );
    const finalAvailable = signal.cryptoDecisionScoreAvailable !== false && finalScore !== null && (
      typeof decisionEvidence?.coreEvidencePass === "boolean" || typeof decisionEvidence?.analysisEvidencePass === 'boolean'
        ? hasDecisionAnalysis(decisionEvidence)
        : signal.cryptoDecisionScoreAvailable === true
    );
    const provisionalScore = finalAvailable
      ? finiteNumber(signal.provisionalCryptoDecisionScore)
      : finiteNumber(
        signal.provisionalCryptoDecisionScore,
        signal.centralAutonomousDecisionCore?.provisionalCryptoDecisionScore,
        finalScore,
        decisionEvidence?.score
      );
    const missingEvidenceReasons = uniqueReasons([
      currentStoredReasons(signal, finalAvailable),
      discovery?.missingCriticalEvidence,
      discovery?.missingComponents,
      entry?.missingCriticalEvidence,
      entry?.missingComponents,
      decisionEvidence?.missingCriticalEvidence,
      decisionEvidence?.missingEvidence,
      decisionEvidence?.missingComponents,
      continuation?.missingCriticalEvidence,
      continuation?.missingComponents,
      discoveryAvailable ? [] : ["CRYPTO_DISCOVERY_SCORE_UNAVAILABLE"],
      entryAvailable ? [] : ["CRYPTO_ENTRY_SCORE_UNAVAILABLE"],
      finalAvailable ? [] : ["CANONICAL_CRYPTO_FINAL_DECISION_UNAVAILABLE"],
      continuationAvailable ? [] : ["CRYPTO_MULTI_DAY_EVIDENCE_UNAVAILABLE"],
      getApprovedTradeAmount(signal) > 0 ? [] : ['POSITION_SIZING_PENDING'],
    ]);

    return {
      ...signal,
      cryptoDiscoveryScore: discoveryAvailable ? discoveryScore : null,
      rawCryptoScore: discoveryAvailable ? discoveryScore : null,
      cryptoDiscoveryScoreAvailable: discoveryAvailable,
      cryptoEntryScore: entryAvailable ? entryScore : null,
      cryptoEntryScoreAvailable: entryAvailable,
      cryptoDecisionScore: finalAvailable ? finalScore : null,
      cryptoDecisionScoreAvailable: finalAvailable,
      provisionalCryptoDecisionScore:
        provisionalScore === null ? null : provisionalScore,
      provisionalCryptoDecisionScoreAvailable:
        !finalAvailable && provisionalScore !== null,
      multiDayContinuationScore:
        continuationAvailable ? continuationScore : null,
      multiDayScore: continuationAvailable ? continuationScore : null,
      multiDayScoreAvailable: continuationAvailable,
      missingEvidenceReasons,
      scoreCompleteness: {
        assetClass: "crypto",
        discoveryAvailable,
        entryAvailable,
        finalAvailable,
        continuationAvailable,
        missingEvidenceReasons,
      },
    };
  }

  const discovery = signal.discoveryScorecard ||
    signal.decisionScoreTelemetry?.stages?.discovery ||
    null;
  const entry = signal.entryQualityScorecard ||
    signal.decisionScoreTelemetry?.stages?.entry ||
    null;
  const decisionEvidence = signal.stockDecisionEvidence ||
    signal.centralAutonomousDecisionCore?.stockDecisionEvidence ||
    signal.decisionScoreTelemetry?.stages?.decision ||
    null;
  const discoveryScore = finiteNumber(
    signal.discoveryScore,
    discovery?.score,
    signal.decisionScoreTelemetry?.scores?.discovery
  );
  const entryScore = finiteNumber(
    signal.entryQualityScore,
    signal.entryScore,
    entry?.score,
    signal.decisionScoreTelemetry?.scores?.entry
  );
  const finalScore = finiteNumber(
    signal.masterFinalScore,
    signal.finalAutonomousDecisionScore,
    signal.stockDecisionScore,
    signal.decisionScoreTelemetry?.scores?.decision
  );
  const discoveryAvailable = discoveryScore !== null && (
    typeof signal.discoveryScoreAvailable === "boolean"
      ? signal.discoveryScoreAvailable
      : Number(discovery?.coverage || 0) >= 0.65 &&
        discovery?.canonicalExtensionEvidencePass === true
  );
  const entryAvailable = entryScore !== null && (
    typeof signal.entryQualityScoreAvailable === "boolean"
      ? signal.entryQualityScoreAvailable
      : Number(entry?.coverage || 0) >= 0.8
  );
  const finalAvailable = signal.stockDecisionScoreAvailable !== false && finalScore !== null && (
    typeof decisionEvidence?.coreEvidencePass === "boolean" || typeof decisionEvidence?.analysisEvidencePass === 'boolean'
      ? hasDecisionAnalysis(decisionEvidence)
      : signal.stockDecisionScoreAvailable === true
  );
  const provisionalScore = finalAvailable
    ? finiteNumber(signal.provisionalStockDecisionScore)
    : finiteNumber(signal.provisionalStockDecisionScore, finalScore);
  const missingEvidenceReasons = uniqueReasons([
    currentStoredReasons(signal, finalAvailable),
    discovery?.missingCriticalEvidence,
    discovery?.missingComponents,
    entry?.missingCriticalEvidence,
    entry?.missingComponents,
    decisionEvidence?.missingCriticalEvidence,
    decisionEvidence?.missingEvidence,
    decisionEvidence?.missingComponents,
    continuation?.missingCriticalEvidence,
    continuation?.missingComponents,
    discoveryAvailable ? [] : ["STOCK_DISCOVERY_SCORE_UNAVAILABLE"],
    entryAvailable ? [] : ["STOCK_ENTRY_SCORE_UNAVAILABLE"],
    finalAvailable ? [] : ["CANONICAL_STOCK_FINAL_DECISION_UNAVAILABLE"],
    continuationAvailable ? [] : ["STOCK_MULTI_DAY_EVIDENCE_UNAVAILABLE"],
    getApprovedTradeAmount(signal) > 0 ? [] : ['POSITION_SIZING_PENDING'],
  ]);

  return {
    ...signal,
    discoveryScore: discoveryAvailable ? discoveryScore : null,
    discoveryScoreAvailable: discoveryAvailable,
    entryQualityScore: entryAvailable ? entryScore : null,
    entryQualityScoreAvailable: entryAvailable,
    stockDecisionScore: finalAvailable ? finalScore : null,
    stockDecisionScoreAvailable: finalAvailable,
    provisionalStockDecisionScore:
      provisionalScore === null ? null : provisionalScore,
    provisionalStockDecisionScoreAvailable:
      !finalAvailable && provisionalScore !== null,
    multiDayContinuationScore:
      continuationAvailable ? continuationScore : null,
    multiDayScore: continuationAvailable ? continuationScore : null,
    multiDayScoreAvailable: continuationAvailable,
    missingEvidenceReasons,
    scoreCompleteness: {
      assetClass: "stock",
      discoveryAvailable,
      entryAvailable,
      finalAvailable,
      continuationAvailable,
      missingEvidenceReasons,
    },
  };
}

export function normalizeSignalScoreCollection(signals = []) {
  return (Array.isArray(signals) ? signals : [])
    .filter(Boolean)
    .map(normalizeSignalScoreCompleteness);
}
import { getApprovedTradeAmount } from './approvedSizing.js';
function currentStoredReasons(signal, finalAvailable = false) {
  return (Array.isArray(signal.missingEvidenceReasons) ? signal.missingEvidenceReasons : [])
    .filter(reason => !(finalAvailable && /^CANONICAL_(STOCK|CRYPTO)_FINAL_DECISION_PENDING_CENTRAL_CORE$/.test(reason)))
    .filter(reason => !/^(CANONICAL_(STOCK|CRYPTO)_FINAL_DECISION_UNAVAILABLE|(STOCK|CRYPTO)_(DISCOVERY_SCORE|ENTRY_SCORE|MULTI_DAY_EVIDENCE)_UNAVAILABLE|POSITION_SIZING_PENDING)$/.test(reason));
}
