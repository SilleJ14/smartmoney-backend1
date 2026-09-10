import { getApprovedTradeAmount } from "../scoring/approvedSizing.js";
import { revalidateCandidate } from "../scoring/revalidateCandidate.js";
import { hasDecisionAnalysis } from '../scoring/decisionAnalysis.js';
import { candidateFeedDecision } from "../discovery/candidateFeedPolicy.js";
import { freshEarlyAssessments } from '../discovery/earlyCandidateReassessment.js';
import {
  buildStockDecisionScore,
  calculateEarlyDiscoveryScore,
  calculateEntryQualityScore,
  evaluateStockTradeCandidate,
} from "../scoring/decisionScores.js";
import {
  buildCryptoDecisionScore,
  CRYPTO_MIN_FINAL_SCORE_TO_BUY,
  evaluateCryptoTradeCandidate,
} from "../scoring/componentScore.js";
import {
  dedupeSignalsByCanonicalAuthority,
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
  selectCandidateDisplayWindow,
} from "../scoring/canonicalSignalRank.js";
import { normalizeSignalScoreCompleteness } from "../scoring/signalScoreCompleteness.js";
import {
  isLiveQuoteSource,
  mergeLiveQuoteEvidence,
  mergeMeasuredPercentChange,
} from "../live/liveQuoteCache.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findLiveQuote(state, symbol, normalizeSymbol) {
  const clean = normalizeSymbol(symbol);
  const cache = state.liveQuoteCache || {};
  return (
    cache[clean] ||
    cache[clean.replace("/", "")] ||
    cache[clean.replace("-USD", "USD")] ||
    cache[clean.replace("/USD", "USD")] ||
    cache[clean.replace("USD", "/USD")] ||
    null
  );
}

function positiveNumbers(values) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function measuredDecisionAuthority(signal = {}, cryptoAsset = false) {
  const fields = cryptoAsset
    ? [
      signal.cryptoDecisionScore,
      signal.provisionalCryptoDecisionScore,
      signal.cryptoEntryScore,
      signal.rawCryptoScore,
    ]
    : [
      signal.stockDecisionScore,
      signal.masterFinalScore,
      signal.finalAutonomousDecisionScore,
      signal.entryQualityScore,
      signal.discoveryScore,
    ];
  return fields.reduce(
    (count, value) => count + (finiteNumber(value) === undefined ? 0 : 1),
    0
  );
}

export function buildRawEarlyMoverCandidates({
  state,
  normalizeSymbol,
} = {}) {
  const symbols = asArray(state?.liveEarlyMoverSymbols)
    .map((item) => normalizeSymbol(item?.symbol || item))
    .filter(Boolean);
  return [...new Set(symbols)].map((symbol) => {
    const quote = findLiveQuote(state, symbol, normalizeSymbol) || {};
    const mover = state?.polygonMoversCache?.moverDetails?.[symbol] || {};
    const memory = state?.liveMarketMemory?.[symbol] || {};
    const price = Number(quote.price || quote.current || memory.price || mover.price || 0);
    const previousClose = Number(
      quote.previousClose || memory.previousClose || mover.previousClose || 0
    );
    const missingEvidenceReasons = [
      ...asArray(mover.missingEvidenceReasons),
      "FIVE_MINUTE_HISTORY_PENDING",
      "DISCOVERY_CONTEXT_PENDING",
      "ENTRY_QUALITY_PENDING",
      "CANONICAL_FINAL_DECISION_PENDING",
      "EXPLICIT_APPROVAL_PENDING",
      "POSITION_SIZING_PENDING",
    ];
    return {
      symbol,
      assetClass: "stock",
      candidateSource: mover.candidateSource || "RAW_EARLY_MOVER",
      rawEarlyMover: true,
      discoveryOnly: true,
      price,
      current: price,
      previousClose,
      livePrice: price > 0 ? price : null,
      bid: quote.bid ?? null,
      ask: quote.ask ?? null,
      spreadPercent: quote.spreadPercent ?? null,
      spreadAvailable: quote.spreadAvailable === true,
      spreadUpdatedAt: quote.spreadUpdatedAt || quote.bidAskUpdatedAt || null,
      liveQuoteUpdatedAt:
        quote.liveQuoteUpdatedAt || quote.quoteFetchedAt || quote.updatedAt || null,
      liveQuoteSource: quote.liveQuoteSource || quote.source || "scan_snapshot",
      priceIsLive: quote.priceIsLive === true,
      qualifiedToBuy: false,
      backendApproved: false,
      approved: false,
      autoTradeApproved: false,
      recommendedTradeAmount: 0,
      discoveryScore: null,
      discoveryScoreAvailable: false,
      entryQualityScore: null,
      entryQualityScoreAvailable: false,
      stockDecisionScore: null,
      stockDecisionScoreAvailable: false,
      multiDayScore: null,
      multiDayScoreAvailable: false,
      missingEvidenceReasons,
      portfolioManagerReason:
        `Early mover detected before the five-minute scoring cycle. Missing: ${missingEvidenceReasons.join(", ")}.`,
      decisionLevel: "EARLY DISCOVERY",
      tradeQuality: "Watch Only",
    };
  });
}

export function buildLiveMovers({
  state,
  limit = 50,
  normalizeSymbol,
  mergeLiveQuote,
  isCrypto,
  now = () => new Date(),
}) {
  // Collapse duplicate/raw candidates before running the relatively expensive
  // live score refresh.  In particular, a raw early-mover placeholder must not
  // be scored and then compete with an already-complete canonical scan result.
  const sourceSignals = dedupeSignalsByCanonicalAuthority([
    ...freshEarlyAssessments(state.earlyAssessedStockSignals, now().getTime()),
    ...buildRawEarlyMoverCandidates({ state, normalizeSymbol }),
    ...asArray(state.quickInstitutionalCandidates),
    ...asArray(state.fastRunnerCandidates),
    ...asArray(state.topStockSignals),
    ...asArray(state.lastStockSignals),
    ...asArray(state.topCryptoSignals),
    ...asArray(state.lastCryptoSignals),
    ...asArray(state.topSignals),
    ...asArray(state.lastSignals),
  ], { normalizeSymbol });
  const moversBySymbol = new Map();

  for (const rawSignal of sourceSignals) {
    const symbol = normalizeSymbol(rawSignal?.symbol);
    if (!symbol) continue;
    const merged = mergeLiveQuote(rawSignal);
    const liveQuote = findLiveQuote(state, symbol, normalizeSymbol) || {};
    const livePrice = Number(
      liveQuote.price || liveQuote.current ||
      liveQuote.lastTradePrice ||
      liveQuote.tradePrice ||
      liveQuote.lastPrice ||
      liveQuote.markPrice ||
      liveQuote.midPrice ||
      liveQuote.price ||
      liveQuote.livePrice ||
      merged.price || merged.current || merged.lastTradePrice ||
      merged.tradePrice ||
      merged.lastPrice ||
      merged.markPrice ||
      merged.midPrice ||
      merged.livePrice ||
      merged.currentPrice ||
      (Number(merged.price || 0) > 0 && Number(merged.price || 0) !== Number(merged.high || 0)
        ? merged.price
        : 0) ||
      merged.current ||
      merged.close ||
      merged.c ||
      0
    );
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;

    const previousClose = Number(
      liveQuote.previousClose || liveQuote.prevClose || merged.previousClose || merged.prevClose || merged.pc || 0
    );
    const open = Number(liveQuote.open || liveQuote.dayOpen || merged.open || merged.dayOpen || merged.o || 0);
    const measuredPercentChange = mergeMeasuredPercentChange(
      merged,
      {
        ...liveQuote,
        previousClose: previousClose > 0 ? previousClose : null,
      },
      { price: livePrice }
    );
    const changePercent = measuredPercentChange.available
      ? measuredPercentChange.value
      : null;
    const dayChangeAvailable = measuredPercentChange.available && (
      liveQuote.dayChangePercentAvailable === true ||
      merged.dayChangePercentAvailable === true ||
      [
        "previous_completed_utc_daily_close",
        "current_utc_day_open",
        "previous_close",
      ].includes(measuredPercentChange.referenceType)
    );
    const dayChangePercent = dayChangeAvailable ? changePercent : null;
    const liveStarterCandidate =
      asArray(state.liveStarterBuyHistory).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.quickInstitutionalCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.fastRunnerCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.topAutonomousCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      {};
    const recommendedTradeAmount = getApprovedTradeAmount(merged);
    const cryptoAsset = isCrypto(symbol);
    const scoringNow = now();
    const liveScoreUpdatedAt = scoringNow.toISOString();
    const cryptoMemory =
      state.cryptoInstitutionalMemory?.[symbol] ||
      state.cryptoInstitutionalMemory?.[symbol.replace("/", "")] ||
      state.cryptoInstitutionalMemory?.[symbol.replace("-USD", "USD")] ||
      {};
    const cryptoScores = positiveNumbers([
      merged.score,
      merged.institutionalScore,
      merged.aiConfidence,
      merged.autonomousConfidenceScore,
      merged.quickInstitutionalScore,
      merged.executionConfidence,
      merged.cryptoInstitutionalScore,
      merged.cryptoLiquidityScore,
      merged.cryptoMomentumScore,
      merged.phase42CryptoInstitutional?.cryptoInstitutionalScore,
      merged.cryptoInstitutionalQualification?.cryptoInstitutionalScore,
      merged.cryptoInstitutionalQualification?.score,
      merged.cryptoInstitutionalQualification?.volumeConfidenceScore,
      cryptoMemory.cryptoInstitutionalScore,
      cryptoMemory.cryptoLiquidityScore,
      cryptoMemory.cryptoMomentumScore,
    ]);
    const stockScores = positiveNumbers([
      merged.score,
      merged.institutionalScore,
      merged.aiConfidence,
      merged.autonomousConfidenceScore,
      merged.quickInstitutionalScore,
      merged.executionConfidence,
      merged.runnerScore,
      merged.fastRunnerScore,
      merged.finalLiveScore,
      merged.gateScore,
    ]);
    const displayScore = cryptoAsset
      ? Math.max(...cryptoScores, Number(merged.score || 0))
      : Math.max(...stockScores, Number(merged.score || 0));
    const quickInstitutionalScore = cryptoAsset
      ? Math.max(
        displayScore,
        Number(merged.quickInstitutionalScore || 0),
        Number(merged.institutionalScore || 0),
        Number(merged.phase42CryptoInstitutional?.cryptoInstitutionalScore || 0),
        Number(cryptoMemory.cryptoInstitutionalScore || 0)
      )
      : Number(merged.quickInstitutionalScore || merged.institutionalScore || merged.score || 0);
    const pair = mergeLiveQuoteEvidence(merged, liveQuote, { price: livePrice,
      quoteSource: liveQuote.liveQuoteSource || liveQuote.source });
    const { bid, ask, spreadAvailable, spreadPercent, spreadUpdatedAt, spreadSource } = pair;
    const liveQuoteUpdatedAt =
      liveQuote.liveQuoteUpdatedAt ||
      liveQuote.updatedAt ||
      liveQuote.quoteFetchedAt ||
      merged.liveQuoteUpdatedAt ||
      merged.updatedAt ||
      merged.quoteFetchedAt ||
      null;
    const liveQuoteSource =
      liveQuote.liveQuoteSource ||
      liveQuote.source ||
      liveQuote.dataSource ||
      merged.liveQuoteSource ||
      merged.source ||
      merged.dataSource ||
      "scan_snapshot";
    const providerMarkedLive =
      liveQuote.priceIsLive === true ||
      merged.priceIsLive === true;
    const priceIsLive = providerMarkedLive &&
      Boolean(liveQuoteUpdatedAt) &&
      isLiveQuoteSource(liveQuoteSource, cryptoAsset ? "crypto" : "stock");
    const liveQuoteTimestamp = liveQuoteUpdatedAt
      ? Date.parse(liveQuoteUpdatedAt)
      : NaN;
    const liveQuoteAgeSeconds = Number.isFinite(liveQuoteTimestamp)
      ? (scoringNow.getTime() - liveQuoteTimestamp) / 1000
      : null;
    const spreadTimestamp = spreadUpdatedAt
      ? Date.parse(spreadUpdatedAt)
      : NaN;
    const spreadAgeSeconds = Number.isFinite(spreadTimestamp)
      ? (scoringNow.getTime() - spreadTimestamp) / 1000
      : null;
    const liveQuoteFresh =
      priceIsLive &&
      liveQuoteAgeSeconds !== null &&
      liveQuoteAgeSeconds >= -5 &&
      liveQuoteAgeSeconds <= 5;
    const liveSpreadFresh =
      spreadAvailable &&
      isLiveQuoteSource(spreadSource, cryptoAsset ? "crypto" : "stock") &&
      spreadAgeSeconds !== null &&
      spreadAgeSeconds >= -5 &&
      spreadAgeSeconds <= 5;
    const scoringSignal = {
      ...merged,
      ...(cryptoAsset ? { cryptoRealism: { ...(merged.cryptoRealism || {}), spreadAvailable, spreadPercent } } : {}),
      symbol,
      price: livePrice,
      livePrice,
      current: livePrice,
      previousClose,
      open,
      dayOpen: open,
      changePercent,
      dayChangePercent,
      percentChange: changePercent,
      changePercentAvailable: measuredPercentChange.available,
      percentChangeAvailable: measuredPercentChange.available,
      dayChangePercentAvailable: dayChangeAvailable,
      bid,
      ask,
      spreadPercent,
      spreadAvailable,
      spreadUpdatedAt,
      spreadSource,
      liveQuoteUpdatedAt,
      liveQuoteSource,
      priceIsLive,
    };
    const stockDiscovery = cryptoAsset
      ? null
      : calculateEarlyDiscoveryScore(scoringSignal);
    const stockEntry = cryptoAsset
      ? null
      : calculateEntryQualityScore(scoringSignal);
    const stockDecision = cryptoAsset
      ? null
      : buildStockDecisionScore({
        ...scoringSignal,
        discoveryScorecard: stockDiscovery,
        entryQualityScorecard: stockEntry,
      });
    const cryptoDecision = cryptoAsset
      ? buildCryptoDecisionScore(scoringSignal, { now: scoringNow.getTime() })
      : null;
    const preservedStockDiscovery = cryptoAsset
      ? undefined
      : finiteNumber(
        merged.discoveryScorecard?.score,
        merged.decisionScoreTelemetry?.scores?.discovery,
        merged.discoveryScore
      );
    const preservedStockDiscoveryCoverage = Number(
      merged.discoveryScorecard?.coverage ??
      merged.decisionScoreTelemetry?.stages?.discovery?.coverage ??
      merged.stockDecisionEvidence?.discoveryCoverage ??
      0
    );
    const recalculatedStockDiscoveryAvailable =
      !cryptoAsset &&
      Number(stockDiscovery?.coverage || 0) >= 0.65 &&
      stockDiscovery?.canonicalExtensionEvidencePass === true;
    const preservedStockDiscoveryAvailable =
      !cryptoAsset &&
      preservedStockDiscovery !== undefined &&
      (
        merged.discoveryScoreAvailable === true ||
        (
          preservedStockDiscoveryCoverage >= 0.65 &&
          merged.discoveryScorecard?.canonicalExtensionEvidencePass === true
        )
      );
    const stockDiscoveryAvailable =
      preservedStockDiscoveryAvailable || recalculatedStockDiscoveryAvailable;
    const resolvedStockDiscovery = preservedStockDiscoveryAvailable
      ? preservedStockDiscovery
      : recalculatedStockDiscoveryAvailable
        ? Number(stockDiscovery?.score || 0)
        : null;
    const stockEntryAvailable =
      !cryptoAsset &&
      Number(stockEntry?.coverage || 0) >= 0.8 &&
      liveQuoteFresh &&
      liveSpreadFresh;
    const stockDecisionMissingEvidence = (
      stockDecision?.missingCriticalEvidence || []
    ).filter((reason) => reason !== "approvedEntry");
    const recalculatedStockDecisionAvailable =
      recalculatedStockDiscoveryAvailable &&
      stockEntryAvailable &&
      Number(stockDecision?.coverage || 0) >= 0.8 &&
      stockDecisionMissingEvidence.length === 0;
    // Discovery and Final are scan decisions. A one-second quote refresh must
    // not rebuild them from a reduced signal object that may no longer carry
    // the historical/context inputs used by the scanner. Entry is the only
    // score recalculated from the current quote.
    const preservedStockDecision = cryptoAsset
      ? undefined
      : finiteNumber(
        merged.masterFinalScore,
        merged.finalAutonomousDecisionScore,
        merged.stockDecisionScore,
        merged.centralAutonomousDecisionCore?.finalDecisionScore,
        merged.decisionScoreTelemetry?.scores?.decision
      );
    const preservedStockDecisionEvidenceAvailable =
      hasDecisionAnalysis(merged.stockDecisionEvidence ||
        merged.centralAutonomousDecisionCore?.stockDecisionEvidence ||
        merged.decisionScoreTelemetry?.stages?.decision);
    const preservedStockDecisionAvailable =
      !cryptoAsset &&
      merged.stockDecisionScoreAvailable !== false &&
      preservedStockDecision !== undefined &&
      (
        preservedStockDecisionEvidenceAvailable ||
        recalculatedStockDecisionAvailable
      );
    const stockDecisionAvailable =
      preservedStockDecisionAvailable || recalculatedStockDecisionAvailable;
    const resolvedStockDecision = preservedStockDecisionAvailable
      ? preservedStockDecision
      : recalculatedStockDecisionAvailable
        ? Number(stockDecision?.score || 0)
        : null;
    const preservedCryptoDiscovery = cryptoAsset
      ? finiteNumber(
        scoringSignal.cryptoDiscoveryScorecard?.score,
        scoringSignal.cryptoDiscoveryScore,
        scoringSignal.rawCryptoScore,
        scoringSignal.discoveryScorecard?.score
      )
      : undefined;
    const cryptoDiscoveryCoverage = Number(
      scoringSignal.cryptoDiscoveryScorecard?.coverage ??
      scoringSignal.discoveryScorecard?.coverage ??
      0
    );
    const cryptoDiscoveryAvailable =
      cryptoAsset &&
      preservedCryptoDiscovery !== undefined &&
      cryptoDiscoveryCoverage >= 0.5;
    const cryptoEntryAvailable =
      cryptoDecision?.componentsByName?.execution?.available === true &&
      liveQuoteFresh &&
      liveSpreadFresh;
    const preservedCryptoDecisionEvidence =
      merged.centralAutonomousDecisionCore?.cryptoDecisionEvidence ??
      merged.cryptoScoreTelemetry?.decision ??
      null;
    const preservedCryptoDecision = cryptoAsset
      ? finiteNumber(
        merged.cryptoDecisionScore,
        merged.centralAutonomousDecisionCore?.cryptoDecisionScore
      )
      : undefined;
    const preservedCryptoDecisionAvailable =
      cryptoAsset &&
      merged.cryptoDecisionScoreAvailable !== false &&
      preservedCryptoDecision !== undefined &&
      hasDecisionAnalysis(preservedCryptoDecisionEvidence);
    const liveCryptoDecisionAvailable = hasDecisionAnalysis(cryptoDecision);
    const resolvedCryptoDecision = liveCryptoDecisionAvailable
      ? Number(cryptoDecision?.score || 0)
      : preservedCryptoDecisionAvailable
        ? preservedCryptoDecision
        : null;
    const resolvedProvisionalCryptoDecision =
      resolvedCryptoDecision !== null
        ? null
        : finiteNumber(
          merged.provisionalCryptoDecisionScore,
          merged.centralAutonomousDecisionCore?.provisionalCryptoDecisionScore,
          cryptoDecision?.score
        );
    const resolvedCryptoDecisionEvidence = liveCryptoDecisionAvailable
      ? cryptoDecision
      : preservedCryptoDecisionEvidence || cryptoDecision;
    let next = normalizeSignalScoreCompleteness({
      ...merged,
      ...(cryptoAsset ? { cryptoRealism: scoringSignal.cryptoRealism } : {}),
      symbol,
      assetClass: merged.assetClass || merged.asset_class || (cryptoAsset ? "crypto" : "stock"),
      marketOpen: cryptoAsset || state.marketOpen === true,
      price: livePrice,
      livePrice,
      displayPrice: livePrice,
      current: livePrice,
      previousClose,
      open,
      dayOpen: open,
      changePercent,
      dayChangePercent,
      percentChange: changePercent,
      changePercentAvailable: measuredPercentChange.available,
      percentChangeAvailable: measuredPercentChange.available,
      dayChangePercentAvailable: dayChangeAvailable,
      bid,
      ask,
      spreadPercent,
      spreadAvailable,
      spreadUpdatedAt,
      spreadAgeSeconds: spreadAgeSeconds === null
        ? null
        : Number(spreadAgeSeconds.toFixed(2)),
      liveSpreadFresh,
      liveQuoteUpdatedAt,
      liveQuoteSource,
      liveQuoteAgeSeconds: liveQuoteAgeSeconds === null
        ? null
        : Number(liveQuoteAgeSeconds.toFixed(2)),
      liveQuoteFresh,
      priceIsLive,
      score: displayScore,
      institutionalScore: displayScore,
      aiConfidence: displayScore,
      autonomousConfidenceScore: displayScore,
      cryptoInstitutionalScore: displayScore,
      runnerScore: Number(merged.runnerScore || merged.fastRunnerScore || liveQuote.fastRunnerScore || 0),
      quickInstitutionalScore,
      tapeSpeedScore: Number(merged.tapeSpeedScore || merged.tapeSpeed || liveQuote.tapeSpeed || 0),
      liquidityPressureScore: Number(
        merged.liquidityPressureScore || merged.liquidityPressure || liveQuote.liquidityPressure || 0
      ),
      qualifiedToBuy: merged.qualifiedToBuy === true,
      backendApproved:
        merged.backendApproved === true || hasExplicitTradeApproval(merged),
      approved:
        merged.approved === true || hasExplicitTradeApproval(merged),
      autoTradeApproved: merged.autoTradeApproved === true,
      recommendedTradeAmount,
      aiAllocationPercentOfBotBudget: Number(
        merged.aiAllocationPercentOfBotBudget ||
        merged.positionSizing?.aiAllocationPercentOfBotBudget ||
        merged.portfolioManager?.aiAllocationPercentOfBotBudget ||
        0
      ),
      aiPortfolioAction:
        merged.aiPortfolioAction ||
        merged.portfolioAction ||
        merged.portfolioManager?.aiPortfolioAction ||
        (merged.autoTradeApproved ? "AUTO-TRADE APPROVED" : "Watch Only"),
      portfolioManagerReason:
        merged.portfolioManagerReason ||
        merged.reason ||
        merged.pattern ||
        merged.tradeQuality ||
        "Live mover price update",
      missingEvidenceReasons: cryptoAsset
        ? asArray(
          resolvedCryptoDecisionEvidence?.missingCriticalEvidence ||
          resolvedCryptoDecisionEvidence?.missingEvidence
        )
        : [
          ...new Set([
            ...asArray(merged.missingEvidenceReasons),
            ...asArray(stockDiscovery?.missingCriticalEvidence),
            ...asArray(stockEntry?.missingCriticalEvidence),
            ...asArray(stockDecision?.missingCriticalEvidence),
          ]),
        ],
      liveScoreRefresh: true,
      liveScoreUpdatedAt,
      ...(cryptoAsset
        ? {
          rawCryptoScore: cryptoDiscoveryAvailable
            ? Number(preservedCryptoDiscovery)
            : null,
          cryptoDiscoveryScoreAvailable: cryptoDiscoveryAvailable,
          cryptoDiscoveryScoreCoverage: cryptoDiscoveryCoverage,
          cryptoDiscoveryScoreFresh:
            cryptoDecision?.discoveryFreshness?.fresh === true,
          cryptoEntryScore: cryptoEntryAvailable
            ? Number(cryptoDecision.componentsByName.execution.value || 0)
            : null,
          cryptoEntryScoreAvailable: cryptoEntryAvailable,
          cryptoDecisionScore: resolvedCryptoDecision,
          cryptoDecisionScoreAvailable: resolvedCryptoDecision !== null,
          cryptoDecisionLiveVerified: liveCryptoDecisionAvailable,
          provisionalCryptoDecisionScore:
            resolvedProvisionalCryptoDecision == null
              ? null
              : Number(resolvedProvisionalCryptoDecision),
          cryptoDecisionCoverage: Number(
            resolvedCryptoDecisionEvidence?.coverage || 0
          ),
          cryptoScoreTelemetry: {
            ...(merged.cryptoScoreTelemetry || {}),
            decision: resolvedCryptoDecisionEvidence,
            liveDecisionRefresh: cryptoDecision,
            liveEntryCalculatedAt: liveScoreUpdatedAt,
          },
          centralAutonomousDecisionCore: {
            ...(merged.centralAutonomousDecisionCore || {}),
            cryptoDecisionScore: resolvedCryptoDecision,
            provisionalCryptoDecisionScore:
              resolvedProvisionalCryptoDecision == null
                ? null
                : Number(resolvedProvisionalCryptoDecision),
            cryptoDecisionEvidence: resolvedCryptoDecisionEvidence,
            liveCryptoDecisionRefresh: cryptoDecision,
          },
        }
        : {
          discoveryScore: stockDiscoveryAvailable
            ? Number(resolvedStockDiscovery)
            : null,
          discoveryScoreAvailable: stockDiscoveryAvailable,
          discoveryScorecard:
            merged.discoveryScorecard || stockDiscovery,
          entryQualityScore: stockEntryAvailable
            ? Number(stockEntry.score || 0)
            : null,
          entryQualityScoreAvailable: stockEntryAvailable,
          entryQualityScorecard: stockEntry,
          stockDecisionScore: stockDecisionAvailable
            ? Number(resolvedStockDecision)
            : null,
          stockDecisionScoreAvailable: stockDecisionAvailable,
          stockDecisionScoreSource: preservedStockDecisionAvailable
            ? "engine_final_decision"
            : recalculatedStockDecisionAvailable
              ? "complete_live_recalculation"
              : "unavailable",
          stockDecisionLiveVerified: recalculatedStockDecisionAvailable,
          decisionScoreCoverage: Number(
            merged.decisionScoreCoverage ??
            merged.decisionScoreTelemetry?.stages?.decision?.coverage ??
            stockDecision?.coverage ??
            0
          ),
          stockDecisionEvidence: {
            ...(merged.stockDecisionEvidence || {}),
            analysisEvidencePass: preservedStockDecisionAvailable || hasDecisionAnalysis(stockDecision),
            coreEvidencePass:
              merged.stockDecisionEvidence?.coreEvidencePass === true ||
              merged.centralAutonomousDecisionCore?.stockDecisionEvidence
                ?.coreEvidencePass === true ||
              merged.decisionScoreTelemetry?.stages?.decision
                ?.coreEvidencePass === true ||
              stockDecision?.coreEvidencePass === true,
            liveMissingCriticalEvidence:
              stockDecision?.missingCriticalEvidence || [],
            discoveryCoverage: Number(
              preservedStockDiscoveryCoverage || stockDiscovery?.coverage || 0
            ),
            entryCoverage: Number(stockEntry?.coverage || 0),
            entryApproved: stockEntry?.approved === true,
          },
          decisionScoreTelemetry: {
            ...(merged.decisionScoreTelemetry || {}),
            liveEntryRefresh: {
              calculatedAt: liveScoreUpdatedAt,
              entry: stockEntry,
              completeDecisionRecalculation: recalculatedStockDecisionAvailable
                ? stockDecision
                : null,
            },
          },
        }),
    });
    next = normalizeSignalScoreCompleteness(revalidateCandidate(merged, next, { now: scoringNow.getTime() }));
    const executionGate = cryptoAsset
      ? evaluateCryptoTradeCandidate(next, {
        minimumScore: CRYPTO_MIN_FINAL_SCORE_TO_BUY,
        now: scoringNow.getTime(),
      })
      : evaluateStockTradeCandidate(next, {
        requireCentralDecision: true,
        requireFreshDecision: true,
        requireExplicitApproval: true,
        maxQuoteAgeSeconds: 5,
        now: scoringNow.getTime(),
      });
    const explicitApproval = hasExplicitTradeApproval(next);
    const validSizing =
      Number.isFinite(Number(next.recommendedTradeAmount)) &&
      Number(next.recommendedTradeAmount) >= 1;
    next.executionEligibility = {
      approved:
        executionGate.approved === true &&
        explicitApproval &&
        liveQuoteFresh &&
        liveSpreadFresh &&
        validSizing,
      assetClass: cryptoAsset ? "crypto" : "stock",
      canonicalScore: cryptoAsset
        ? (next.cryptoDecisionScoreAvailable ? next.cryptoDecisionScore : null)
        : (next.stockDecisionScoreAvailable ? next.stockDecisionScore : null),
      explicitApproval,
      quoteFresh: liveQuoteFresh,
      spreadFresh: liveSpreadFresh,
      sizingValid: validSizing,
      reasons: [
        ...(executionGate.reasons || []),
        ...(explicitApproval ? [] : ["EXPLICIT_APPROVAL_MISSING"]),
        ...(liveQuoteFresh ? [] : ["LIVE_QUOTE_NOT_FRESH"]),
        ...(liveSpreadFresh ? [] : ["LIVE_SPREAD_NOT_FRESH"]),
        ...(validSizing ? [] : ["VALID_SIZING_MISSING"]),
      ],
      evaluatedAt: liveScoreUpdatedAt,
    };
    // Permission still belongs to the canonical scan; eligibility has a
    // separate clock so recovery from a stale quote is not a new trade thesis.
    next.liveEligibilityCanRecover = hasExplicitTradeApproval(merged) &&
      getApprovedTradeAmount(merged) > 0 &&
      ![merged.blockBuying, merged.displayOnly, merged.centralCoreHardBlock,
        merged.finalSizingReconciliation?.finalBlocked, merged.globalRiskOffDefense?.shouldBlock,
        merged.shouldWaitForPullback, merged.finalMasterDecisionProfile?.suppressEntry].some(v => v === true);
    next.buyableNow = next.executionEligibility.approved;
    const current = moversBySymbol.get(symbol);
    const nextAuthority = measuredDecisionAuthority(next, cryptoAsset);
    const currentAuthority = measuredDecisionAuthority(current, cryptoAsset);
    const nextHasCanonicalFinal = getCanonicalFinalScore(next) !== null;
    const currentHasCanonicalFinal = getCanonicalFinalScore(current) !== null;
    if (
      !current ||
      (nextHasCanonicalFinal && !currentHasCanonicalFinal) ||
      (
        nextHasCanonicalFinal === currentHasCanonicalFinal &&
        (
          nextAuthority > currentAuthority ||
          (
            nextAuthority === currentAuthority &&
            Math.abs(next.changePercent) > Math.abs(current.changePercent)
          )
        )
      )
    ) {
      moversBySymbol.set(symbol, next);
    }
  }

  return selectCandidateDisplayWindow(Array.from(moversBySymbol.values()).filter(candidate => candidateFeedDecision(candidate).visible)
    .map((candidate) => ({
      ...candidate,
      canonicalFinalScore: getCanonicalFinalScore(candidate),
    })), Math.min(100, Math.max(10, Number(limit || 50))));
}
