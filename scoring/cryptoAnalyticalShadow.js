import { evaluateCryptoQuotedSpreadGate } from "./cryptoExecutionEconomics.js";
import { buildCryptoMarketContext, cryptoBreadthRiskAndSize } from "./cryptoContext.js";
import { dominantState } from "./evidenceState.js";
import {
  buildCryptoExecutionEconomics,
  buildCryptoLiquidityGate,
} from "./cryptoExecutionEconomics.js";

// Shadow only. Analytical F is the coin's own measured discovery until a
// separate setup-entry weight is calibrated. Market breadth and execution
// do not change it. Legacy F65 included both, so it is not this threshold.
export const CRYPTO_ANALYTICAL_SCORE = Object.freeze({
  source: "INTRINSIC_DISCOVERY_UNTIL_SETUP_ENTRY",
  includesExecution: false,
  includesMarketBreadth: false,
});

export const CRYPTO_ANALYTICAL_THRESHOLD = Object.freeze({
  problem: 39,
  status: "NOT_CALIBRATED",
  legacyFormulaFinalScore: 65,
  analyticalMinimum: null,
  inheritsLegacyThreshold: false,
});

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function scoreCryptoAnalyticalF({ discovery } = {}) {
  const numeric = discovery?.score === null || discovery?.score === undefined || discovery?.score === ""
    ? null
    : Number(discovery.score);
  const fraction = discovery?.available === true ? Number(discovery.coverage ?? 1) : 0;
  const publishable = Number.isFinite(numeric) && Number.isFinite(fraction) && fraction + 1e-9 >= 0.5;
  return {
    cryptoAnalyticalF: publishable ? round(Math.max(0, Math.min(100, numeric))) : null,
    analyticalCoverage: publishable ? round(Math.max(0, Math.min(1, fraction)), 2) ?? 0 : 0,
  };
}

function marketContextFromSignal(signal = {}, measuredAt = null) {
  if (signal.cryptoMarketContext && signal.cryptoMarketContext.affectsF === false && signal.cryptoMarketContext.state) {
    return signal.cryptoMarketContext;
  }
  const peers = signal.cryptoPeerChanges || signal.cryptoContextScorecard?.peerChanges;
  if (Array.isArray(peers)) return buildCryptoMarketContext({ peerChanges: peers, measuredAt });
  const card = signal.cryptoContextScorecard;
  if (card?.source === "leave_one_out_crypto_market_breadth" && Array.isArray(card.peerChanges)) {
    return buildCryptoMarketContext({ peerChanges: card.peerChanges, measuredAt: card.measuredAt || measuredAt });
  }
  if (card?.source === "leave_one_out_crypto_market_breadth" && card.state) return card;
  return buildCryptoMarketContext({ peerChanges: [], measuredAt });
}

function layer(state, reason) {
  return { state, reason };
}

function quoteLayer(quote = {}, maxQuoteAgeSeconds = 5) {
  const age = quote.ageSeconds;
  if (quote.priceIsLive !== true || quote.sourceApproved !== true || age === null || age === undefined || !Number.isFinite(Number(age))) {
    return layer("DATA_UNAVAILABLE", "QUOTE_UNAVAILABLE");
  }
  if (Number(age) < -5) return layer("WAIT", "QUOTE_TIMESTAMP_IN_FUTURE");
  if (quote.fresh !== true || Number(age) > maxQuoteAgeSeconds) return layer("WAIT", "QUOTE_STALE");
  return layer("PASS", null);
}

function spreadLayer(spread = {}) {
  const gate = evaluateCryptoQuotedSpreadGate(spread.spreadPercent, spread.measured === true);
  if (gate.state !== "PASS") return { ...layer(gate.state, gate.reason), spreadPass: gate.pass, quotedSpread: gate.quotedSpreadPct };
  if (spread.fresh !== true) return { ...layer("WAIT", "SPREAD_STALE"), spreadPass: false, quotedSpread: gate.quotedSpreadPct };
  return { ...layer("PASS", null), spreadPass: true, quotedSpread: gate.quotedSpreadPct };
}

function bookLayer(economics) {
  const reasons = economics?.reasons || [];
  if (!economics || reasons.includes("ORDER_BOOK_UNAVAILABLE")) return layer("DATA_UNAVAILABLE", "ORDER_BOOK_UNAVAILABLE");
  if (reasons.includes("ORDER_BOOK_INVALID") || reasons.includes("BOOK_VENUE_UNKNOWN")) {
    return layer("DATA_UNAVAILABLE", reasons.includes("BOOK_VENUE_UNKNOWN") ? "BOOK_VENUE_UNKNOWN" : "ORDER_BOOK_INVALID");
  }
  if (reasons.includes("ORDER_BOOK_STALE")) return layer("WAIT", "ORDER_BOOK_STALE");
  if (reasons.includes("BOOK_VENUE_MISMATCH")) return layer("REJECT", "BOOK_VENUE_MISMATCH");
  if (reasons.includes("BOOK_SYMBOL_MISMATCH")) return layer("REJECT", "BOOK_SYMBOL_MISMATCH");
  return layer("PASS", null);
}

function sizeLayer(economics, book) {
  if (book.state === "DATA_UNAVAILABLE") return layer("DATA_UNAVAILABLE", book.reason);
  if (book.state === "WAIT") return layer("WAIT", book.reason);
  if (book.state === "REJECT") return layer("REJECT", book.reason);
  const reasons = economics?.reasons || [];
  if (reasons.includes("INTENDED_NOTIONAL_UNKNOWN")) return layer("WAIT", "INTENDED_NOTIONAL_UNKNOWN");
  if (reasons.includes("CRYPTO_INSUFFICIENT_BOOK_DEPTH")) return layer("REJECT", "CRYPTO_INSUFFICIENT_BOOK_DEPTH");
  if (reasons.includes("CRYPTO_ORDER_EXCEEDS_DEPTH_PARTICIPATION")) return layer("REJECT", "SIZE_EXCEEDS_USABLE_DEPTH");
  if (reasons.includes("CRYPTO_SLIPPAGE_LIMIT")) return layer("REJECT", "CRYPTO_SLIPPAGE_LIMIT");
  if (economics?.state === "PASS") return layer("PASS", null);
  return layer(economics?.state || "DATA_UNAVAILABLE", reasons[0] || "SIZE_ECONOMICS_UNKNOWN");
}

function liquidityLayer(gate) {
  if (!gate || gate.state === "DATA_UNAVAILABLE") return layer("DATA_UNAVAILABLE", gate?.reason || "MARKET_LIQUIDITY_UNAVAILABLE");
  if (gate.state === "REJECT") return layer("REJECT", gate.reason);
  if (gate.state === "PASS") return layer("PASS", null);
  return layer(gate.state, gate.reason || null);
}

export function buildCryptoAnalyticalShadow({
  signal = {},
  now = Date.now(),
  legacyCryptoF = null,
  legacyCoverage = null,
  discovery = {},
  quote = {},
  spread = {},
  notional = null,
  maxQuoteAgeSeconds = 5,
  runnerWeight = 0,
} = {}) {
  const analytical = scoreCryptoAnalyticalF({ discovery });
  const cryptoMarketContext = marketContextFromSignal(signal, new Date(now).toISOString());
  const regime = cryptoBreadthRiskAndSize(cryptoMarketContext);
  const C = { owner: "EVIDENCE", state: "PASS", reason: null, usesMarketBreadth: false };
  const economics = buildCryptoExecutionEconomics(signal, { notional, now, orderType: "market" });
  const liquidity = buildCryptoLiquidityGate(signal);
  const quoteState = quoteLayer(quote, maxQuoteAgeSeconds);
  const spreadState = spreadLayer(spread);
  const bookState = bookLayer(economics);
  const sizeEconomicsState = sizeLayer(economics, bookState);
  const liquidityState = liquidityLayer(liquidity);
  const parts = [quoteState, spreadState, bookState, liquidityState, sizeEconomicsState];
  const X = {
    state: dominantState(parts.map((part) => part.state)),
    reasons: parts.map((part) => part.reason).filter(Boolean),
    quoteState,
    spreadState,
    bookState,
    liquidityState,
    sizeEconomicsState,
  };
  const cryptoAnalyticalF = analytical.cryptoAnalyticalF;
  return {
    mode: "LIVE",
    stage: 1,
    replacesCanonicalF: true,
    productionEffect: true,
    legacyCryptoF: legacyCryptoF === null || legacyCryptoF === undefined || !Number.isFinite(Number(legacyCryptoF))
      ? null
      : round(Number(legacyCryptoF)),
    legacyCoverage: legacyCoverage === null || legacyCoverage === undefined ? null : round(Number(legacyCoverage), 4),
    cryptoAnalyticalF,
    analyticalCoverage: analytical.analyticalCoverage,
    scoreSource: CRYPTO_ANALYTICAL_SCORE,
    threshold: CRYPTO_ANALYTICAL_THRESHOLD,
    runnerWeight,
    C,
    cryptoMarketContext,
    R: regime.R,
    S: regime.S,
    X,
    buyable: X.state === "PASS"
      && Number.isFinite(cryptoAnalyticalF)
      && (regime.R.state === "PASS" || regime.R.state === "PASS_WITH_CONSTRAINT")
      && Number(regime.S.regimeMultiplier) > 0,
    executionEconomics: economics,
    liquidityGate: liquidity,
  };
}

// Live crypto permission. Analytical F is discovery only. Execution, breadth,
// and size gate the order. The legacy 65 line is not this gate.
export function liveCryptoPermission(shadow) {
  if (!shadow) {
    return { allowed: false, score: null, reasons: ["CRYPTO_ANALYTICAL_DECISION_MISSING"], inheritsLegacyThreshold: false };
  }
  const reasons = [];
  const score = Number(shadow.cryptoAnalyticalF);
  const scoreKnown = Number.isFinite(score);
  if (!scoreKnown) reasons.push("ANALYTICAL_F_UNAVAILABLE");
  if (shadow.X?.state !== "PASS") {
    const executionReasons = Array.isArray(shadow.X?.reasons) ? shadow.X.reasons.filter(Boolean) : [];
    reasons.push(...(executionReasons.length ? executionReasons : ["EXECUTION_NOT_READY"]));
  }
  if (shadow.R?.state !== "PASS" && shadow.R?.state !== "PASS_WITH_CONSTRAINT") {
    reasons.push(shadow.R?.reason || "RISK_NOT_PASS");
  }
  if (!(Number(shadow.S?.regimeMultiplier) > 0)) reasons.push("SIZE_NOT_APPROVED");
  return {
    allowed: reasons.length === 0,
    score: scoreKnown ? score : null,
    reasons: [...new Set(reasons)],
    inheritsLegacyThreshold: false,
  };
}
