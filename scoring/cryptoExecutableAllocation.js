import { evaluateCryptoTradeCandidate } from "./componentScore.js";
import { getCanonicalFinalScore } from "./canonicalSignalRank.js";
import { calculateDynamicTradeAmount } from "../risk/positionSizing.js";
import { availableBuyingPower } from "../risk/brokerEvidence.js";
import { outstandingOrderNotional } from "../risk/orderRiskReservations.js";

// Fresh F>=65 plus a live Alpaca book can receive a new size. This does not
// inherit an old approval, loosen 5s, or accept a non-Alpaca buy quote.
export function attachCryptoExecutableAllocation(signal = {}, {
  now = Date.now(),
  account = {},
  positions = [],
  config = {},
  reservations = {},
  dailyStartEquity,
} = {}) {
  const eligibility = evaluateCryptoTradeCandidate(signal, { now });
  signal.executionEligibility = eligibility;
  if (!eligibility.approved) {
    Object.assign(signal, {
      approved: false,
      backendApproved: false,
      autoTradeApproved: false,
      qualifiedToBuy: false,
      buyableNow: false,
    });
    return signal;
  }
  const sizingPositions = Array.isArray(positions) ? positions : [];
  const reserved = Object.values(reservations || {}).reduce(
    (sum, entry) => sum + outstandingOrderNotional(entry, sizingPositions),
    0
  );
  const finalScore = getCanonicalFinalScore(signal) ?? eligibility.score;
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
  signal.finalSizingReconciliation = {
    finalTradeAmount: amount,
    finalBlocked: amount <= 0,
    basis: "CRYPTO_F65_LIVE_QUOTE",
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
