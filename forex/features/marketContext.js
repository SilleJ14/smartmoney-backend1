import { featureResult, finite, pairCurrencies, unavailable } from "./core.js";

export function analyzeFuturesConfirmation({ spotDirection, current, previous, asOf, now, maxDelayMinutes = 20 } = {}) {
  const missing = [];
  if (!["up", "down", "flat"].includes(spotDirection)) missing.push("spotDirection");
  for (const field of ["price", "volume", "openInterest"]) {
    if (!finite(current?.[field])) missing.push(`current.${field}`);
    if (!finite(previous?.[field])) missing.push(`previous.${field}`);
  }
  const observedAt = Date.parse(asOf);
  const evaluatedAt = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(observedAt)) missing.push("asOf");
  if (!Number.isFinite(evaluatedAt)) missing.push("now");
  if (missing.length) return unavailable(missing, ["MISSING_FUTURES_EVIDENCE"]);
  const delayMinutes = Math.max(0, (evaluatedAt - observedAt) / 60000);
  const priceDirection = current.price === previous.price ? "flat" : current.price > previous.price ? "up" : "down";
  const volumeChange = previous.volume === 0 ? null : current.volume / previous.volume - 1;
  const openInterestChange = previous.openInterest === 0 ? null : current.openInterest / previous.openInterest - 1;
  const directionConfirmed = spotDirection === "flat" ? priceDirection === "flat" : priceDirection === spotDirection;
  const participationConfirmed = volumeChange !== null && openInterestChange !== null &&
    volumeChange > 0 && openInterestChange > 0;
  const delayed = delayMinutes > maxDelayMinutes;
  return featureResult({
    state: delayed ? "delayed" : "available",
    evidence: {
      delayed, delayMinutes, priceDirection, volumeChange, openInterestChange,
      directionConfirmed, participationConfirmed,
      confirmed: directionConfirmed && participationConfirmed,
    },
    reasons: [
      ...(delayed ? ["DELAYED_CME_DATA"] : []),
      ...(volumeChange === null || openInterestChange === null ? ["ZERO_COMPARISON_BASE"] : []),
    ],
  });
}

export function analyzeCrossMarket(markets) {
  if (!Array.isArray(markets) || !markets.length) return unavailable(["markets"], ["NO_CROSS_MARKET_DATA"]);
  const evidence = {};
  let malformed = 0;
  for (const market of markets) {
    if (typeof market?.id !== "string" || !finite(market.value) || !finite(market.previous)) {
      malformed += 1;
      continue;
    }
    evidence[market.id] = {
      value: market.value,
      previous: market.previous,
      change: market.previous === 0 ? null : market.value / market.previous - 1,
      direction: market.value === market.previous ? "flat" : market.value > market.previous ? "up" : "down",
    };
  }
  if (!Object.keys(evidence).length) return unavailable(["validMarkets"], ["NO_VALID_CROSS_MARKET_DATA"]);
  return featureResult({
    evidence,
    reasons: [
      ...(malformed ? ["MALFORMED_MARKETS_IGNORED"] : []),
      ...(Object.values(evidence).some((item) => item.change === null) ? ["ZERO_COMPARISON_BASE"] : []),
    ],
  });
}

function localMinutes(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { minutes: Number(values.hour) * 60 + Number(values.minute), weekday: values.weekday };
}

export function analyzeTradingSessions(timestamp) {
  const at = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(at)) return unavailable(["timestamp"], ["INVALID_TIMESTAMP"]);
  const definitions = {
    asia: { zone: "Asia/Tokyo", open: 8 * 60, close: 17 * 60 },
    london: { zone: "Europe/London", open: 8 * 60, close: 17 * 60 },
    newYork: { zone: "America/New_York", open: 8 * 60, close: 17 * 60 },
  };
  const sessions = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const local = localMinutes(at, definition.zone);
    sessions[name] = {
      open: !["Sat", "Sun"].includes(local.weekday) &&
        local.minutes >= definition.open && local.minutes < definition.close,
      localMinutes: local.minutes,
      timeZone: definition.zone,
    };
  }
  const active = Object.entries(sessions).filter(([, value]) => value.open).map(([name]) => name);
  return featureResult({
    evidence: {
      timestamp: new Date(at).toISOString(),
      sessions,
      active,
      overlap: active.length > 1,
      overlapSessions: active.length > 1 ? active : [],
    },
  });
}

export function analyzeLiquidity({
  bid, ask, bidSize, askSize, depthBid, depthAsk, quoteAgeMs,
  intendedSize = 0, maxSpreadBps = 3, minQuoteSize = 1, minDepth = 1, maxQuoteAgeMs = 2000,
} = {}) {
  const required = { bid, ask, bidSize, askSize, quoteAgeMs };
  const missing = Object.entries(required).filter(([, value]) => !finite(value)).map(([key]) => key);
  if (missing.length) return unavailable(missing, ["MISSING_LIQUIDITY_EVIDENCE"]);
  if (bid <= 0 || ask <= 0 || ask < bid || [bidSize, askSize, quoteAgeMs, intendedSize].some((value) => !finite(value) || value < 0)
    || (depthBid !== null && depthBid !== undefined && (!finite(depthBid) || depthBid < 0))
    || (depthAsk !== null && depthAsk !== undefined && (!finite(depthAsk) || depthAsk < 0))) {
    return unavailable(["validLiquidityValues"], ["MALFORMED_LIQUIDITY_EVIDENCE"]);
  }
  const midpoint = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / midpoint) * 10000;
  const quoteLiquidity = Math.min(bidSize, askSize);
  const depthAvailable = finite(depthBid) && finite(depthAsk);
  const depth = depthAvailable ? Math.min(depthBid, depthAsk) : null;
  const fresh = quoteAgeMs <= maxQuoteAgeMs;
  const intendedSizeCovered = quoteLiquidity >= Math.max(minQuoteSize, intendedSize);
  // True L2 depth is an independent diagnostic. Low-cost OANDA pricing can
  // authorize against measured top-of-book liquidity without pretending that
  // institutional depth exists.
  const depthAdequate = depthAvailable ? depth >= minDepth : null;
  const tradeable = spreadBps <= maxSpreadBps && intendedSizeCovered && fresh;
  const reasons = [];
  if (spreadBps > maxSpreadBps) reasons.push("SPREAD_TOO_WIDE");
  if (!intendedSizeCovered) reasons.push("QUOTE_LIQUIDITY_TOO_LOW");
  if (depthAvailable && !depthAdequate) reasons.push("DEPTH_TOO_LOW");
  if (!depthAvailable) reasons.push("UNAVAILABLE_PROVIDER_TIER");
  if (!fresh) reasons.push("STALE_QUOTE");
  return featureResult({
    evidence: {
      tradeable, spreadBps, quoteLiquidity, intendedSize, intendedSizeCovered,
      depth, depthAvailable, depthAdequate, quoteAgeMs, fresh,
    },
    reasons,
  });
}

export function analyzeOrderFlow({ bidDepth, askDepth, buyVolume, sellVolume, providerTier } = {}) {
  if (providerTier !== "INSTITUTIONAL_L2" ||
      ![bidDepth, askDepth, buyVolume, sellVolume].every(finite)) {
    return unavailable(
      ["institutionalBidDepth", "institutionalAskDepth", "aggressorBuyVolume", "aggressorSellVolume"],
      ["UNAVAILABLE_PROVIDER_TIER"]
    );
  }
  if ([bidDepth, askDepth, buyVolume, sellVolume].some(value => value < 0) ||
      bidDepth + askDepth === 0 || buyVolume + sellVolume === 0) {
    return unavailable(["validOrderFlow"], ["MALFORMED_ORDER_FLOW_EVIDENCE"]);
  }
  return featureResult({
    evidence: {
      depthImbalance: (bidDepth - askDepth) / (bidDepth + askDepth),
      aggressorImbalance: (buyVolume - sellVolume) / (buyVolume + sellVolume),
      bidDepth,
      askDepth,
      buyVolume,
      sellVolume,
      providerTier,
    },
  });
}

export function selectStrongWeakPair({ strengths, allowedPairs, liquidity = {} } = {}) {
  if (!strengths || typeof strengths !== "object") return unavailable(["strengths"], ["MISSING_STRENGTHS"]);
  if (!Array.isArray(allowedPairs) || !allowedPairs.length) return unavailable(["allowedPairs"], ["NO_ALLOWED_PAIRS"]);
  const candidates = [];
  for (const symbol of allowedPairs) {
    const pair = pairCurrencies(symbol);
    if (!pair || !finite(strengths[pair[0]]) || !finite(strengths[pair[1]])) continue;
    const key = `${pair[0]}${pair[1]}`;
    if (liquidity[key]?.tradeable === false || liquidity[symbol]?.tradeable === false) continue;
    const difference = strengths[pair[0]] - strengths[pair[1]];
    candidates.push({
      pair: key,
      direction: difference >= 0 ? "long" : "short",
      strong: difference >= 0 ? pair[0] : pair[1],
      weak: difference >= 0 ? pair[1] : pair[0],
      strengthDifference: Math.abs(difference),
    });
  }
  if (!candidates.length) return unavailable(["eligiblePairs"], ["NO_ELIGIBLE_STRONG_WEAK_PAIR"]);
  candidates.sort((a, b) => b.strengthDifference - a.strengthDifference || a.pair.localeCompare(b.pair));
  return featureResult({ evidence: { selected: candidates[0], candidates } });
}
