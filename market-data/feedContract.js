// Problem #28 / #44. A measurement may be combined only with another
// measurement of the same market population. Missing provenance is not usable.

export const FEED_VERSION = Object.freeze({
  TRADIER_CONSOLIDATED: "tradier-consolidated-v1",
  MASSIVE_CONSOLIDATED: "massive-consolidated-v1",
  ALPACA_IEX: "alpaca-iex-v1",
  ALPACA_SIP: "alpaca-sip-v1",
});

function clean(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function stockFeedProvenance({
  provider = null,
  feed = null,
  measuredAt = null,
  timeframe = null,
} = {}) {
  const rawProvider = clean(provider);
  const rawFeed = clean(feed);
  if (!rawProvider || !rawFeed) {
    return {
      provider: rawProvider,
      feed: rawFeed,
      isConsolidated: false,
      volumeScope: null,
      timeframe: clean(timeframe),
      measuredAt: clean(measuredAt),
      feedVersion: null,
      state: "DATA_UNAVAILABLE",
      usable: false,
      reason: "FEED_PROVENANCE_MISSING",
    };
  }
  const name = rawProvider.toUpperCase();
  const tape = rawFeed.toUpperCase();
  const providerName = name === "POLYGON" ? "MASSIVE" : name === "TRADIER" ? "TRADIER" : name === "ALPACA" ? "ALPACA" : name;
  const consolidated = providerName === "TRADIER"
    || providerName === "MASSIVE"
    || tape === "CONSOLIDATED"
    || tape === "SIP";
  const iex = providerName === "ALPACA" && (tape === "IEX" || tape === "IEX_ONLY");
  const sip = providerName === "ALPACA" && tape === "SIP";
  if (!consolidated && !iex && !sip) {
    return {
      provider: providerName,
      feed: tape,
      isConsolidated: false,
      volumeScope: null,
      timeframe: clean(timeframe),
      measuredAt: clean(measuredAt),
      feedVersion: null,
      state: "DATA_UNAVAILABLE",
      usable: false,
      reason: "FEED_PROVENANCE_MISSING",
    };
  }
  const feedName = iex ? "IEX" : "CONSOLIDATED";
  return {
    provider: providerName,
    feed: feedName,
    isConsolidated: !iex,
    volumeScope: iex ? "IEX_ONLY" : "CONSOLIDATED",
    timeframe: clean(timeframe),
    measuredAt: clean(measuredAt),
    feedVersion: providerName === "TRADIER"
      ? FEED_VERSION.TRADIER_CONSOLIDATED
      : providerName === "MASSIVE"
        ? FEED_VERSION.MASSIVE_CONSOLIDATED
        : iex
          ? FEED_VERSION.ALPACA_IEX
          : FEED_VERSION.ALPACA_SIP,
    state: "PASS",
    usable: true,
    reason: null,
  };
}

export function sameVolumeScope(left, right) {
  if (!left?.usable || !right?.usable) return false;
  if (!left.volumeScope || !right.volumeScope) return false;
  return left.volumeScope === right.volumeScope;
}

export function scopedRelativeVolume({
  currentVolume = null,
  currentProvenance = null,
  baselineVolume = null,
  baselineProvenance = null,
} = {}) {
  if (!sameVolumeScope(currentProvenance, baselineProvenance)) {
    return { value: null, state: "DATA_UNAVAILABLE", reason: "FEED_SCOPE_MISMATCH" };
  }
  const current = Number(currentVolume);
  const baseline = Number(baselineVolume);
  if (!(current >= 0) || !(baseline > 0)) {
    return { value: null, state: "DATA_UNAVAILABLE", reason: "VOLUME_UNAVAILABLE" };
  }
  return {
    value: Number((current / baseline).toFixed(4)),
    state: "PASS",
    reason: null,
    volumeScope: currentProvenance.volumeScope,
    rule: currentProvenance.volumeScope === "IEX_ONLY" ? "IEX_RVOL" : "FULL_MARKET_RVOL",
  };
}

export function breakoutFeedState({ priceProvenance = null, highProvenance = null } = {}) {
  if (!priceProvenance?.usable || !highProvenance?.usable) {
    return { state: "DATA_UNAVAILABLE", reason: "FEED_PROVENANCE_MISSING", comparable: false };
  }
  if (!sameVolumeScope(priceProvenance, highProvenance) || priceProvenance.volumeScope === "IEX_ONLY") {
    return {
      state: "DEGRADED_FEED",
      reason: priceProvenance.volumeScope === "IEX_ONLY" && highProvenance.volumeScope === "IEX_ONLY"
        ? "IEX_HIGH"
        : "CROSS_FEED_BREAKOUT",
      comparable: false,
    };
  }
  return { state: "PASS", reason: null, comparable: true, rule: "FULL_MARKET_BREAKOUT" };
}

export function spreadQuoteClass(provenance) {
  if (!provenance?.usable) {
    return { source: null, state: "DATA_UNAVAILABLE", reason: "FEED_PROVENANCE_MISSING", appliesConsolidatedSpreadRule: false };
  }
  if (provenance.isConsolidated !== true) {
    return {
      source: "IEX_QUOTE",
      state: "WAIT",
      reason: "CONSOLIDATED_QUOTE_UNAVAILABLE",
      appliesConsolidatedSpreadRule: false,
    };
  }
  return {
    source: "CONSOLIDATED_LIVE_QUOTE",
    state: "PASS",
    reason: null,
    appliesConsolidatedSpreadRule: true,
  };
}

export function marketDataQuality({ quote = null, intradayBars = null, dailyBars = null } = {}) {
  const parts = [quote, intradayBars, dailyBars].filter(Boolean);
  if (!parts.length || parts.some((part) => part.usable !== true)) {
    return { state: "DATA_UNAVAILABLE", reason: "FEED_PROVENANCE_MISSING" };
  }
  const scopes = new Set(parts.map((part) => part.volumeScope));
  if (scopes.size === 1 && scopes.has("CONSOLIDATED")) return { state: "FULL_CONSOLIDATED", reason: null };
  if (scopes.size === 1 && scopes.has("IEX_ONLY")) return { state: "SINGLE_EXCHANGE", reason: "IEX_ONLY" };
  return { state: "SINGLE_EXCHANGE", reason: "MIXED_FEED" };
}

export function feedEvidenceFinding({ quote = null, intradayBars = null, dailyBars = null } = {}) {
  if (!quote && !intradayBars && !dailyBars) {
    return { state: "DATA_UNAVAILABLE", reason: "FEED_PROVENANCE_MISSING" };
  }
  const quality = marketDataQuality({ quote, intradayBars, dailyBars });
  if (quality.state === "DATA_UNAVAILABLE") return { state: "DATA_UNAVAILABLE", reason: quality.reason };
  if (intradayBars?.volumeScope === "IEX_ONLY" || dailyBars?.volumeScope === "IEX_ONLY") {
    return { state: "WAIT", reason: "CONSOLIDATED_BAR_HISTORY_REQUIRED" };
  }
  if (quote?.isConsolidated !== true) {
    return { state: "WAIT", reason: "CONSOLIDATED_QUOTE_UNAVAILABLE" };
  }
  return { state: "PASS", reason: null, quality };
}
