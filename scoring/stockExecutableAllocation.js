import { evaluateStockTradeCandidate, STOCK_EXECUTION_THRESHOLDS } from "./decisionScores.js";
import { getCanonicalFinalScore } from "./canonicalSignalRank.js";
import { calculateDynamicTradeAmount } from "../risk/positionSizing.js";
import { availableBuyingPower } from "../risk/brokerEvidence.js";
import { outstandingOrderNotional } from "../risk/orderRiskReservations.js";

// Fresh F>=70 plus a live 5s stock book can receive a new size. This does not
// inherit an old approval or loosen the 5s / 1% execution window.
export function attachStockExecutableAllocation(signal = {}, {
  now = Date.now(),
  account = {},
  positions = [],
  config = {},
  reservations = {},
  dailyStartEquity,
} = {}) {
  const eligibility = evaluateStockTradeCandidate(signal, {
    requireCentralDecision: true,
    requireFreshDecision: true,
    requireExplicitApproval: false,
    maxQuoteAgeSeconds: STOCK_EXECUTION_THRESHOLDS.maxQuoteAgeSeconds,
    maxSpreadPercent: STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
    now,
  });
  if (config.realCashTradingUnlocked === false) {
    eligibility.approved = false;
    eligibility.reasons = [...(eligibility.reasons || []), "REAL_CASH_TRADING_LOCKED"];
  }
  signal.executionEligibility = eligibility;
  if (!eligibility.approved) {
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
  const finalScore = getCanonicalFinalScore(signal) ?? eligibility.finalScore ?? STOCK_EXECUTION_THRESHOLDS.finalScore;
  const suggested = calculateDynamicTradeAmount({
    account: {
      ...account,
      cash: Math.max(0, Number(account.cash || 0) - reserved),
      buying_power: Math.max(0, Number(account.buying_power ?? account.cash ?? 0) - reserved),
    },
    positions: sizingPositions,
    signalScore: Math.max(STOCK_EXECUTION_THRESHOLDS.finalScore, Number(finalScore) || 0),
    config,
    signal,
    dailyStartEquity: dailyStartEquity || account.last_equity,
    pendingNotional: reserved,
    getExposure: (rows) => rows.reduce((sum, row) => sum + Math.abs(Number(row.market_value || 0)), reserved),
  });
  const bounded = Math.min(
    suggested,
    Math.max(0, availableBuyingPower(account, false) - reserved)
  );
  const minAmount = Number(config.minAutonomousTradeAmount || 25);
  const amount = bounded >= minAmount ? Math.floor(bounded * 100) / 100 : 0;
  if (!signal.decisionUpdatedAt) signal.decisionUpdatedAt = new Date(now).toISOString();
  signal.sizingDecisionUpdatedAt = signal.decisionUpdatedAt;
  signal.finalApprovedTradeAmount = amount;
  signal.finalTradeAmount = amount;
  signal.recommendedTradeAmount = amount;
  signal.displayTradeAmount = amount;
  signal.finalSizingReconciliation = {
    finalTradeAmount: amount,
    finalBlocked: amount <= 0,
    basis: "STOCK_F70_LIVE_QUOTE",
  };
  const executable = amount >= 1;
  Object.assign(signal, {
    approved: executable,
    backendApproved: executable,
    autoTradeApproved: executable,
    qualifiedToBuy: executable,
    buyableNow: executable,
  });
  return signal;
}
