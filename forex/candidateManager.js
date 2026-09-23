const STAGES = ["DISCOVERED", "WATCHING", "TRIGGER_CONFIRMED", "EXECUTION_ELIGIBLE", "ORDER_INTENT_CREATED"];
const TERMINAL = ["BLOCKED", "INVALIDATED", "EXPIRED"];

export function createCandidate({
  identity,
  strategyId,
  side,
  frozen,
} = {}) {
  return {
    identity,
    strategyId,
    side,
    state: "DISCOVERED",
    firstSeenAt: new Date().toISOString(),
    frozen: frozen || null,
    evidenceSnapshot: null,
    deadlines: {},
    transitions: [],
    passed: [],
    pending: [],
    executionAuthorization: "None",
  };
}

export function transitionCandidate(candidate, nextState, reason, extras = {}) {
  const allowed = [...STAGES, ...TERMINAL];
  if (!allowed.includes(nextState)) throw new Error("UNKNOWN_CANDIDATE_STATE");
  const previous = candidate.state;
  candidate.state = nextState;
  candidate.lastReason = reason;
  candidate.transitions.push({
    at: new Date().toISOString(),
    from: previous,
    to: nextState,
    reason,
  });
  Object.assign(candidate, extras);
  return candidate;
}

export function oneActivePerKey(candidates, key) {
  return candidates.filter((row) => `${row.strategyId}:${row.identity}:${row.side}` === key && !TERMINAL.includes(row.state));
}
