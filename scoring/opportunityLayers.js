import { evaluateBuyable } from "./analyticalAuthorization.js";
import { STOCK_EXECUTION_THRESHOLDS } from "./decisionScores.js";
import { classifyStockMarketStress, classifyStockScoreBand } from "./stockQualificationPolicy.js";
import { feedEvidenceFinding, spreadQuoteClass } from "../market-data/feedContract.js";
import { settleLayer } from "./evidenceState.js";
import { evaluateEvidencePolicy, STOCK_DECISION_EVIDENCE_POLICY } from "./measuredComponent.js";

// States belong to one layer. A reject on execution does not rewrite F.
// Inside one layer the order is REJECT, RESCORE_REQUIRED, DATA_UNAVAILABLE, WAIT, PASS.

function finiteScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

export function classifyStockNews(signal = {}) {
  const confirmations = signal.confirmations || {};
  const mandatory = signal.requireNewsRiskForEntry === true;
  const evidence = signal.newsEvidence
    || confirmations.newsCatalyst?.newsEvidence
    || signal.newsCatalyst?.newsEvidence;
  if (evidence) {
    const state = evidence.adverseState === "NEGATIVE"
      ? "NEGATIVE_CATALYST"
      : evidence.catalystState === "POSITIVE" || evidence.catalystState === "MAJOR_POSITIVE"
        ? "POSITIVE_CATALYST"
        : evidence.coverageState === "COVERED" && evidence.adverseState === "NONE_FOUND"
          ? "NO_ADVERSE_NEWS"
          : evidence.providerState === "UNAVAILABLE"
            ? "NEWS_UNAVAILABLE"
            : "NEWS_UNAVAILABLE";
    return { state, mandatory, ...evidence };
  }
  let state = "NEWS_UNAVAILABLE";
  if (confirmations.newsRisk === true) state = "NEGATIVE_CATALYST";
  else if (confirmations.positiveCatalyst === true || confirmations.positiveNews === true) state = "POSITIVE_CATALYST";
  else if (confirmations.newsRiskAvailable === true) state = "NO_ADVERSE_NEWS";
  else if (confirmations.hasNews === false || confirmations.newsPresent === false) state = "NO_NEWS";
  return { state, mandatory };
}

function analyticalStrategyReason(signal = {}) {
  if (signal.lateChaseRisk === true || signal.runnerStage === "EXHAUSTION") return "ENTRY_SETUP_EXHAUSTED";
  if (signal.confirmations?.fakeBreakout === true) return "FAKE_BREAKOUT";
  const text = String(signal.buyBlockReason || signal.displayOnlyReason || "");
  if (/spread|stale|quote|news risk|news review|shortlist/i.test(text)) return null;
  if (/RVOL below/i.test(text)) return "RVOL_BELOW_STRATEGY_MINIMUM";
  if (/price below|price above max|volume below|float too high|market cap too high/i.test(text)) {
    return "STRATEGY_WATCH_ONLY";
  }
  if (/no news or strong momentum/i.test(text)) return "DISCOVERY_NEWS_OR_MOMENTUM_REQUIRED";
  return null;
}

function evidenceResolving(signal) {
  return signal.evidenceResolution === "RUNNING"
    || signal.newsReviewStatus === "RUNNING"
    || signal.atrBackfillRequested === true
    || signal.providerRetry === "RUNNING";
}

function evidenceLayer(signal) {
  const news = classifyStockNews(signal);
  const findings = [];
  const resolving = evidenceResolving(signal);
  if (news.mandatory && news.state === "NEGATIVE_CATALYST") {
    findings.push({ state: "REJECT", reason: "NEGATIVE_CATALYST" });
  }
  const historyMissing = signal.extensionEvidence === "UNKNOWN" || signal.discoveryScorecard?.extensionEvidence === "UNKNOWN";
  if (historyMissing) {
    findings.push({
      state: signal.atrBackfillRequested === true ? "WAIT" : "DATA_UNAVAILABLE",
      reason: "INSUFFICIENT_EXTENSION_HISTORY",
    });
  }
  if (signal.evidenceWaitReason === "PRICE_EVIDENCE_UNAVAILABLE") {
    findings.push({
      state: signal.atrBackfillRequested === true ? "WAIT" : "DATA_UNAVAILABLE",
      reason: "PRICE_EVIDENCE_UNAVAILABLE",
    });
  }
  const providerDown = news.providerState === "UNAVAILABLE"
    || news.coverageState === "UNKNOWN"
    || news.coverageState === "NOT_COVERED"
    || news.coverageState === "PARTIAL"
    || signal.newsProviderStatus === "down"
    || signal.newsProviderStatus === "unavailable";
  const newsUnknown = news.mandatory && (
    providerDown
    || news.state === "NEWS_UNAVAILABLE"
    || news.state === "NO_NEWS"
  );
  if (news.mandatory && providerDown) {
    findings.push({
      state: "WAIT",
      reason: news.coverageState === "NOT_COVERED"
        ? "NEWS_NOT_COVERED"
        : news.coverageState === "PARTIAL"
          ? "ARTICLE_TIMESTAMP_MISSING"
          : "NEWS_PROVIDER_UNAVAILABLE",
    });
  } else if (newsUnknown || signal.newsProviderStatus === "down" || signal.newsProviderStatus === "unavailable") {
    findings.push({
      state: signal.newsReviewStatus === "RUNNING" ? "WAIT" : "DATA_UNAVAILABLE",
      reason: signal.newsProviderStatus === "down" || signal.newsProviderStatus === "unavailable"
        ? "NEWS_PROVIDER_UNAVAILABLE"
        : "NEWS_UNKNOWN",
    });
  }
  if (signal.quoteProvenance !== undefined || signal.barProvenance !== undefined || signal.intradayBarProvenance !== undefined) {
    const feed = feedEvidenceFinding({
      quote: signal.quoteProvenance || null,
      intradayBars: signal.intradayBarProvenance || signal.barProvenance || null,
      dailyBars: signal.dailyBarProvenance || null,
    });
    if (feed.state !== "PASS") findings.push({ state: feed.state, reason: feed.reason });
  }
  const basis = signal.evidenceBasis || signal.decisionScoreTelemetry?.stages?.decision?.evidenceBasis || null;
  if (basis) {
    const policy = evaluateEvidencePolicy(basis, STOCK_DECISION_EVIDENCE_POLICY, { newsUnknown });
    for (const reason of policy.reasons) {
      if (reason === "NEWS_UNKNOWN") continue;
      findings.push({ state: resolving ? "WAIT" : "DATA_UNAVAILABLE", reason });
    }
  }
  return { ...settleLayer("EVIDENCE", findings), news };
}

function executionLayer(eligibility, signal = {}) {
  const findings = [];
  const setupBlock = signal.setupState === "EXHAUSTED" || signal.discoveryScorecard?.setupState === "EXHAUSTED"
    ? "EXHAUSTION"
    : signal.setupState === "EXTENDED" || signal.discoveryScorecard?.setupState === "EXTENDED"
      ? "ENTRY_EXTENDED"
      : null;
  if (setupBlock) findings.push({ state: "REJECT", reason: setupBlock });
  if (signal.executionWaitReason === "QUOTE_UNAVAILABLE") {
    findings.push({
      state: signal.providerRetry === "RUNNING" ? "WAIT" : "DATA_UNAVAILABLE",
      reason: "QUOTE_UNAVAILABLE",
    });
  }
  if (!eligibility) {
    if (!findings.length) findings.push({ state: "DATA_UNAVAILABLE", reason: "EXECUTION_EVIDENCE_UNKNOWN" });
    return { ...settleLayer("EXECUTION", findings), quoteAge: null };
  }
  const quoteAge = eligibility.quoteAgeSeconds ?? null;
  if (quoteAge === null) findings.push({ state: "DATA_UNAVAILABLE", reason: "QUOTE_FRESHNESS_UNAVAILABLE" });
  else if (eligibility.quoteSourceApproved !== true) findings.push({ state: "DATA_UNAVAILABLE", reason: "QUOTE_SOURCE_UNAPPROVED" });
  else if (eligibility.quoteFreshnessPass !== true) {
    findings.push({
      state: "WAIT",
      reason: quoteAge < -5 ? "QUOTE_TIMESTAMP_IN_FUTURE" : "QUOTE_STALE",
    });
  }
  const spreadQuality = signal.entryQualityScorecard?.spreadQualityScore ?? signal.spreadQualityScore;
  const spreadSource = signal.entryQualityScorecard?.spreadSource || signal.spreadSource;
  const bookUnread = spreadQuality === null
    || spreadSource === "unavailable"
    || spreadSource === "explicitly_unavailable"
    || signal.bookAvailable === false;
  const spreadClass = signal.quoteProvenance ? spreadQuoteClass(signal.quoteProvenance) : null;
  if (spreadClass && spreadClass.appliesConsolidatedSpreadRule !== true) {
    findings.push({ state: spreadClass.state === "WAIT" ? "WAIT" : "DATA_UNAVAILABLE", reason: spreadClass.reason });
  } else if (eligibility.spreadAvailable !== true) {
    findings.push({
      state: "DATA_UNAVAILABLE",
      reason: bookUnread ? "BOOK_UNAVAILABLE" : "SPREAD_UNAVAILABLE",
    });
  } else if (eligibility.spreadTooWide === true) {
    findings.push({ state: "REJECT", reason: "SPREAD_TOO_WIDE" });
    findings.push({ state: "REJECT", reason: "SPREAD_ABOVE_EXECUTION_LIMIT" });
  } else if (eligibility.spreadAgeSeconds == null || eligibility.spreadSourceApproved !== true) {
    findings.push({
      state: "DATA_UNAVAILABLE",
      reason: eligibility.spreadAgeSeconds == null ? "SPREAD_FRESHNESS_UNAVAILABLE" : "SPREAD_SOURCE_UNAPPROVED",
    });
  } else if (eligibility.spreadFreshnessPass !== true) {
    findings.push({
      state: "WAIT",
      reason: eligibility.spreadAgeSeconds < -5 ? "SPREAD_TIMESTAMP_IN_FUTURE" : "SPREAD_STALE",
    });
  }
  const settled = settleLayer("EXECUTION", findings);
  const notReady = ["QUOTE_STALE", "SPREAD_STALE", "SPREAD_TOO_WIDE", "SPREAD_ABOVE_EXECUTION_LIMIT", "BOOK_UNAVAILABLE", "SIZE_EXCEEDS_USABLE_DEPTH", "CONSOLIDATED_QUOTE_UNAVAILABLE"]
    .filter((reason) => settled.reasons.includes(reason));
  return {
    ...settled,
    state: notReady.length ? "EXECUTION_NOT_READY" : settled.state,
    quoteAge: quoteAge === null ? null : Number(quoteAge),
  };
}

function riskLayer(signal, eligibility, config = {}) {
  const findings = [];
  if (signal.portfolioAction === "REDUCE_RISK" || signal.aiPortfolioAction === "REDUCE_RISK") {
    findings.push({ state: "REJECT", reason: "PORTFOLIO_EXPOSURE_LIMIT" });
  }
  if (signal.dailyLossLocked === true) findings.push({ state: "REJECT", reason: "DAILY_LOSS_LOCK" });
  if (config?.realCashTradingUnlocked === false || signal.realCashTradingUnlocked === false) {
    findings.push({ state: "REJECT", reason: "REAL_CASH_TRADING_LOCKED" });
  }
  if (eligibility?.centralDecisionPass === false) {
    findings.push({ state: "WAIT", reason: "CENTRAL_DECISION_NOT_EXECUTABLE" });
  }
  const marketStress = classifyStockMarketStress({
    marketStress: signal.marketStress ?? signal.marketStressLevel ?? 0,
    crashBlock: signal.crashBlock === true || signal.marketCrashProtectionState?.shouldBlockNewTrades === true,
    macroBlock: signal.macroBlock === true || signal.macroRiskState?.shouldBlockNewTrades === true,
  });
  if (marketStress.R.state === "REJECT") {
    findings.push({ state: "REJECT", reason: marketStress.R.reason || "EXTREME_MARKET_STRESS" });
  } else if (marketStress.R.state === "WAIT") {
    findings.push({ state: "WAIT", reason: marketStress.R.reason || "MARKET_STRESS_WAIT" });
  }
  const riskReasons = new Set();
  if (signal.confirmations?.fakeBreakout === true) riskReasons.add("FAKE_BREAKOUT");
  for (const reason of signal.riskDecision?.state === "REJECT" ? (signal.riskDecision.reasons || []) : []) {
    if (reason) riskReasons.add(reason);
  }
  for (const reason of riskReasons) findings.push({ state: "REJECT", reason });
  const settled = settleLayer("RISK", findings);
  const constrained = marketStress.R.state === "PASS_WITH_CONSTRAINT" && settled.state === "PASS";
  return {
    ...settled,
    state: constrained ? "PASS_WITH_CONSTRAINT" : settled.state,
    marketStress,
    sizeMultiplier: marketStress.S.multiplier,
  };
}

function authorizationLayer(signal = {}) {
  const status = signal.centralReviewStatus || "NONE";
  if (status === "QUEUED" || status === "RUNNING") {
    return settleLayer("AUTHORIZATION", [{ state: "WAIT", reason: "CENTRAL_REVIEW_RUNNING" }]);
  }
  return settleLayer("AUTHORIZATION", []);
}

export function buildStockOpportunityLayers(signal = {}, {
  eligibility = null,
  config = {},
  requiredF = 70,
} = {}) {
  const directF = finiteScore(signal.currentAnalyticalScore ?? signal.stockDecisionScore);
  const F = directF !== null
    ? directF
    : finiteScore(eligibility?.finalScoreAvailable ? eligibility.finalScore : null);
  const D = signal.currentAnalyticalSnapshot
    ? finiteScore(signal.currentAnalyticalSnapshot.components?.discovery?.score)
    : finiteScore(signal.discoveryScore ?? signal.discoveryScorecard?.score);
  const E = finiteScore(signal.entryQualityScore ?? signal.entryQualityScorecard?.score);
  const setupState = signal.setupState || signal.discoveryScorecard?.setupState;
  const setupRestricted = setupState === "EXHAUSTED" || setupState === "EXTENDED";
  const entryApproved = setupRestricted || (
    signal.entryQualityScorecard?.approved === true
    && E !== null
    && E >= STOCK_EXECUTION_THRESHOLDS.entryScore
  );
  const rescore = signal.rescoreStatus === "QUEUED"
    || signal.rescoreStatus === "RUNNING"
    || signal.setupDriftStatus === "RESCORE_REQUIRED";
  const analyticalFindings = [];
  if (rescore) {
    analyticalFindings.push({ state: "RESCORE_REQUIRED", reason: signal.rescoreReason || "SETUP_CHANGED" });
  }
  if (F === null) analyticalFindings.push({ state: "DATA_UNAVAILABLE", reason: "FINAL_SCORE_INVALID" });
  else if (F < requiredF) analyticalFindings.push({ state: "REJECT", reason: "FINAL_SCORE_BELOW_70" });
  if (!entryApproved) {
    analyticalFindings.push({
      state: signal.entryQualityScorecard ? "REJECT" : "DATA_UNAVAILABLE",
      reason: "ENTRY_POLICY_FAILED",
    });
  }
  const strategyReason = analyticalStrategyReason(signal);
  if (strategyReason && strategyReason !== "FAKE_BREAKOUT") {
    analyticalFindings.push({ state: "REJECT", reason: strategyReason });
  }
  const analytical = settleLayer("ANALYTICAL", analyticalFindings);
  const analyticalReasons = analytical.reasons;
  const analyticalPass = analytical.state === "PASS";
  const band = classifyStockScoreBand(F);
  const label = band === "EXCEPTIONAL"
    ? "Exceptional Opportunity"
    : band === "STRONG"
      ? "Strong Opportunity"
      : band === "QUALIFIED"
        ? "Qualified Opportunity"
        : band === "WATCH"
          ? "Watch"
          : "Weak Opportunity";
  return {
    symbol: signal.symbol || null,
    D,
    E,
    F,
    requiredF,
    analyticalPass,
    analyticalReasons,
    analytical,
    analyticalState: analytical.state,
    band,
    scoreIsStale: rescore === true,
    rescoreReason: rescore ? (signal.rescoreReason || "SETUP_CHANGED") : null,
    currentAnalyticalScore: F,
    entryApproved,
    label,
    C: evidenceLayer(signal),
    X: executionLayer(eligibility, signal),
    R: riskLayer(signal, eligibility, config),
    authorization: authorizationLayer(signal),
  };
}

export function finalizeStockOpportunityLayers(layers, amount, scoreState = null) {
  const size = Number(amount);
  const known = Number.isFinite(size);
  const S = known && size > 0
    ? { state: "PASS", amount: Math.floor(size * 100) / 100, reasons: [] }
    : known
      ? { state: "REJECT", amount: 0, reasons: ["POSITION_SIZE_ZERO"] }
      : { state: "DATA_UNAVAILABLE", amount: null, reasons: ["POSITION_SIZE_UNKNOWN"] };
  const authorizationPass = !layers.authorization || layers.authorization.state === "PASS";
  const riskPermits = layers.R.state === "PASS" || layers.R.state === "PASS_WITH_CONSTRAINT";
  const layerBuyable = layers.analyticalPass === true
    && authorizationPass
    && layers.C.state === "PASS"
    && layers.X.state === "PASS"
    && riskPermits
    && S.state === "PASS";
  const decision = scoreState ? evaluateBuyable({
    ...scoreState,
    requiredF: layers.requiredF,
    C: layers.C.state,
    X: layers.X.state,
    R: layers.R.state,
    S: S.state === "PASS" ? S.amount : 0,
    cReason: layers.C.reasons[0] || null,
    xReason: layers.X.reasons[0] || null,
    rReason: layers.R.reasons[0] || null,
    entryApproved: layers.entryApproved === true,
  }) : null;
  const scoredBuyable = decision ? decision.buyable : layerBuyable;
  const buyable = scoredBuyable && layers.analyticalPass === true && authorizationPass;
  const blockedBy = !buyable && layers.analyticalState === "RESCORE_REQUIRED"
    ? "rescore"
    : !buyable && layers.authorization?.state === "WAIT" && scoredBuyable
      ? "authorization"
      : decision
    ? (!decision.currentPass ? "F"
      : !decision.authorizedPass ? "authorization"
      : !decision.entryPass ? "E"
      : !decision.evidencePass ? "C"
      : !decision.executionPass ? "X"
      : !decision.riskPass ? "R"
      : !decision.sizePass ? "S"
      : null)
    : (!layers.analyticalPass
      ? (layers.analyticalState === "RESCORE_REQUIRED" ? "rescore"
        : layers.F !== null && layers.F >= layers.requiredF && layers.entryApproved === false ? "E" : "F")
      : layers.C.state !== "PASS" ? "C"
      : layers.X.state !== "PASS" ? "X"
      : layers.R.state !== "PASS" && layers.R.state !== "PASS_WITH_CONSTRAINT" ? "R"
      : S.state !== "PASS" ? "S"
      : null);
  const blockReason = decision && !decision.buyable
    ? decision.reason
    : blockedBy === "E"
      ? "ENTRY_POLICY_FAILED"
    : blockedBy === "F"
      ? layers.analyticalReasons[0] || "ANALYTICAL_SCORE_FAILED"
      : blockedBy === "C"
        ? layers.C.reasons[0]
        : blockedBy === "X"
          ? layers.X.reasons[0]
          : blockedBy === "R"
            ? layers.R.reasons[0]
            : blockedBy === "S"
              ? S.reasons[0]
              : null;
  return { ...layers, S, buyable, blockedBy, blockReason };
}
