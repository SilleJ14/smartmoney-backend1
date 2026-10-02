import { evaluateCryptoTradeCandidate } from "./componentScore.js";
import { getCanonicalFinalScore } from "./canonicalSignalRank.js";
import { calculateDynamicTradeAmount } from "../risk/positionSizing.js";
import { availableBuyingPower } from "../risk/brokerEvidence.js";
import { outstandingOrderNotional } from "../risk/orderRiskReservations.js";

// Measured analytical F plus a valid setup and live Alpaca execution evidence
// can receive a size. There is no inherited legacy F65 threshold.
export function attachCryptoExecutableAllocation(signal = {}, {
  now = Date.now(),
  account = {},
  positions = [],
  config = {},
  reservations = {},
  dailyStartEquity,
} = {}) {
  const preflight = evaluateCryptoTradeCandidate(signal, { now, requireExplicitApproval: false });
  signal.cryptoAnalyticalShadow = preflight.evidence?.cryptoAnalyticalShadow || null;
  signal.currentAnalyticalSnapshot = preflight.evidence?.currentAnalyticalSnapshot || null;
  signal.currentAnalyticalScore = preflight.score;
  signal.cryptoDecisionScore = preflight.score;
  signal.cryptoDecisionScoreAvailable = preflight.score !== null;
  const preSizingReasons = (preflight.reasons || []).filter((reason) =>
    reason !== "INTENDED_NOTIONAL_UNKNOWN"
  );
  if (config.realCashTradingUnlocked === false) {
    preSizingReasons.push("REAL_CASH_TRADING_LOCKED");
  }
  if (preSizingReasons.length > 0) {
    signal.executionEligibility = {
      ...preflight,
      approved: false,
      reasons: [...new Set(preSizingReasons)],
    };
    Object.assign(signal, {
      approved: false,
      backendApproved: false,
      autoTradeApproved: false,
      qualifiedToBuy: false,
      buyableNow: false,
      finalApprovedTradeAmount: 0, finalTradeAmount: 0, recommendedTradeAmount: 0,
    });
    return signal;
  }
  const sizingPositions = Array.isArray(positions) ? positions : [];
  const reserved = Object.values(reservations || {}).reduce(
    (sum, entry) => sum + outstandingOrderNotional(entry, sizingPositions),
    0
  );
  const finalScore = getCanonicalFinalScore(signal);
  const suggested = calculateDynamicTradeAmount({
    account: {
      ...account,
      cash: Math.max(0, Number(account.cash || 0) - reserved),
      buying_power: Math.max(0, Number(account.buying_power ?? account.cash ?? 0) - reserved),
    },
    positions: sizingPositions,
    signalScore: finalScore ?? 0,
    config,
    signal,
    dailyStartEquity: dailyStartEquity || account.last_equity,
    pendingNotional: reserved,
    getExposure: (rows) => rows.reduce((sum, row) => sum + Math.abs(Number(row.market_value || 0)), reserved),
  });
  const cryptoExposure = sizingPositions
    .filter((row) => String(row.asset_class || "").toLowerCase() === "crypto"
      || String(row.symbol || "").includes("/")
      || String(row.symbol || "").endsWith("USD"))
    .reduce((sum, row) => sum + Math.abs(Number(row.market_value || 0)), 0);
  const cryptoBudget = Number(account.equity || 0)
    * Number(config.maxBotExposurePercent || 0) / 100
    * Number(config.cryptoMaxExposureShareOfBotExposure ?? 100) / 100;
  const bounded = Math.min(
    suggested,
    Math.max(0, cryptoBudget - cryptoExposure - reserved),
    Math.max(0, availableBuyingPower(account, true) - reserved)
  );
  const minAmount = Number(config.minCryptoTradeAmount || 25);
  const amount = bounded >= minAmount ? Math.floor(bounded * 100) / 100 : 0;
  if (!signal.decisionUpdatedAt) signal.decisionUpdatedAt = new Date(now).toISOString();
  signal.sizingDecisionUpdatedAt = signal.decisionUpdatedAt;
  signal.finalApprovedTradeAmount = amount;
  signal.finalTradeAmount = amount;
  signal.recommendedTradeAmount = amount;
  signal.displayTradeAmount = amount;
  signal.intendedNotional = amount > 0 ? amount : null;
  signal.finalSizingReconciliation = {
    finalTradeAmount: amount,
    finalBlocked: amount <= 0,
    basis: "CRYPTO_ANALYTICAL_XRS_LIVE_QUOTE",
  };
  const eligibility = amount >= 1
    ? evaluateCryptoTradeCandidate(signal, { now, requireExplicitApproval: false })
    : {
      ...preflight,
      approved: false,
      reasons: [...new Set([...(preflight.reasons || []), "SIZING_BLOCKED"])],
    };
  signal.cryptoAnalyticalShadow = eligibility.evidence?.cryptoAnalyticalShadow || signal.cryptoAnalyticalShadow;
  signal.currentAnalyticalSnapshot = eligibility.evidence?.currentAnalyticalSnapshot || signal.currentAnalyticalSnapshot;
  signal.executionEligibility = eligibility;
  const executable = amount >= 1 && eligibility.approved === true;
  if (!executable) {
    signal.finalApprovedTradeAmount = 0;
    signal.finalTradeAmount = 0;
    signal.recommendedTradeAmount = 0;
    signal.displayTradeAmount = 0;
    signal.intendedNotional = null;
    signal.finalSizingReconciliation.finalTradeAmount = 0;
    signal.finalSizingReconciliation.finalBlocked = true;
  }
  Object.assign(signal, {
    approved: executable,
    backendApproved: executable,
    autoTradeApproved: executable,
    qualifiedToBuy: executable,
    buyableNow: executable,
  });
  return signal;
}
