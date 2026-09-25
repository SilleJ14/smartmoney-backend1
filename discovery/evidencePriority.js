// Scarce evidence slots are a budget. Membership is recomputed from the
// candidate's state. Arrival order does not decide who can qualify.

import { isNearFinalBuyGate } from "../scoring/nearFinalBuyGate.js";

function finite(...values) {
  for (const value of values) {
    const score = Number(value);
    if (Number.isFinite(score)) return score;
  }
  return null;
}

function buyGateFor(row, override) {
  if (override !== null && override !== undefined && Number.isFinite(Number(override))) return Number(override);
  return String(row.symbol || "").includes("/") ? 65 : 70;
}

export function evidencePriority(row = {}, { now = Date.now(), buyGate = null } = {}) {
  const gate = buyGateFor(row, buyGate);
  const currentD = (row.currentAnalyticalSnapshot
    ? finite(row.currentAnalyticalSnapshot.components?.discovery?.score)
    : finite(row.discoveryScore, row.preMoveScore, row.discoveryScorecard?.score)) ?? 0;
  const currentF = finite(
    row.currentAnalyticalScore,
    row.stockDecisionScore,
    row.cryptoDecisionScore,
    row.masterFinalScore
  );
  const distanceToQualification = currentF === null ? null : Number((gate - currentF).toFixed(2));
  const qualification = currentF === null
    ? 0
    : distanceToQualification > 0
      ? Math.max(0, 40 - distanceToQualification)
      : 8;
  const coverage = finite(row.decisionCoverage);
  const maximumPossibleF = finite(row.maximumPossibleF);
  const highAndUncertain = currentF !== null && coverage !== null && coverage < 0.9 && currentF >= gate - 5;
  const couldCross = currentF !== null && currentF < gate && maximumPossibleF !== null && maximumPossibleF >= gate;
  const bounds = row.analyticalBounds && typeof row.analyticalBounds === "object" ? row.analyticalBounds : null;
  let evidenceAcquisition = highAndUncertain || couldCross
    ? Number(((1 - (coverage ?? 1)) * 30).toFixed(2))
    : 0;
  let unreachableModel = false;
  if (bounds) {
    const action = bounds.recommendedAction;
    if (action === "ABANDON_CURRENT_MODEL" || action === "SWITCH_SETUP_MODEL" || bounds.analyticalPassReachable === false) {
      evidenceAcquisition = 0;
      unreachableModel = true;
    } else if (action === "EVIDENCE_SUFFICIENT") {
      evidenceAcquisition = 0;
    } else if (action === "COLLECT_EVIDENCE") {
      const distance = Number(bounds.decisionBoundaryDistance);
      if (distance === 0) evidenceAcquisition = Math.max(evidenceAcquisition, 24);
      else if (bounds.finalScoreGuaranteed === true) evidenceAcquisition = Math.min(evidenceAcquisition || 6, 6);
    }
  }
  const aboveCompletionCeiling = row.scoreRiseReason === "SCORE_ABOVE_COMPLETION_CEILING"
    || Number(bounds?.remainingScoreDelta) < 0;
  const scoreVelocity = row.scoreChangeCause === "EVIDENCE_LOST" || aboveCompletionCeiling
    ? 0
    : Math.max(0, finite(row.scoreVelocity, row.moveVelocity) ?? 0);
  const volumeAcceleration = Math.max(0, finite(
    row.volumeVelocity,
    row.volumeAcceleration,
    finite(row.intradayVolumeWakeupRatio) === null ? null : finite(row.intradayVolumeWakeupRatio) - 1
  ) ?? 0);
  const newsAt = Date.parse(row.newsArrivedAt || row.lastNewsAt || row.confirmations?.newsCatalyst?.publishedAt || "");
  const newsArrival = row.hasNews === true
    || row.confirmations?.newsCatalyst?.catalystAvailable === true
    || (Number.isFinite(newsAt) && now >= newsAt && now - newsAt <= 6 * 60 * 60 * 1000);
  const high = finite(row.high, row.dayHigh, row.sessionHigh);
  const price = finite(row.price, row.current);
  const gap = high > 0 && price > 0 ? (high - price) / high : null;
  const nearBreakout = gap !== null && gap >= 0 && gap <= 0.02;
  const lastFullAt = Date.parse(row.lastFullAssessment || row.lastDeepScoreAt || row.lastFullEvaluationAt || "");
  const neverEvaluated = !Number.isFinite(lastFullAt);
  const minutesSinceEvaluation = neverEvaluated ? null : Math.max(0, (now - lastFullAt) / 60000);
  const novelty = neverEvaluated || row.lane === "EXPLORATION" || row.candidateSource === "EXPLORATION";
  const nearLine = isNearFinalBuyGate(currentF, gate, 5);
  const authorizationRequired = currentF !== null && currentF >= gate && row.authorizedDecisionValid !== true;
  const priority = Number((
    currentD * 0.25
    + qualification
    + scoreVelocity * 10
    + volumeAcceleration * 8
    + (newsArrival ? 18 : 0)
    + (nearBreakout ? 16 : Math.min(12, (finite(row.compressionScore) ?? 0) / 10))
    + (novelty ? 14 : 0)
    + evidenceAcquisition
    + Math.min(30, minutesSinceEvaluation || 0)
    - (unreachableModel ? 100 : 0)
  ).toFixed(2));
  const reasons = [
    ...(nearLine ? ["NEAR_QUALIFICATION"] : []),
    ...(authorizationRequired ? ["AUTHORIZATION_REQUIRED"] : []),
    ...(scoreVelocity > 0 ? ["SCORE_VELOCITY"] : []),
    ...(volumeAcceleration > 0 ? ["VOLUME_ACCELERATION"] : []),
    ...(newsArrival ? ["NEWS_ARRIVAL"] : []),
    ...(nearBreakout ? ["BREAKOUT_PROXIMITY"] : []),
    ...(novelty ? ["NOVELTY"] : []),
    ...(minutesSinceEvaluation !== null && minutesSinceEvaluation >= 10 ? ["EVALUATION_AGE"] : []),
    ...(evidenceAcquisition > 0 ? ["EVIDENCE_ACQUISITION"] : []),
    ...(bounds?.recommendedAction === "ABANDON_CURRENT_MODEL" ? ["ABANDON_CURRENT_MODEL"] : []),
    ...(bounds?.recommendedAction === "SWITCH_SETUP_MODEL" ? ["SWITCH_SETUP_MODEL"] : []),
    ...(bounds?.recommendedAction === "COLLECT_EVIDENCE" ? ["COLLECT_EVIDENCE"] : []),
  ];
  return {
    priority, currentD, currentF, distanceToQualification, reasons, nearLine, authorizationRequired,
  };
}

export function resolveEvidenceBudget({
  watchlistSlots = 30,
  liveSlots = 15,
  memoryPressure = false,
  workersIdle = false,
  subscriptionRoom = null,
  demandAboveCap = false,
} = {}) {
  const watchCap = Math.min(50, Math.max(1, Math.floor(Number(watchlistSlots) || 30)));
  let live = Math.min(20, watchCap, Math.max(1, Math.floor(Number(liveSlots) || 15)));
  if (memoryPressure) live = Math.max(1, Math.floor(live / 2));
  else if (
    workersIdle
    && demandAboveCap
    && Number.isFinite(Number(subscriptionRoom))
    && Number(subscriptionRoom) > live
  ) {
    live = Math.min(20, watchCap, Number(subscriptionRoom), live + 1);
  }
  return { watchlistSlots: watchCap, liveSlots: live };
}

function symbolOf(value) {
  return String(value?.symbol || value || "").trim().toUpperCase();
}

export function allocateEvidenceSlots(candidates = [], {
  watchlistSlots = 30,
  liveSlots = 15,
  now = Date.now(),
  buyGate = null,
} = {}) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((row) => row && (row.symbol || row.s))
    .map((row) => ({ row: { ...row, symbol: row.symbol || row.s }, score: evidencePriority(row.symbol ? row : { ...row, symbol: row.s }, { now, buyGate }) }))
    .sort((left, right) => right.score.priority - left.score.priority
      || String(left.row.symbol).localeCompare(String(right.row.symbol)));
  const watchCap = Math.max(0, Math.floor(Number(watchlistSlots) || 0));
  const liveCap = Math.max(0, Math.min(Math.floor(Number(liveSlots) || 0), watchCap || Math.floor(Number(liveSlots) || 0)));
  const decorate = (item) => ({
    ...item.row,
    evidencePriority: item.score.priority,
    evidencePriorityReasons: item.score.reasons,
    distanceToQualification: item.score.distanceToQualification,
    nearLine: item.score.nearLine,
    authorizationRequired: item.score.authorizationRequired,
  });
  const watchlist = ranked.slice(0, watchCap).map(decorate);
  const livePick = [];
  const novel = liveCap > 1 ? ranked.find((item) => item.score.reasons.includes("NOVELTY")) : null;
  if (novel) livePick.push(novel);
  for (const item of ranked) {
    if (livePick.length >= liveCap) break;
    if (livePick.some((picked) => picked.row.symbol === item.row.symbol)) continue;
    livePick.push(item);
  }
  return {
    watchlist,
    liveSymbols: livePick.map((item) => item.row.symbol),
    ranked: ranked.map(decorate),
    authorizationCandidates: ranked.filter((item) => item.score.authorizationRequired).map(decorate),
    rankedCount: ranked.length,
  };
}

export function reconcileLiveMembership(previous = [], ranked = [], {
  margin = 2,
  minDwellMs = 60000,
  admittedAt = {},
  now = Date.now(),
  liveSlots = 15,
} = {}) {
  const cap = Math.max(0, Math.floor(Number(liveSlots) || 0));
  const ordered = (Array.isArray(ranked) ? ranked : [])
    .filter((row) => symbolOf(row))
    .map((row) => ({ ...row, symbol: symbolOf(row) }));
  const score = new Map(ordered.map((row) => [row.symbol, Number(row.evidencePriority ?? row.priority ?? 0)]));
  const previousSymbols = [...new Set((Array.isArray(previous) ? previous : []).map(symbolOf).filter((symbol) => score.has(symbol)))];
  const previousSet = new Set(previousSymbols);
  const kept = [];
  for (const symbol of previousSymbols) {
    const challenger = ordered.find((row) => !previousSet.has(row.symbol));
    const challenge = challenger ? Number(challenger.evidencePriority ?? challenger.priority ?? -Infinity) : -Infinity;
    const materialNews = challenger?.evidencePriorityReasons?.includes("NEWS_ARRIVAL")
      || challenger?.reasons?.includes("NEWS_ARRIVAL");
    const admitted = Number(admittedAt?.[symbol]);
    const dwellElapsed = !Number.isFinite(admitted) || now - admitted >= minDwellMs;
    const clearlyBeaten = Number.isFinite(challenge) && challenge >= score.get(symbol) + margin;
    if (clearlyBeaten && (dwellElapsed || materialNews)) continue;
    kept.push(symbol);
  }
  kept.sort((left, right) => (score.get(right) || 0) - (score.get(left) || 0) || left.localeCompare(right));
  const chosen = new Set(kept.slice(0, cap));
  for (const row of ordered) {
    if (chosen.size >= cap) break;
    chosen.add(row.symbol);
  }
  const liveSymbols = ordered.filter((row) => chosen.has(row.symbol)).slice(0, cap).map((row) => row.symbol);
  const nextAdmitted = {};
  for (const symbol of liveSymbols) nextAdmitted[symbol] = Number.isFinite(Number(admittedAt?.[symbol])) ? Number(admittedAt[symbol]) : now;
  return { liveSymbols, admittedAt: nextAdmitted };
}

function definedOverlay(overlay = {}) {
  const next = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined && value !== null) next[key] = value;
  }
  return next;
}

export function refreshCachedEvidenceMembership(state = {}, overlays = [], {
  now = Date.now(),
  memoryPressure = false,
  workersIdle = false,
  subscriptionRoom = null,
  watchlistSlots = 30,
  liveSlots = 15,
  margin = 2,
  minDwellMs = 60000,
} = {}) {
  const cached = Array.isArray(state.cachedFeatures)
    ? state.cachedFeatures
    : Array.isArray(state.discoveryCandidates)
      ? state.discoveryCandidates
      : Array.isArray(state.watchlist) ? state.watchlist : [];
  const overlayBySymbol = new Map();
  for (const overlay of Array.isArray(overlays) ? overlays : []) {
    const symbol = symbolOf(overlay);
    if (!symbol) continue;
    overlayBySymbol.set(symbol, { ...(overlayBySymbol.get(symbol) || {}), ...definedOverlay(overlay), symbol });
  }
  const merged = cached.map((row) => {
    const overlay = overlayBySymbol.get(symbolOf(row));
    if (!overlay) return { ...row, symbol: symbolOf(row) };
    return {
      ...row,
      ...overlay,
      symbol: symbolOf(row),
      preMoveScore: row.preMoveScore,
      discoveryScore: row.discoveryScore,
      discoveryScorecard: row.discoveryScorecard,
      compressionScore: row.compressionScore,
      components: row.components,
    };
  });
  let budget = resolveEvidenceBudget({
    watchlistSlots,
    liveSlots,
    memoryPressure,
    subscriptionRoom,
  });
  let allocation = allocateEvidenceSlots(merged, { ...budget, now });
  if (!memoryPressure && workersIdle && allocation.rankedCount > budget.liveSlots) {
    const grown = resolveEvidenceBudget({
      ...budget,
      workersIdle: true,
      demandAboveCap: true,
      subscriptionRoom,
    });
    if (grown.liveSlots !== budget.liveSlots) {
      budget = grown;
      allocation = allocateEvidenceSlots(merged, { ...budget, now });
    }
  }
  const stable = reconcileLiveMembership(state.liveSymbols || [], allocation.ranked, {
    margin,
    minDwellMs,
    admittedAt: state.evidenceAdmittedAt || {},
    now,
    liveSlots: budget.liveSlots,
  });
  return {
    ...state,
    cachedFeatures: cached,
    watchlist: allocation.watchlist.slice(0, budget.watchlistSlots),
    liveSymbols: stable.liveSymbols,
    evidenceAdmittedAt: stable.admittedAt,
    authorizationCandidates: allocation.authorizationCandidates,
    evidenceMembershipUpdatedAt: new Date(now).toISOString(),
    budgets: { ...(state.budgets || {}), watchlistSize: budget.watchlistSlots, liveSymbols: budget.liveSlots },
  };
}

export function rankBeforeSlice(signals = [], { minScore = 0, limit = 20 } = {}) {
  const floor = Number(minScore);
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  return (Array.isArray(signals) ? signals : [])
    .filter((signal) => signal && Number(signal.score || 0) >= floor)
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
      || String(left.symbol || "").localeCompare(String(right.symbol || "")))
    .slice(0, cap);
}

export function selectSubscriptionSymbols({
  monitors = [],
  ranked = [],
  incumbent = [],
  limit = 120,
  now = Date.now(),
  margin = 2,
  minDwellMs = 60000,
} = {}) {
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  const selected = [];
  const chosen = new Set();
  for (const symbol of monitors.map(symbolOf).filter(Boolean)) {
    if (chosen.has(symbol) || selected.length >= cap) continue;
    chosen.add(symbol);
    selected.push(symbol);
  }
  const score = new Map();
  for (const row of Array.isArray(ranked) ? ranked : []) {
    const symbol = symbolOf(row);
    if (!symbol || chosen.has(symbol)) continue;
    const priority = Number(row.priority);
    if (!score.has(symbol) || priority > score.get(symbol)) score.set(symbol, Number.isFinite(priority) ? priority : 0);
  }
  const ordered = [...score.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const incumbentAt = new Map();
  for (const row of Array.isArray(incumbent) ? incumbent : []) {
    const symbol = symbolOf(row);
    if (!symbol || chosen.has(symbol)) continue;
    incumbentAt.set(symbol, Date.parse(row.subscribedAt || "") || 0);
  }
  const kept = [];
  for (const [symbol, priority] of ordered) {
    if (!incumbentAt.has(symbol)) continue;
    const challenger = ordered.find(([other]) => !incumbentAt.has(other));
    const challenge = challenger ? challenger[1] : -Infinity;
    const admitted = incumbentAt.get(symbol);
    const dwellElapsed = !admitted || now - admitted >= minDwellMs;
    if (challenge >= priority + margin && dwellElapsed) continue;
    kept.push(symbol);
  }
  for (const symbol of kept) {
    if (selected.length >= cap || chosen.has(symbol)) continue;
    chosen.add(symbol);
    selected.push(symbol);
  }
  for (const [symbol] of ordered) {
    if (selected.length >= cap) break;
    if (chosen.has(symbol)) continue;
    chosen.add(symbol);
    selected.push(symbol);
  }
  return selected;
}
