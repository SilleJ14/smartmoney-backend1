import { buildLiveMovers } from "../market-data/liveMovers.js";
import { compareCanonicalSignals } from "../scoring/canonicalSignalRank.js";
import { createHash } from 'node:crypto';

function candidateDecisionVersion(state) {
  const hash = createHash('sha256');
  // Include in-place mutations as well as collection replacement. Do not hash
  // technical histories/news/debug payloads on this high-frequency route.
  for (const key of ['quickInstitutionalCandidates', 'fastRunnerCandidates', 'topStockSignals',
    'lastStockSignals', 'topCryptoSignals', 'lastCryptoSignals', 'topSignals', 'lastSignals', 'earlyAssessedStockSignals']) {
    for (const s of state[key] || []) hash.update(JSON.stringify([
      s.symbol, s.decisionUpdatedAt, s.analysisUpdatedAt, s.centralAutonomousDecisionCore?.updatedAt,
      s.approved, s.backendApproved, s.autoTradeApproved, s.qualifiedToBuy,
      s.buyableNow, s.executionEligibility, s.finalStockExecutionGate,
      s.stockDecisionScoreAvailable, s.cryptoDecisionScoreAvailable, s.masterFinalScore,
      s.stockDecisionScore, s.cryptoDecisionScore, s.entryQualityScore, s.cryptoEntryScore,
      s.finalApprovedTradeAmount, s.finalTradeAmount, s.recommendedTradeAmount, s.sizingDecisionUpdatedAt,
      s.finalSizingReconciliation, s.blockBuying, s.buyBlocked, s.displayOnly, s.centralCoreHardBlock,
      s.globalRiskOffDefense?.shouldBlock, s.shouldWaitForPullback, s.finalMasterDecisionProfile?.suppressEntry,
      s.liveQuoteUpdatedAt, s.spreadUpdatedAt, s.priceIsLive, s.spreadAvailable, s.price, s.bid, s.ask,
    ]));
  }
  return hash.digest('hex');
}

export function registerLiveMoversRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    normalizeSymbol,
    mergeLiveQuote,
    isCrypto,
    refreshQuotes,
    getRuntimeStatus,
  } = dependencies;
  const cacheTtlMs = 1500;
  let cachedSnapshot = null;

  const boundedLimit = (value) => Math.min(
    100,
    Math.max(10, Number(value || 50))
  );
  const getStateVersion = (state) => [
    Number(state.liveQuoteCacheVersion || 0),
    state.lastScanAt || "",
    state.lastSuccessfulCycleAt || "",
    state.lastStockScanAt || "",
    state.lastCryptoScanAt || "",
    candidateDecisionVersion(state),
    state.marketOpen, state.marketSession,
  ].join(":");

  app.get("/live-movers", requireAdmin, async (req, res) => {
    try {
      const state = getState();
      const limit = boundedLimit(req.query.limit);
      let activeQuoteRefresh = null;
      if (String(req.query.refresh || "").toLowerCase() === "true" && typeof refreshQuotes === "function") {
        const refreshCandidates = buildLiveMovers({
          state,
          limit: 100,
          normalizeSymbol,
          mergeLiveQuote,
          isCrypto,
        }).sort(compareCanonicalSignals);
        activeQuoteRefresh = await refreshQuotes(
          refreshCandidates.map((candidate) => candidate.symbol)
        );
      }
      const stateVersion = getStateVersion(state);
      const nowMs = Date.now();
      const cacheHit = activeQuoteRefresh === null &&
        cachedSnapshot?.stateVersion === stateVersion &&
        nowMs < cachedSnapshot.expiresAt &&
        nowMs - cachedSnapshot.generatedAtMs <= cacheTtlMs;
      if (!cacheHit) {
        cachedSnapshot = {
          stateVersion,
          generatedAtMs: nowMs,
          items: buildLiveMovers({
            state,
            limit: 100,
            normalizeSymbol,
            mergeLiveQuote,
            isCrypto,
          }),
        };
        cachedSnapshot.expiresAt = Math.min(nowMs + cacheTtlMs,
          ...cachedSnapshot.items.flatMap(s => [s.liveQuoteUpdatedAt, s.spreadUpdatedAt]
            .map(t => Date.parse(t) + 5000).filter(t => Number.isFinite(t) && t > nowMs)));
      }
      const movers = cachedSnapshot.items.slice(0, limit);
      const runtime = getRuntimeStatus();
      res.json({
        ok: true,
        source: "live_movers_lightweight",
        generatedAt: new Date(cachedSnapshot.generatedAtMs).toISOString(),
        stateVersion,
        cache: { hit: cacheHit, ttlMs: cacheTtlMs },
        count: movers.length,
        items: movers,
        // One compatibility alias for the deployed client. New clients consume
        // `items`; the former signals/stockSignals/cryptoSignals copies made
        // JSON serialization scale with the same objects four times.
        movers,
        activeQuoteRefresh,
        ...runtime,
        marketOpen: state.marketOpen === true,
        marketSession: state.marketSession || null,
        effectiveMode: state.effectiveMode,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "Failed to load live movers",
        details: err.message,
        generatedAt: new Date().toISOString(),
      });
    }
  });
}
