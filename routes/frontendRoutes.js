import {
  compareCanonicalSignals,
  getCanonicalFinalScore,
  hasExplicitTradeApproval,
} from "../scoring/canonicalSignalRank.js";

function uniqueSignals(signals, normalizeSymbol) {
  return signals
    .filter(Boolean)
    .filter(
      (signal, index, all) =>
        all.findIndex(
          (item) => normalizeSymbol(item.symbol) === normalizeSymbol(signal.symbol)
        ) === index
    );
}

function collectSignals(state, latestStatus, normalizeSymbol, includeFastRunners = false) {
  const orchestration = latestStatus?.phase20AutonomousOrchestration || {};
  return uniqueSignals(
    [
      ...(Array.isArray(state.topStockSignals) ? state.topStockSignals : []),
      ...(Array.isArray(state.lastStockSignals) ? state.lastStockSignals : []),
      ...(includeFastRunners && Array.isArray(state.fastRunnerCandidates)
        ? state.fastRunnerCandidates
        : []),
      ...(includeFastRunners && Array.isArray(state.quickInstitutionalCandidates)
        ? state.quickInstitutionalCandidates
        : []),
      ...(Array.isArray(state.topCryptoSignals) ? state.topCryptoSignals : []),
      ...(Array.isArray(state.lastCryptoSignals) ? state.lastCryptoSignals : []),
      ...(Array.isArray(orchestration.topSignals) ? orchestration.topSignals : []),
    ],
    normalizeSymbol
  );
}

export function registerFrontendRoutes(app, dependencies) {
  const {
    requireAdmin,
    getState,
    getConfig,
    refreshAccountCache,
    getLatestStatus,
    buildStartupSnapshot,
    normalizeSymbol,
    mergeLiveQuote,
    getTopSignals,
    getMarketNewsFeed,
  } = dependencies;

  app.get("/frontend/portfolio", requireAdmin, async (req, res) => {
    try {
      await refreshAccountCache();
      const latestStatus = getLatestStatus();
      const config = getConfig();
      const account = latestStatus?.account || {};
      const risk = latestStatus?.risk || {};
      const dashboard = latestStatus?.institutionalDashboard || {};
      const governor = dashboard?.portfolioGovernor || {};
      const equity = Number(account.equity || risk.currentEquity || 0);
      const cash = Number(account.cash || risk.currentCash || 0);
      const openValue = Number(
        account.position_market_value || risk.currentBotExposure || governor.currentExposure || 0
      );
      const maxBotBudget = Number(governor.maxBudget || risk.maxBotBudget || 0);
      const autoCapLeft = Math.max(0, maxBotBudget - openValue);
      const peakEquity = Number(account.peakEquity || risk.peakEquity || equity);
      const drawdownPercent = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      const lastEquity = Number(account.last_equity || 0);
      const portfolioReturnPercent =
        lastEquity > 0 ? ((equity - lastEquity) / lastEquity) * 100 : 0;

      res.json({
        success: true,
        portfolio: {
          equity,
          cash,
          openValue,
          maxBotBudget,
          autoCapLeft,
          unrealizedPL: equity - cash,
          realizedPL: 0,
          portfolioReturnPercent,
          drawdownPercent,
          dailyLossLeftPercent: Number(config.dailyLossLimitPercent || 2) - drawdownPercent,
          openPositions: Number(latestStatus?.positions?.length || 0),
          peakEquity,
        },
      });
    } catch (err) {
      console.error("frontend portfolio error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/snapshot", requireAdmin, (req, res) => {
    try {
      const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
      res.json({ success: true, ...buildStartupSnapshot(limit) });
    } catch (err) {
      console.error("frontend snapshot error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/signals", requireAdmin, async (req, res) => {
    try {
      const signals = collectSignals(
        getState(),
        getLatestStatus(),
        normalizeSymbol,
        true
      ).map(mergeLiveQuote);
      const approvedSignals = signals
        .filter(hasExplicitTradeApproval)
        .sort(compareCanonicalSignals);
      const displaySignals = approvedSignals.length
        ? approvedSignals
        : signals.sort(compareCanonicalSignals);
      res.json({
        success: true,
        count: displaySignals.length,
        approvedCount: approvedSignals.length,
        source: approvedSignals.length ? "approved_signals" : "memory_snapshot_fallback",
        signals: displaySignals,
      });
    } catch (err) {
      console.error("frontend signals error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/ai", requireAdmin, async (req, res) => {
    try {
      const latestStatus = getLatestStatus();
      const brain = latestStatus?.phase21AutonomousBrain || {};
      const orchestration = latestStatus?.phase20AutonomousOrchestration || {};
      const autonomous = latestStatus?.autonomousTradingSystem || {};
      const governor = latestStatus?.institutionalDashboard?.portfolioGovernor || {};
      const newsCandidates = uniqueSignals(
        [
          ...(Array.isArray(brain.topAutonomousCandidates) ? brain.topAutonomousCandidates : []),
          ...collectSignals(getState(), latestStatus, normalizeSymbol, true),
        ],
        normalizeSymbol
      ).map(mergeLiveQuote).slice(0, 50);
      const newsFeed = [];
      const seenHeadlines = new Set();
      const addNewsItem = (signal, value) => {
        const article = typeof value === "string" ? { headline: value } : value || {};
        const headline = String(article.headline || article.title || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);
        if (!headline) return;
        const dedupeKey = headline.toLowerCase();
        if (seenHeadlines.has(dedupeKey)) return;
        seenHeadlines.add(dedupeKey);

        const rawTimestamp =
          article.publishedAt ||
          article.published_at ||
          article.datetime ||
          article.timestamp ||
          0;
        const numericTimestamp = Number(rawTimestamp);
        const parsedTimestamp = Number.isFinite(numericTimestamp) && numericTimestamp > 0
          ? numericTimestamp < 10_000_000_000
            ? numericTimestamp * 1000
            : numericTimestamp
          : Date.parse(String(rawTimestamp || ""));

        newsFeed.push({
          symbol: normalizeSymbol(signal?.symbol) || "MARKET",
          headline,
          source: String(article.source || article.provider || signal?.newsSource || "Market news")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          publishedAt: Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0,
        });
      };

      let marketNews = { available: false, articles: [], stale: false, reason: "News feed unavailable" };
      if (typeof getMarketNewsFeed === "function") {
        try {
          const result = await getMarketNewsFeed();
          if (result && typeof result === "object") marketNews = result;
        } catch (error) {
          marketNews = {
            available: false,
            articles: [],
            stale: false,
            reason: error?.message || "News feed unavailable",
          };
        }
      }

      (Array.isArray(marketNews.articles) ? marketNews.articles : [])
        .slice(0, 24)
        .forEach((article) => {
          addNewsItem(
            { symbol: article?.symbol || article?.related || article?.category || "MARKET" },
            article
          );
        });

      newsCandidates.forEach((signal) => {
        const confirmations = signal?.confirmations || {};
        [
          ...(Array.isArray(confirmations.newsArticles) ? confirmations.newsArticles : []),
          ...(Array.isArray(signal?.newsArticles) ? signal.newsArticles : []),
        ].slice(0, 8).forEach((article) => addNewsItem(signal, article));

        [
          confirmations.newsHeadlines,
          confirmations.riskyNewsHeadlines,
          signal?.newsHeadlines,
        ].forEach((headlines) => {
          if (!Array.isArray(headlines)) return;
          headlines.slice(0, 8).forEach((headline) => addNewsItem(signal, headline));
        });
      });

      newsFeed.sort((a, b) => b.publishedAt - a.publishedAt);
      res.json({
        success: true,
        ai: {
          brainMode: brain.brainMode,
          autonomousIntelligenceScore: brain.autonomousIntelligenceScore,
          parliamentDecision: autonomous.capitalParliamentDecision,
          probabilityScore: autonomous.probabilityScore,
          consensusScore: orchestration.consensusScore,
          governorMode: governor.governorMode,
          governorScore: governor.governorScore,
          capitalThrottleMultiplier: governor.capitalThrottleMultiplier,
          shouldBlockNewTrades: brain.shouldBlockNewTrades,
          finalSystemReason: autonomous.finalSystemReason,
          governorReason: governor.governorReason,
          topCandidates: brain.topAutonomousCandidates || [],
          newsFeed: newsFeed.slice(0, 12),
          newsFeedStatus: {
            available: marketNews.available === true,
            stale: marketNews.stale === true,
            reason: marketNews.reason || "",
            fetchedAt: marketNews.fetchedAt || null,
          },
        },
      });
    } catch (err) {
      console.error("frontend ai error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/alerts", requireAdmin, async (req, res) => {
    try {
      const config = getConfig();
      const alerts = collectSignals(getState(), getLatestStatus(), normalizeSymbol)
        .map(mergeLiveQuote)
        .filter((signal) => {
          const score = getCanonicalFinalScore(signal);
          return score !== null && score >= Number(config.minScoreToBuy || 70);
        })
        .sort(compareCanonicalSignals)
        .slice(0, 25)
        .map((signal) => {
          const score = getCanonicalFinalScore(signal);
          return {
            symbol: signal.symbol,
            score,
            message:
              signal.portfolioManagerReason ||
              signal.technicalReason ||
              signal.executionReason ||
              "Institutional signal detected",
            approved: hasExplicitTradeApproval(signal),
            executionConfidence: signal.executionConfidence || 0,
            institutionalGrade: signal.institutionalGrade || "NORMAL",
          };
        });
      res.json({ success: true, count: alerts.length, alerts });
    } catch (err) {
      console.error("frontend alerts error", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/frontend/dashboard", requireAdmin, async (req, res) => {
    const state = getState();
    try {
      const latestStatus = getLatestStatus();
      const topSignals = getTopSignals(
        collectSignals(state, latestStatus, normalizeSymbol),
        25
      ).map(mergeLiveQuote);
      res.json({
        success: true,
        dashboard: {
          marketRegime: latestStatus?.institutionalDashboard?.marketRegime || {},
          autonomousTradingSystem: latestStatus?.autonomousTradingSystem || {},
          portfolioGovernor: latestStatus?.institutionalDashboard?.portfolioGovernor || {},
          topSignals,
          topOpportunities: latestStatus?.phase21AutonomousBrain?.topAutonomousCandidates || [],
        },
      });
    } catch (err) {
      console.error("/status route failed:", err.message);
      res.json({
        success: true,
        degradedMode: true,
        dashboard: {
          statusWarnings: [err.message],
          marketRegime: state.marketRegime || {},
          autonomousTradingSystem: state.autonomousTradingSystemState || {},
          portfolioGovernor: state.portfolioGovernorState || {},
          topSignals: [
            ...(Array.isArray(state.topStockSignals) ? state.topStockSignals : []),
            ...(Array.isArray(state.lastStockSignals) ? state.lastStockSignals : []),
            ...(Array.isArray(state.topCryptoSignals) ? state.topCryptoSignals : []),
            ...(Array.isArray(state.lastCryptoSignals) ? state.lastCryptoSignals : []),
          ].slice(0, 10).map(mergeLiveQuote),
          topOpportunities: state.topAutonomousCandidates || [],
        },
      });
    }
  });
}
