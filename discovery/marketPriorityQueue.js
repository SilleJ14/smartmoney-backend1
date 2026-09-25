// Massive finds the market. Tradier validates the live quote. Deep D/E/F
// runs only on the head of this queue. A fixed shortlist is not the capacity.

import { selectSubscriptionSymbols } from "./evidencePriority.js";

const LANES = Object.freeze({
  OPEN_POSITION: "OPEN_POSITION",
  AUTHORIZED_NEAR_BUY: "AUTHORIZED_NEAR_BUY",
  NEW_MOVER: "NEW_MOVER",
  WATCHLIST: "WATCHLIST",
  EXPLORATION: "EXPLORATION",
});

const DISCOVERY_LANES = new Set([LANES.NEW_MOVER, LANES.WATCHLIST]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function symbolOf(value) {
  return String(value?.symbol || value || "").trim().toUpperCase();
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(1));
}

function cheapMoverStrength(row = {}) {
  const move = Math.abs(finite(row.percentChange) || 0);
  const volume = Math.max(0, finite(row.volume) || 0);
  return Math.min(40, move * 5) + Math.min(20, volume > 0 ? Math.log10(volume) * 4 : 0);
}

function waitingBonus(waitMs) {
  return Math.min(600, Math.max(0, waitMs) / 1000);
}

export function sampleExplorationCandidates(rows = [], cheapSymbols = [], limit = 24) {
  const cheap = new Set(cheapSymbols.map(symbolOf).filter(Boolean));
  const liquid = rows.filter((row) => {
    const symbol = symbolOf(row);
    return symbol && !cheap.has(symbol) && (finite(row.volume) || 0) >= 50000 && (finite(row.price) || 0) > 0;
  });
  const stride = Math.max(1, Math.floor(liquid.length / Math.max(1, limit)));
  const sample = [];
  for (let index = 0; index < liquid.length && sample.length < limit; index += stride) sample.push(liquid[index]);
  return sample;
}

export function createMarketPriorityQueue({ workerCapacity = 4, streamCapacity = 120 } = {}) {
  let lastCheap = [];
  let lastExploration = [];
  const candidates = new Map();
  const waitSamples = [];
  const durationSamples = [];
  const latencySamples = [];
  const completedAt = [];
  let jobsExpired = 0;
  let seenCheap = new Set();

  function ensure(symbol, now) {
    const current = candidates.get(symbol);
    if (current) return current;
    const created = {
      symbol,
      cheapDiscoveryScore: 0,
      priority: 0,
      firstSeenAt: new Date(now).toISOString(),
      queueEnteredAt: now,
      lastDeepScoreAt: null,
      scoreVelocity: 0,
      moveVelocity: 0,
      volumeVelocity: 0,
      tradierSubscribed: false,
      tradierSubscribedAt: null,
      waitingBonus: 0,
      subscriptionPriority: 0,
      priorityReason: "WORKER_CAPACITY",
      lane: LANES.NEW_MOVER,
      status: "DEEP_SCORE_PENDING",
      percentChange: null,
      volume: null,
      discoveryStrength: 0,
      catalystBonus: 0,
      nearBuyGateBonus: 0,
      lastMoveAt: null,
      lastPercent: null,
      lastVolume: null,
      lastScore: null,
      tradier: null,
      providerLatencyMs: null,
    };
    candidates.set(symbol, created);
    return created;
  }

  function recompute(row, now) {
    const waitFrom = row.lastDeepScoreAt ? Date.parse(row.lastDeepScoreAt) : row.queueEnteredAt;
    const waitMs = Math.max(0, now - (Number.isFinite(waitFrom) ? waitFrom : now));
    const priceAcceleration = Math.max(0, row.moveVelocity) * 20;
    const volumeAcceleration = Math.max(0, row.volumeVelocity) * 10;
    const aged = waitingBonus(waitMs);
    row.waitingBonus = aged;
    row.cheapDiscoveryScore = Number(cheapMoverStrength(row).toFixed(2));
    row.subscriptionPriority = Number((
      row.cheapDiscoveryScore
      + (finite(row.discoveryStrength) || 0)
      + priceAcceleration
      + volumeAcceleration
      + (finite(row.catalystBonus) || 0)
      + (finite(row.nearBuyGateBonus) || 0)
    ).toFixed(2));
    row.priority = Number((row.subscriptionPriority + aged).toFixed(2));
    if (row.moveVelocity > 0.15) row.priorityReason = "ACCELERATING";
    else if (waitMs >= 15000 && row.lane !== LANES.EXPLORATION) row.priorityReason = "AGING";
    else if (!row.tradierSubscribed && DISCOVERY_LANES.has(row.lane)) row.priorityReason = "STREAM_CAPACITY";
    else if (row.lane === LANES.OPEN_POSITION) row.priorityReason = "OPEN_POSITION_MONITOR";
    else if (row.lane === LANES.AUTHORIZED_NEAR_BUY) row.priorityReason = "NEAR_BUY_MONITOR";
    else if (row.lane === LANES.EXPLORATION) row.priorityReason = "EXPLORATION";
    else row.priorityReason = "WORKER_CAPACITY";
    return row;
  }

  function noteMeasurement(row, patch, now) {
    const percent = finite(patch.percentChange);
    const volume = finite(patch.volume);
    const score = finite(patch.discoveryScore ?? patch.cheapDiscoveryScore);
    const previousAt = Date.parse(row.lastMoveAt || "") || row.queueEnteredAt;
    const minutes = Math.max(1 / 60, (now - previousAt) / 60000);
    if (percent !== null && row.lastPercent !== null) row.moveVelocity = (percent - row.lastPercent) / minutes;
    if (volume !== null && row.lastVolume !== null && row.lastVolume > 0) {
      row.volumeVelocity = ((volume - row.lastVolume) / row.lastVolume) / minutes;
    }
    if (score !== null && row.lastScore !== null) {
      row.scoreVelocity = patch.scoreChangeCause === "EVIDENCE_LOST" ? 0 : (score - row.lastScore) / minutes;
    }
    if (percent !== null) row.lastPercent = percent;
    if (volume !== null) row.lastVolume = volume;
    if (score !== null) row.lastScore = score;
    if (percent !== null) row.percentChange = percent;
    if (volume !== null) row.volume = volume;
    if (score !== null) row.discoveryStrength = Math.min(30, Math.max(0, score) * 0.3);
    row.lastMoveAt = new Date(now).toISOString();
    if (patch.catalyst === true) row.catalystBonus = 15;
    if (patch.nearBuy === true) row.nearBuyGateBonus = 25;
    recompute(row, now);
  }

  function sync({
    cheapMovers = [],
    exploration = [],
    openPositionSymbols = [],
    nearBuySymbols = [],
    watchlistSymbols = [],
    now = Date.now(),
  } = {}) {
    lastCheap = cheapMovers;
    lastExploration = exploration;
    const open = new Set(openPositionSymbols.map(symbolOf).filter(Boolean));
    const near = new Set(nearBuySymbols.map(symbolOf).filter(Boolean));
    const watch = new Set(watchlistSymbols.map(symbolOf).filter(Boolean));
    const cheapSymbols = new Set();
    for (const mover of cheapMovers) {
      const symbol = symbolOf(mover);
      if (!symbol || open.has(symbol)) continue;
      cheapSymbols.add(symbol);
      const row = ensure(symbol, now);
      if (!seenCheap.has(symbol)) {
        seenCheap.add(symbol);
        row.queueEnteredAt = now;
        row.firstSeenAt = new Date(now).toISOString();
      }
      row.lane = watch.has(symbol) && Math.abs(finite(mover.percentChange) || 0) < 0.25
        ? LANES.WATCHLIST
        : near.has(symbol) ? LANES.AUTHORIZED_NEAR_BUY : LANES.NEW_MOVER;
      if (row.lane === LANES.NEW_MOVER || row.lane === LANES.WATCHLIST) {
        if (row.status !== "DEEP_SCORE_RUNNING") row.status = "DEEP_SCORE_PENDING";
      }
      noteMeasurement(row, mover, now);
    }
    for (const symbol of open) {
      const row = ensure(symbol, now);
      row.lane = LANES.OPEN_POSITION;
      row.status = "MONITORING";
      recompute(row, now);
    }
    for (const symbol of near) {
      if (open.has(symbol) || cheapSymbols.has(symbol)) continue;
      const row = ensure(symbol, now);
      row.lane = LANES.AUTHORIZED_NEAR_BUY;
      row.status = "MONITORING";
      row.nearBuyGateBonus = 25;
      recompute(row, now);
    }
    for (const symbol of watch) {
      if (open.has(symbol) || near.has(symbol) || cheapSymbols.has(symbol)) continue;
      const row = ensure(symbol, now);
      row.lane = LANES.WATCHLIST;
      if (row.status !== "DEEP_SCORE_RUNNING") row.status = "DEEP_SCORE_PENDING";
      recompute(row, now);
    }
    const explorationSymbols = new Set(exploration.map(symbolOf).filter(Boolean));
    for (const symbol of explorationSymbols) {
      if (candidates.has(symbol) && candidates.get(symbol).lane !== LANES.EXPLORATION) continue;
      const row = ensure(symbol, now);
      row.lane = LANES.EXPLORATION;
      if (row.status !== "DEEP_SCORE_RUNNING") row.status = "DEEP_SCORE_PENDING";
      recompute(row, now);
    }
    for (const [symbol, row] of candidates) {
      const stillCheap = cheapSymbols.has(symbol);
      const monitor = row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY;
      const stillExploration = row.lane === LANES.EXPLORATION && explorationSymbols.has(symbol);
      const stillWatch = row.lane === LANES.WATCHLIST && watch.has(symbol);
      if (stillCheap || monitor || stillExploration || stillWatch || row.status === "DEEP_SCORE_RUNNING") continue;
      candidates.delete(symbol);
      seenCheap.delete(symbol);
      jobsExpired += 1;
    }
    for (const row of candidates.values()) recompute(row, now);
    return publicStatus(now);
  }

  function ingestRealtimeMover(event = {}, now = Date.now()) {
    if (event.realtime !== true || event.timing === "DELAYED") {
      return { accepted: false, reason: "DELAYED_FEED", waitedForSwingScan: false };
    }
    const measured = Date.parse(event.measuredAt || "");
    const symbol = symbolOf(event);
    if (!symbol || !Number.isFinite(measured)) {
      return { accepted: false, reason: "MEASURED_AT_MISSING", waitedForSwingScan: false };
    }
    sync({
      cheapMovers: [...lastCheap.filter((row) => symbolOf(row) !== symbol), {
        symbol,
        percentChange: event.percentChange,
        volume: event.volume,
        measuredAt: event.measuredAt,
      }],
      now,
    });
    const row = candidates.get(symbol);
    if (row) {
      row.discoveredAt = measured;
      row.discoveryLatencyMs = Math.max(0, now - measured);
      row.waitedForSwingScan = false;
    }
    return { accepted: true, symbol, waitedForSwingScan: false, discoveryLatencyMs: Math.max(0, now - measured) };
  }

  function noteTradierQuote(quote = {}, now = Date.now()) {
    const symbol = symbolOf(quote);
    const row = candidates.get(symbol);
    if (!row) return null;
    const source = String(quote.liveQuoteSource || quote.source || "");
    if (!source.includes("tradier")) return row;
    row.tradier = {
      price: finite(quote.price ?? quote.current),
      bid: finite(quote.bid),
      ask: finite(quote.ask),
      spreadPercent: finite(quote.spreadPercent),
      lastTradePrice: finite(quote.lastTradePrice ?? quote.last),
      bidSizeShares: finite(quote.bidSizeShares),
      askSizeShares: finite(quote.askSizeShares),
      sizeUnit: quote.sizeUnit || null,
      provider: quote.provider || null,
      feed: quote.feed || null,
      liveQuoteUpdatedAt: quote.liveQuoteUpdatedAt || null,
      liveQuoteSource: source,
      spreadSource: quote.spreadSource || source,
    };
    const exchangeAt = Date.parse(quote.liveQuoteUpdatedAt || "");
    const receivedAt = Date.parse(quote.receivedAt || "") || now;
    if (Number.isFinite(exchangeAt)) {
      row.executionMeasuredAt = new Date(exchangeAt).toISOString();
      row.executionEvidenceAgeMs = Math.max(0, now - exchangeAt);
      row.providerLatencyMs = Math.max(0, receivedAt - exchangeAt);
      latencySamples.push(row.providerLatencyMs);
      if (latencySamples.length > 200) latencySamples.shift();
    }
    noteMeasurement(row, {
      percentChange: quote.percentChange,
      volume: quote.volume,
    }, now);
    if (row.status === "DEEP_SCORE_PENDING") row.priorityReason = row.moveVelocity > 0.15 ? "ACCELERATING" : row.priorityReason;
    return row;
  }

  function ranked(lanes, now) {
    return [...candidates.values()]
      .filter((row) => lanes.has(row.lane) && row.status !== "DEEP_SCORE_RUNNING")
      .map((row) => recompute(row, now))
      .sort((left, right) => right.priority - left.priority || left.queueEnteredAt - right.queueEnteredAt);
  }

  function take(row) {
    row.status = "DEEP_SCORE_RUNNING";
    row.dispatchedAt = Date.now();
    return row.symbol;
  }

  function nextDeepJobs(capacity = workerCapacity, now = Date.now()) {
    const slots = Math.max(1, Math.floor(Number(capacity) || workerCapacity));
    const explorationCandidate = slots > 1 ? ranked(new Set([LANES.EXPLORATION]), now)[0] : null;
    const discoverySlots = slots - (explorationCandidate ? 1 : 0);
    const jobs = ranked(DISCOVERY_LANES, now).slice(0, discoverySlots).map(take);
    if (explorationCandidate) jobs.push(take(explorationCandidate));
    const monitor = [...candidates.values()]
      .filter((row) => (row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY) && row.status !== "DEEP_SCORE_RUNNING")
      .sort((left, right) => Date.parse(left.lastDeepScoreAt || 0) - Date.parse(right.lastDeepScoreAt || 0))[0];
    if (monitor) jobs.push(take(monitor));
    return jobs;
  }

  function finish(symbol, { durationMs = null, scored = false, now = Date.now() } = {}) {
    const row = candidates.get(symbolOf(symbol));
    if (!row || row.status !== "DEEP_SCORE_RUNNING") return null;
    const waitOrigin = Date.parse(row.lastDeepScoreAt || "") || row.queueEnteredAt;
    const waitMs = Math.max(0, (row.dispatchedAt || now) - waitOrigin);
    waitSamples.push(waitMs);
    if (waitSamples.length > 200) waitSamples.shift();
    if (Number.isFinite(durationMs)) {
      durationSamples.push(durationMs);
      if (durationSamples.length > 200) durationSamples.shift();
    }
    row.status = row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY
      ? "MONITORING"
      : "DEEP_SCORE_PENDING";
    if (scored) {
      row.lastDeepScoreAt = new Date(now).toISOString();
      completedAt.push(now);
      while (completedAt.length && now - completedAt[0] > 60000) completedAt.shift();
    }
    recompute(row, now);
    return row;
  }

  function release(symbol) {
    const row = candidates.get(symbolOf(symbol));
    if (!row || row.status !== "DEEP_SCORE_RUNNING") return;
    row.status = row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY
      ? "MONITORING"
      : "DEEP_SCORE_PENDING";
  }

  function subscriptionSymbols(limit = streamCapacity, now = Date.now()) {
    const cap = Math.max(1, Math.floor(Number(limit) || streamCapacity));
    for (const row of candidates.values()) recompute(row, now);
    const monitors = [...candidates.values()]
      .filter((row) => row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY)
      .map((row) => row.symbol);
    const rankedDiscovery = [...candidates.values()]
      .filter((row) => !monitors.includes(row.symbol))
      .map((row) => ({ symbol: row.symbol, priority: row.subscriptionPriority }));
    const incumbent = [...candidates.values()]
      .filter((row) => row.tradierSubscribed)
      .map((row) => ({ symbol: row.symbol, subscribedAt: row.tradierSubscribedAt, priority: row.subscriptionPriority }));
    const selected = selectSubscriptionSymbols({ monitors, ranked: rankedDiscovery, incumbent, limit: cap, now });
    const selectedSet = new Set(selected);
    for (const row of candidates.values()) {
      if (selectedSet.has(row.symbol)) {
        if (!row.tradierSubscribedAt) row.tradierSubscribedAt = new Date(now).toISOString();
      } else row.tradierSubscribedAt = null;
      row.tradierSubscribed = selectedSet.has(row.symbol);
    }
    return selected;
  }

  function applyEvidence(quote = {}) {
    const row = candidates.get(symbolOf(quote));
    const tradier = row?.tradier;
    const base = {
      ...quote,
      discoverySource: "MASSIVE",
      executionBroker: "ALPACA",
    };
    if (!tradier || !(tradier.price > 0)) return base;
    const bid = tradier.bid > 0 ? tradier.bid : null;
    const ask = tradier.ask > 0 ? tradier.ask : null;
    return {
      ...base,
      price: tradier.price,
      current: tradier.price,
      livePrice: tradier.price,
      bid,
      ask,
      spreadPercent: tradier.spreadPercent,
      spreadAvailable: bid !== null && ask !== null && ask >= bid,
      lastTradePrice: tradier.lastTradePrice,
      bidSizeShares: tradier.bidSizeShares,
      askSizeShares: tradier.askSizeShares,
      sizeUnit: tradier.sizeUnit,
      provider: tradier.provider,
      feed: tradier.feed,
      liveQuoteUpdatedAt: tradier.liveQuoteUpdatedAt,
      quoteFetchedAt: tradier.liveQuoteUpdatedAt,
      liveQuoteSource: tradier.liveQuoteSource,
      quoteSource: "TRADIER",
      spreadSource: "TRADIER",
      tradeSource: "TRADIER",
    };
  }

  function publicStatus(now = Date.now()) {
    const pending = ranked(new Set([...DISCOVERY_LANES, LANES.EXPLORATION]), now);
    const rows = pending.slice(0, 30).map((row, index) => {
      const waitMs = Math.max(0, now - row.queueEnteredAt);
      return {
        symbol: row.symbol,
        status: row.status === "DEEP_SCORE_RUNNING" ? "DEEP_SCORE_RUNNING" : "DEEP_SCORE_PENDING",
        queuePosition: index + 1,
        waitingSeconds: Number((waitMs / 1000).toFixed(1)),
        tradierQuote: row.tradierSubscribed && row.tradier ? "LIVE" : row.tradierSubscribed ? "SUBSCRIBED" : "WAITING",
        priorityReason: row.priorityReason,
        priority: row.priority,
        lane: row.lane,
        cheapDiscoveryScore: row.cheapDiscoveryScore,
      };
    });
    return {
      queueDepth: pending.length,
      monitored: [...candidates.values()].filter((row) => row.lane === LANES.OPEN_POSITION || row.lane === LANES.AUTHORIZED_NEAR_BUY).length,
      queueWaitP50: percentile(waitSamples, 50),
      queueWaitP95: percentile(waitSamples, 95),
      queueWaitMax: waitSamples.length ? Number(Math.max(...waitSamples).toFixed(1)) : null,
      deepScoreDurationP50: percentile(durationSamples, 50),
      deepScoreDurationP95: percentile(durationSamples, 95),
      jobsCompletedPerMinute: completedAt.length,
      jobsExpired,
      providerLatencyP50: percentile(latencySamples, 50),
      rows,
    };
  }

  return {
    sync,
    syncMonitors(args = {}) {
      return sync({ ...args, cheapMovers: lastCheap, exploration: lastExploration });
    },
    noteTradierQuote,
    ingestRealtimeMover,
    nextDeepJobs,
    finish,
    release,
    subscriptionSymbols,
    applyEvidence,
    publicStatus,
  };
}

export { LANES };
