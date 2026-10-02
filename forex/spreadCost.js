export function spreadChecks({
  bid,
  ask,
  stopDistance,
  absoluteLimit = 0,
  targetDistance,
  costs = 0,
  minNetRewardRisk = 2,
} = {}) {
  const policy = [absoluteLimit, costs, minNetRewardRisk].map(Number);
  if (!policy.every(value => Number.isFinite(value) && value >= 0)) {
    return { ok: false, reason: "SPREAD_POLICY_INVALID", spread: null };
  }
  if (![stopDistance, targetDistance].map(Number).every(value => Number.isFinite(value) && value > 0)) {
    return { ok: false, reason: "SPREAD_ECONOMICS_INVALID", spread: null };
  }
  const spread = Number(ask) - Number(bid);
  if (!(spread >= 0) || !(Number(bid) > 0) || !(Number(ask) > 0)) {
    return { ok: false, reason: "QUOTE_STALE", spread };
  }
  const allowed = 0.10 * Number(stopDistance) + Number(absoluteLimit);
  if (!(stopDistance > 0) || spread > allowed) {
    return { ok: false, reason: "SPREAD_TOO_WIDE", spread, allowed };
  }
  const netTarget = Number(targetDistance) - spread - Number(costs);
  const netRisk = Number(stopDistance) + spread + Number(costs);
  const rr = netRisk > 0 ? netTarget / netRisk : 0;
  if (rr < minNetRewardRisk) {
    return { ok: false, reason: "NET_REWARD_RISK_FAIL", spread, rr };
  }
  return { ok: true, spread, rr };
}
