import {
  buildStockDecisionScore,
  calculateEarlyDiscoveryScore,
  calculateEntryQualityScore,
} from "../scoring/decisionScores.js";
import { buildCryptoDecisionScore } from "../scoring/componentScore.js";

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

export function buildLiveMovers({
  state,
  limit = 50,
  normalizeSymbol,
  mergeLiveQuote,
  isCrypto,
  now = () => new Date(),
}) {
  const sourceSignals = [
    ...asArray(state.topStockSignals),
    ...asArray(state.lastStockSignals),
    ...asArray(state.topCryptoSignals),
    ...asArray(state.lastCryptoSignals),
    ...asArray(state.topSignals),
    ...asArray(state.lastSignals),
  ];
  const moversBySymbol = new Map();

  for (const rawSignal of sourceSignals) {
    const symbol = normalizeSymbol(rawSignal?.symbol);
    if (!symbol) continue;
    const merged = mergeLiveQuote(rawSignal);
    const liveQuote = findLiveQuote(state, symbol, normalizeSymbol) || {};
    const livePrice = Number(
      liveQuote.lastTradePrice ||
      liveQuote.tradePrice ||
      liveQuote.lastPrice ||
      liveQuote.markPrice ||
      liveQuote.midPrice ||
      liveQuote.price ||
      liveQuote.livePrice ||
      merged.lastTradePrice ||
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
    const changePercent = previousClose > 0
      ? ((livePrice - previousClose) / previousClose) * 100
      : Number(
        merged.dayChangePercent ||
        merged.percentChange ||
        merged.changePercent ||
        liveQuote.percentChange ||
        liveQuote.livePercentChange ||
        0
      );
    const liveStarterCandidate =
      asArray(state.liveStarterBuyHistory).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.quickInstitutionalCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.fastRunnerCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.topAutonomousCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      {};
    const recommendedTradeAmount = Number(
      merged.recommendedTradeAmount ||
      merged.rawRecommendedTradeAmount ||
      merged.recommendedSize ||
      merged.tradeAmount ||
      merged.positionSize ||
      merged.dollarAmount ||
      merged.notional ||
      merged.positionSizing?.recommendedTradeAmount ||
      merged.positionSizing?.recommendedSize ||
      merged.portfolioManager?.recommendedTradeAmount ||
      merged.portfolioManager?.aiRecommendedTradeAmount ||
      liveStarterCandidate.decision?.starterAmount ||
      liveStarterCandidate.decision?.plannedFullTradeAmount ||
      state.aiEntryScores?.[symbol]?.starterAmount ||
      state.aiEntryScores?.[symbol]?.plannedFullTradeAmount ||
      liveStarterCandidate.recommendedTradeAmount ||
      liveStarterCandidate.rawRecommendedTradeAmount ||
      liveStarterCandidate.recommendedSize ||
      liveStarterCandidate.tradeAmount ||
      liveStarterCandidate.positionSize ||
      liveStarterCandidate.dollarAmount ||
      0
    );
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
    const bid = Number(liveQuote.bid || merged.bid || 0);
    const ask = Number(liveQuote.ask || merged.ask || 0);
    const spreadAvailable = liveQuote.spreadAvailable === true || (
      liveQuote.spreadAvailable !== false &&
      merged.spreadAvailable !== false &&
      bid > 0 &&
      ask >= bid
    );
    const rawSpreadPercent = liveQuote.spreadPercent ?? merged.spreadPercent;
    const spreadPercent = spreadAvailable && Number.isFinite(Number(rawSpreadPercent))
      ? Number(rawSpreadPercent)
      : spreadAvailable && bid > 0 && ask >= bid
        ? ((ask - bid) / ((ask + bid) / 2)) * 100
        : null;
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
    const priceIsLive = providerMarkedLive && Boolean(liveQuoteUpdatedAt);
    const liveQuoteTimestamp = liveQuoteUpdatedAt
      ? Date.parse(liveQuoteUpdatedAt)
      : NaN;
    const liveQuoteAgeSeconds = Number.isFinite(liveQuoteTimestamp)
      ? (scoringNow.getTime() - liveQuoteTimestamp) / 1000
      : null;
    const liveQuoteFresh =
      priceIsLive &&
      liveQuoteAgeSeconds !== null &&
      liveQuoteAgeSeconds >= -5 &&
      liveQuoteAgeSeconds <= 5;
    const scoringSignal = {
      ...merged,
      symbol,
      price: livePrice,
      livePrice,
      current: livePrice,
      previousClose,
      open,
      dayOpen: open,
      changePercent,
      dayChangePercent: changePercent,
      percentChange: changePercent,
      bid,
      ask,
      spreadPercent,
      spreadAvailable,
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
    const stockDiscoveryAvailable =
      !cryptoAsset &&
      Number(stockDiscovery?.coverage || 0) >= 0.65 &&
      stockDiscovery?.canonicalExtensionEvidencePass === true;
    const stockEntryAvailable =
      !cryptoAsset &&
      Number(stockEntry?.coverage || 0) >= 0.8 &&
      liveQuoteFresh;
    const stockDecisionMissingEvidence = (
      stockDecision?.missingCriticalEvidence || []
    ).filter((reason) => reason !== "approvedEntry");
    const stockDecisionAvailable =
      stockDiscoveryAvailable &&
      stockEntryAvailable &&
      Number(stockDecision?.coverage || 0) >= 0.8 &&
      stockDecisionMissingEvidence.length === 0;
    const cryptoDiscoveryAvailable =
      cryptoDecision?.componentsByName?.base?.available === true &&
      Number(scoringSignal.cryptoDiscoveryScorecard?.coverage || 0) >= 0.65 &&
      cryptoDecision?.discoveryFreshness?.fresh === true;
    const cryptoEntryAvailable =
      cryptoDecision?.componentsByName?.execution?.available === true;
    const next = {
      ...merged,
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
      dayChangePercent: changePercent,
      percentChange: changePercent,
      bid,
      ask,
      spreadPercent,
      spreadAvailable,
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
        merged.backendApproved === true ||
        merged.approved === true ||
        merged.qualifiedToBuy === true ||
        merged.autoTradeApproved === true,
      approved:
        merged.approved === true ||
        merged.backendApproved === true ||
        merged.qualifiedToBuy === true ||
        merged.autoTradeApproved === true,
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
      liveScoreRefresh: true,
      liveScoreUpdatedAt,
      ...(cryptoAsset
        ? {
          rawCryptoScore: cryptoDiscoveryAvailable
            ? Number(cryptoDecision.componentsByName.base.value || 0)
            : null,
          cryptoDiscoveryScoreAvailable: cryptoDiscoveryAvailable,
          cryptoEntryScore: cryptoEntryAvailable
            ? Number(cryptoDecision.componentsByName.execution.value || 0)
            : null,
          cryptoEntryScoreAvailable: cryptoEntryAvailable,
          cryptoDecisionScore:
            cryptoDecision?.coreEvidencePass === true
              ? Number(cryptoDecision.score || 0)
              : null,
          provisionalCryptoDecisionScore:
            cryptoDecision?.coreEvidencePass === true
              ? null
              : Number(cryptoDecision?.score || 0),
          cryptoDecisionCoverage: Number(cryptoDecision?.coverage || 0),
          cryptoScoreTelemetry: {
            ...(merged.cryptoScoreTelemetry || {}),
            decision: cryptoDecision,
            calculatedAt: liveScoreUpdatedAt,
          },
          centralAutonomousDecisionCore: {
            ...(merged.centralAutonomousDecisionCore || {}),
            cryptoDecisionScore:
              cryptoDecision?.coreEvidencePass === true
                ? Number(cryptoDecision.score || 0)
                : null,
            provisionalCryptoDecisionScore:
              cryptoDecision?.coreEvidencePass === true
                ? null
                : Number(cryptoDecision?.score || 0),
            cryptoDecisionEvidence: cryptoDecision,
          },
        }
        : {
          discoveryScore: stockDiscoveryAvailable
            ? Number(stockDiscovery.score || 0)
            : null,
          discoveryScoreAvailable: stockDiscoveryAvailable,
          discoveryScorecard: stockDiscovery,
          entryQualityScore: stockEntryAvailable
            ? Number(stockEntry.score || 0)
            : null,
          entryQualityScoreAvailable: stockEntryAvailable,
          entryQualityScorecard: stockEntry,
          stockDecisionScore: stockDecisionAvailable
            ? Number(stockDecision.score || 0)
            : null,
          stockDecisionScoreAvailable: stockDecisionAvailable,
          decisionScoreCoverage: Number(stockDecision?.coverage || 0),
          stockDecisionEvidence: {
            coreEvidencePass: stockDecision?.coreEvidencePass === true,
            missingCriticalEvidence: stockDecision?.missingCriticalEvidence || [],
            discoveryCoverage: Number(stockDiscovery?.coverage || 0),
            entryCoverage: Number(stockEntry?.coverage || 0),
            entryApproved: stockEntry?.approved === true,
          },
          decisionScoreTelemetry: {
            version: 2,
            calculatedAt: liveScoreUpdatedAt,
            scores: {
              discovery: Number(stockDiscovery?.score || 0),
              entry: Number(stockEntry?.score || 0),
              continuation: finiteNumber(
                merged.continuationScorecard?.score,
                merged.multiDayScore,
                merged.multiDayContinuationScore
              ) || 0,
              decision: Number(stockDecision?.score || 0),
            },
            stages: {
              discovery: stockDiscovery,
              entry: stockEntry,
              continuation: merged.continuationScorecard || null,
              decision: stockDecision,
            },
          },
        }),
    };
    const current = moversBySymbol.get(symbol);
    const nextAuthority = measuredDecisionAuthority(next, cryptoAsset);
    const currentAuthority = measuredDecisionAuthority(current, cryptoAsset);
    if (
      !current ||
      nextAuthority > currentAuthority ||
      (
        nextAuthority === currentAuthority &&
        Math.abs(next.changePercent) > Math.abs(current.changePercent)
      )
    ) {
      moversBySymbol.set(symbol, next);
    }
  }

  return Array.from(moversBySymbol.values())
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, Math.min(100, Math.max(10, Number(limit || 50))));
}
