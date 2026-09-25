import { CRYPTO_MAX_ENTRY_SPREAD_PERCENT, resolveCryptoLiquidityEvidence } from "./cryptoScoring.js";
import { dominantState } from "./evidenceState.js";

// Shadow execution economics for one crypto order. This does not feed F.
// The 0.85% quoted-spread gate stays a separate coarse check.
// Published Alpaca crypto spot schedule, effective 2023-03-13:
// https://docs.alpaca.markets/us/docs/crypto-fees
export const ALPACA_CRYPTO_FEE_SCHEDULE = Object.freeze({
  version: "alpaca-crypto-spot-2023-03-13",
  source: "https://docs.alpaca.markets/us/docs/crypto-fees",
  tiers: Object.freeze([
    Object.freeze({ tier: 1, minVolumeUsd: 0, makerPct: 0.15, takerPct: 0.25 }),
    Object.freeze({ tier: 2, minVolumeUsd: 100_000, makerPct: 0.12, takerPct: 0.22 }),
    Object.freeze({ tier: 3, minVolumeUsd: 500_000, makerPct: 0.10, takerPct: 0.20 }),
    Object.freeze({ tier: 4, minVolumeUsd: 1_000_000, makerPct: 0.08, takerPct: 0.18 }),
    Object.freeze({ tier: 5, minVolumeUsd: 10_000_000, makerPct: 0.05, takerPct: 0.15 }),
    Object.freeze({ tier: 6, minVolumeUsd: 25_000_000, makerPct: 0.02, takerPct: 0.13 }),
    Object.freeze({ tier: 7, minVolumeUsd: 50_000_000, makerPct: 0.02, takerPct: 0.12 }),
    Object.freeze({ tier: 8, minVolumeUsd: 100_000_000, makerPct: 0, takerPct: 0.10 }),
  ]),
});

export const CRYPTO_EXECUTION_ECONOMICS_SHADOW = Object.freeze({
  mode: "SHADOW",
  replacesSpreadQualityCurve: true,
  replacesProductionEntry: false,
  replacesFinalScore: false,
});

export const CRYPTO_BOOK_DEPTH_POLICY = Object.freeze({
  maxSlippagePercent: 0.5,
  depthParticipation: 0.1,
  maxBookAgeMs: 5000,
});

export const ALPACA_CRYPTO_EXECUTION_VENUE = "alpaca-us";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, places = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function blankWalk() {
  return { avgFillPrice: null, slippageVsAsk: null, slippageVsBid: null, depthUsedPct: null, approved: false };
}

export function resolveCryptoFee({
  thirtyDayCryptoVolumeUsd = null,
  orderType = "market",
} = {}) {
  const volume = finite(thirtyDayCryptoVolumeUsd);
  const volumeKnown = volume !== null && volume >= 0;
  const selected = volumeKnown
    ? [...ALPACA_CRYPTO_FEE_SCHEDULE.tiers].reverse().find((tier) => volume >= tier.minVolumeUsd)
    : ALPACA_CRYPTO_FEE_SCHEDULE.tiers[0];
  const feeType = String(orderType || "market").toLowerCase() === "limit" ? "MAKER" : "TAKER";
  const feeRate = feeType === "MAKER" ? selected.makerPct : selected.takerPct;
  return {
    feeRate,
    feeType,
    feeTier: selected.tier,
    feeScheduleVersion: ALPACA_CRYPTO_FEE_SCHEDULE.version,
    feeTierBasis: volumeKnown ? "THIRTY_DAY_CRYPTO_VOLUME" : "CONSERVATIVE_TIER_1_VOLUME_UNKNOWN",
    makerFeePct: selected.makerPct,
    takerFeePct: selected.takerPct,
    roundTripFeePct: round(feeRate * 2),
  };
}

export function bookVenueFromLocation(location) {
  if (location === "us") return "alpaca-us";
  if (location === "us-1") return "alpaca-kraken";
  if (location === null || location === undefined || location === "") return null;
  return `alpaca-${location}`;
}

export function evaluateCryptoQuotedSpreadGate(spreadPercent, spreadAvailable = true) {
  const spread = finite(spreadPercent);
  if (spreadAvailable !== true || spread === null || spread < 0) {
    return {
      owner: "EXECUTION",
      state: "DATA_UNAVAILABLE",
      pass: false,
      reason: "QUOTED_SPREAD_UNAVAILABLE",
      quotedSpreadPct: null,
      limitPct: CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    };
  }
  const pass = spread <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT;
  return {
    owner: "EXECUTION",
    state: pass ? "PASS" : "REJECT",
    pass,
    reason: pass ? null : "SPREAD_ABOVE_EXECUTION_LIMIT",
    quotedSpreadPct: round(spread),
    limitPct: CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  };
}

export function buildCryptoLiquidityGate(signal = {}) {
  const evidence = resolveCryptoLiquidityEvidence(signal);
  const measured = evidence.available === true && Number.isFinite(evidence.dollarVolume);
  if (!measured || evidence.dollarVolume <= 0) {
    return {
      name: "LiquidityGate",
      state: "DATA_UNAVAILABLE",
      reason: "MARKET_LIQUIDITY_UNAVAILABLE",
      dollarVolume: measured ? evidence.dollarVolume : null,
      source: evidence.source,
      minimum: evidence.minimum,
      pass: false,
    };
  }
  const pass = evidence.pass === true;
  return {
    name: "LiquidityGate",
    state: pass ? "PASS" : "REJECT",
    reason: pass
      ? null
      : evidence.source === "reported_24h"
        ? "INSUFFICIENT_24H_LIQUIDITY"
        : "INSUFFICIENT_WINDOW_LIQUIDITY",
    dollarVolume: evidence.dollarVolume,
    source: evidence.source,
    minimum: evidence.minimum,
    pass,
  };
}

function parseSide(rows, side) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) return null;
  if (rows.some((level) => !Number.isFinite(level.p) || !Number.isFinite(level.s) || level.p <= 0 || level.s <= 0)) return null;
  if (new Set(rows.map((level) => level.p)).size !== rows.length) return null;
  return [...rows].sort((left, right) => side === "ask" ? left.p - right.p : right.p - left.p);
}

function walkBuy(asks, notional) {
  let left = notional;
  let qty = 0;
  let spent = 0;
  for (const level of asks) {
    const dollars = Math.min(left, level.p * level.s);
    qty += dollars / level.p;
    spent += dollars;
    left -= dollars;
    if (left < 1e-8) break;
  }
  return {
    filled: left <= 1e-6,
    qty,
    avgFillPrice: qty > 0 && left <= 1e-6 ? spent / qty : null,
  };
}

function walkSell(bids, qty) {
  let left = qty;
  let sold = 0;
  let proceeds = 0;
  for (const level of bids) {
    const amount = Math.min(left, level.s);
    proceeds += amount * level.p;
    sold += amount;
    left -= amount;
    if (left < 1e-8) break;
  }
  return {
    filled: left <= 1e-8,
    avgFillPrice: sold > 0 && left <= 1e-8 ? proceeds / sold : null,
  };
}

function capacityWithinSlippage(asks, bids, maxSlippagePercent) {
  const bestAsk = asks[0].p;
  const bestBid = bids[0].p;
  const eligibleAsks = asks.filter((level) => level.p <= bestAsk * (1 + maxSlippagePercent / 100));
  const eligibleBids = bids.filter((level) => level.p >= bestBid * (1 - maxSlippagePercent / 100));
  const sellQty = eligibleBids.reduce((sum, level) => sum + level.s, 0);
  let remainingQty = sellQty;
  let dollars = 0;
  for (const level of eligibleAsks) {
    const qty = Math.min(remainingQty, level.s);
    dollars += qty * level.p;
    remainingQty -= qty;
    if (remainingQty < 1e-8) break;
  }
  const buyDepth = eligibleAsks.reduce((sum, level) => sum + level.p * level.s, 0);
  const sellDepth = eligibleBids.reduce((sum, level) => sum + level.p * level.s, 0);
  return {
    maxNotionalAtAllowedSlippage: round(dollars, 2),
    buyDepth,
    sellDepth,
    eligibleBidQty: sellQty,
    maxNotionalAtAllowedDepth: Math.floor(Math.min(buyDepth, sellDepth) * CRYPTO_BOOK_DEPTH_POLICY.depthParticipation * 100) / 100,
  };
}

function unavailableEconomics(signal, reasons, state, extra = {}) {
  const fee = resolveCryptoFee({
    thirtyDayCryptoVolumeUsd: extra.thirtyDayCryptoVolumeUsd,
    orderType: extra.orderType,
  });
  const reasonList = Array.isArray(reasons) ? reasons : [reasons];
  return {
    name: "cryptoExecutionEconomics",
    ...CRYPTO_EXECUTION_ECONOMICS_SHADOW,
    symbol: signal.symbol || null,
    timestamp: extra.timestamp || null,
    venue: extra.bookVenue || null,
    bookVenue: extra.bookVenue || null,
    executionVenue: extra.executionVenue || ALPACA_CRYPTO_EXECUTION_VENUE,
    intendedNotional: finite(extra.notional),
    quotedSpreadPct: null,
    halfSpreadPct: null,
    bestAsk: null,
    bestBid: null,
    walkedBuyPrice: null,
    buySlippageVsAsk: null,
    walkedSellPrice: null,
    sellSlippageVsBid: null,
    roundTripSpreadCost: null,
    roundTripSlippage: null,
    fees: fee,
    takerFeePct: fee.takerFeePct,
    feeTier: fee.feeTier,
    estimatedRoundTripCost: null,
    estimatedRoundTripCostPct: null,
    maxNotionalAtDepthLimit: null,
    maxNotionalAtAllowedDepth: null,
    maxNotionalAtAllowedSlippage: null,
    depthUtilization: null,
    costCoverage: "NONE",
    buyWalk: blankWalk(),
    sellWalk: {
      avgFillPrice: null,
      slippageVsBid: null,
      depthUsedPct: null,
      approved: false,
    },
    state,
    reasons: reasonList,
  };
}

export function buildCryptoExecutionEconomics(signal = {}, {
  notional = null,
  now = Date.now(),
  orderType = "market",
  executionVenue = ALPACA_CRYPTO_EXECUTION_VENUE,
  thirtyDayCryptoVolumeUsd = signal.thirtyDayCryptoVolumeUsd,
  allowCrossVenue = signal.allowCrossVenue === true,
} = {}) {
  const book = signal.cryptoOrderbook;
  const fee = resolveCryptoFee({ thirtyDayCryptoVolumeUsd, orderType });
  const intended = finite(notional ?? signal.intendedNotional ?? signal.finalApprovedTradeAmount ?? signal.recommendedTradeAmount);
  if (!book || typeof book !== "object") {
    return unavailableEconomics(signal, ["ORDER_BOOK_UNAVAILABLE"], "DATA_UNAVAILABLE", {
      notional: intended,
      executionVenue,
      thirtyDayCryptoVolumeUsd,
      orderType,
      timestamp: new Date(now).toISOString(),
    });
  }
  const bookVenue = bookVenueFromLocation(book.location ?? book.venue);
  const findings = [];
  if (book.source !== "alpaca_crypto_orderbook") findings.push({ state: "DATA_UNAVAILABLE", reason: "ORDER_BOOK_UNAVAILABLE" });
  if (book.symbol && signal.symbol && book.symbol !== signal.symbol) findings.push({ state: "REJECT", reason: "BOOK_SYMBOL_MISMATCH" });
  if (!bookVenue) findings.push({ state: "DATA_UNAVAILABLE", reason: "BOOK_VENUE_UNKNOWN" });
  else if (bookVenue !== executionVenue && allowCrossVenue !== true) findings.push({ state: "REJECT", reason: "BOOK_VENUE_MISMATCH" });
  const age = now - Date.parse(book.updatedAt || "");
  if (!Number.isFinite(age) || age < 0 || age > CRYPTO_BOOK_DEPTH_POLICY.maxBookAgeMs) {
    findings.push({ state: "WAIT", reason: "ORDER_BOOK_STALE" });
  }
  const asks = parseSide(book.asks, "ask");
  const bids = parseSide(book.bids, "bid");
  if (!asks || !bids || bids[0].p > asks[0].p) findings.push({ state: "DATA_UNAVAILABLE", reason: "ORDER_BOOK_INVALID" });
  if (intended === null || intended <= 0) findings.push({ state: "WAIT", reason: "INTENDED_NOTIONAL_UNKNOWN" });

  const bookUsable = asks && bids && bids[0].p <= asks[0].p && !findings.some((item) => (
    item.reason === "ORDER_BOOK_INVALID" || item.reason === "ORDER_BOOK_STALE" || item.reason === "ORDER_BOOK_UNAVAILABLE" || item.reason === "BOOK_VENUE_UNKNOWN"
  ));
  if (!bookUsable || intended === null || intended <= 0) {
    const state = dominantState(findings.map((item) => item.state));
    return unavailableEconomics(signal, findings.map((item) => item.reason), state === "PASS" ? "DATA_UNAVAILABLE" : state, {
      notional: intended,
      bookVenue,
      executionVenue,
      thirtyDayCryptoVolumeUsd,
      orderType,
      timestamp: book.updatedAt || new Date(now).toISOString(),
    });
  }

  const bestAsk = asks[0].p;
  const bestBid = bids[0].p;
  const midpoint = (bestAsk + bestBid) / 2;
  const quotedSpreadPct = midpoint > 0 ? ((bestAsk - bestBid) / midpoint) * 100 : null;
  const roundTripSpreadCost = bestAsk > 0 ? (1 - bestBid / bestAsk) * 100 : null;
  const capacity = capacityWithinSlippage(asks, bids, CRYPTO_BOOK_DEPTH_POLICY.maxSlippagePercent);
  const buy = walkBuy(asks, intended);
  const sell = buy.qty > 0 ? walkSell(bids, buy.qty) : { filled: false, avgFillPrice: null };
  const buySlippage = buy.avgFillPrice !== null && bestAsk > 0 ? (buy.avgFillPrice / bestAsk - 1) * 100 : null;
  const sellSlippage = sell.avgFillPrice !== null && bestBid > 0 ? (1 - sell.avgFillPrice / bestBid) * 100 : null;
  const walkedRoundTrip = buy.avgFillPrice > 0 && sell.avgFillPrice !== null
    ? (1 - sell.avgFillPrice / buy.avgFillPrice) * 100
    : null;
  const roundTripSlippage = walkedRoundTrip !== null && roundTripSpreadCost !== null
    ? walkedRoundTrip - roundTripSpreadCost
    : null;
  const estimatedRoundTripCostPct = walkedRoundTrip !== null ? walkedRoundTrip + fee.roundTripFeePct : null;
  const buyDepthUsed = capacity.buyDepth > 0 ? (intended / capacity.buyDepth) * 100 : null;
  const sellDepthUsed = capacity.sellDepth > 0 && buy.avgFillPrice
    ? ((buy.qty * sell.avgFillPrice) / capacity.sellDepth) * 100
    : null;
  if (!buy.filled || !sell.filled) findings.push({ state: "REJECT", reason: "CRYPTO_INSUFFICIENT_BOOK_DEPTH" });
  if (intended > capacity.maxNotionalAtAllowedDepth) findings.push({ state: "REJECT", reason: "CRYPTO_ORDER_EXCEEDS_DEPTH_PARTICIPATION" });
  if (
    (buySlippage !== null && buySlippage > CRYPTO_BOOK_DEPTH_POLICY.maxSlippagePercent)
    || (sellSlippage !== null && sellSlippage > CRYPTO_BOOK_DEPTH_POLICY.maxSlippagePercent)
  ) findings.push({ state: "REJECT", reason: "CRYPTO_SLIPPAGE_LIMIT" });
  const state = findings.length ? dominantState(findings.map((item) => item.state)) : "PASS";
  const costKnown = estimatedRoundTripCostPct !== null;
  return {
    name: "cryptoExecutionEconomics",
    ...CRYPTO_EXECUTION_ECONOMICS_SHADOW,
    symbol: signal.symbol || book.symbol || null,
    timestamp: book.updatedAt || new Date(now).toISOString(),
    venue: bookVenue,
    bookVenue,
    executionVenue,
    intendedNotional: round(intended, 2),
    quotedSpreadPct: round(quotedSpreadPct),
    halfSpreadPct: round(quotedSpreadPct === null ? null : quotedSpreadPct / 2),
    bestAsk: round(bestAsk, 6),
    bestBid: round(bestBid, 6),
    walkedBuyPrice: round(buy.avgFillPrice, 6),
    buySlippageVsAsk: round(buySlippage),
    walkedSellPrice: round(sell.avgFillPrice, 6),
    sellSlippageVsBid: round(sellSlippage),
    roundTripSpreadCost: round(roundTripSpreadCost),
    roundTripSlippage: round(roundTripSlippage),
    fees: fee,
    takerFeePct: fee.takerFeePct,
    feeTier: fee.feeTier,
    estimatedRoundTripCost: round(estimatedRoundTripCostPct),
    estimatedRoundTripCostPct: round(estimatedRoundTripCostPct),
    maxNotionalAtDepthLimit: capacity.maxNotionalAtAllowedDepth,
    maxNotionalAtAllowedDepth: capacity.maxNotionalAtAllowedDepth,
    maxNotionalAtAllowedSlippage: capacity.maxNotionalAtAllowedSlippage,
    depthUtilization: buyDepthUsed === null && sellDepthUsed === null
      ? null
      : round(Math.max(buyDepthUsed ?? 0, sellDepthUsed ?? 0)),
    costCoverage: costKnown ? "COMPLETE" : "PARTIAL",
    buyWalk: {
      avgFillPrice: round(buy.avgFillPrice, 6),
      slippageVsAsk: round(buySlippage),
      depthUsedPct: round(buyDepthUsed),
      approved: buy.filled && buySlippage !== null && buySlippage <= CRYPTO_BOOK_DEPTH_POLICY.maxSlippagePercent,
    },
    sellWalk: {
      avgFillPrice: round(sell.avgFillPrice, 6),
      slippageVsBid: round(sellSlippage),
      depthUsedPct: round(sellDepthUsed),
      approved: sell.filled && sellSlippage !== null && sellSlippage <= CRYPTO_BOOK_DEPTH_POLICY.maxSlippagePercent,
    },
    state,
    reasons: findings.map((item) => item.reason),
  };
}

export function attachCryptoExecutionShadow(signal = {}, options = {}) {
  const cryptoExecutionEconomics = buildCryptoExecutionEconomics(signal, options);
  const liquidityGate = buildCryptoLiquidityGate(signal);
  signal.cryptoExecutionEconomics = cryptoExecutionEconomics;
  signal.cryptoLiquidityGate = liquidityGate;
  return { cryptoExecutionEconomics, liquidityGate };
}
