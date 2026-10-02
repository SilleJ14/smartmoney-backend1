import { evaluateStrategyReport, permittedEnvironmentForReport } from "./evaluationGate.js";

export const STRATEGY_IDS = Object.freeze({
  BREAKOUT: "FOREX_BREAKOUT_RETEST_V1",
  CONTINUATION: "FOREX_TREND_CONTINUATION_V1",
  MANUAL: "FOREX_MANUAL_PRACTICE_V1",
});

const ENVIRONMENTS = ["RESEARCH", "HISTORICAL_VALIDATION", "FORWARD_PRACTICE", "LIMITED_LIVE", "LIVE"];

export function createApprovalRegistry(entries = {}) {
  const registry = {
    FOREX_BREAKOUT_RETEST_V1: {
      strategyId: STRATEGY_IDS.BREAKOUT,
      configHash: "fx-breakout-retest-v1",
      environment: "RESEARCH",
      instrumentUniverse: [],
      sessions: ["FOREX"],
      costModel: "BID_ASK_PLUS_COMMISSION_FINANCING",
      evaluationPeriod: null,
      permittedEnvironment: "RESEARCH",
      ...entries.FOREX_BREAKOUT_RETEST_V1,
    },
    FOREX_TREND_CONTINUATION_V1: {
      strategyId: STRATEGY_IDS.CONTINUATION,
      configHash: "fx-trend-continuation-v1",
      environment: "RESEARCH",
      instrumentUniverse: [],
      sessions: ["FOREX"],
      costModel: "BID_ASK_PLUS_COMMISSION_FINANCING",
      evaluationPeriod: null,
      permittedEnvironment: "RESEARCH",
      ...entries.FOREX_TREND_CONTINUATION_V1,
    },
    FOREX_MANUAL_PRACTICE_V1: {
      strategyId: STRATEGY_IDS.MANUAL,
      configHash: "fx-manual-practice-v1",
      environment: "FORWARD_PRACTICE",
      instrumentUniverse: [],
      sessions: ["FOREX"],
      costModel: "BID_ASK_PLUS_COMMISSION_FINANCING",
      evaluationPeriod: null,
      permittedEnvironment: "FORWARD_PRACTICE",
      ...entries.FOREX_MANUAL_PRACTICE_V1,
    },
  };
  for (const row of Object.values(registry)) {
    if (ENVIRONMENTS.indexOf(row.permittedEnvironment) >= ENVIRONMENTS.indexOf("FORWARD_PRACTICE") &&
        row.validatedConfigHash == null) {
      row.validatedConfigHash = row.configHash;
    }
  }
  return registry;
}

export function promoteStrategy(registry, strategyId, report) {
  const row = registry?.[strategyId];
  if (!row) return { ok: false, reason: "UNKNOWN_STRATEGY" };
  const evaluation = evaluateStrategyReport(report);
  if (!evaluation.ok) {
    row.permittedEnvironment = "RESEARCH";
    row.environment = "RESEARCH";
    return { ok: false, reasons: evaluation.reasons };
  }
  row.permittedEnvironment = permittedEnvironmentForReport(report);
  row.environment = row.permittedEnvironment;
  row.evaluationPeriod = report.evaluationPeriod || null;
  row.instrumentUniverse = report.instrumentUniverse || row.instrumentUniverse;
  row.configHash = report.configHash;
  row.validatedConfigHash = report.configHash;
  return { ok: true, environment: row.permittedEnvironment };
}

export function invalidateChangedStrategyConfig(registry, strategyId, currentConfigHash, now = Date.now()) {
  const row = registry?.[strategyId];
  if (!row) return { ok: false, reason: "UNKNOWN_STRATEGY" };
  row.configHash = currentConfigHash;
  if (row.validatedConfigHash === currentConfigHash) return { ok: true, invalidated: false };
  row.disabled = true;
  row.disabledReason = "DECISION_CONFIG_CHANGED";
  row.disabledAt = new Date(now).toISOString();
  row.permittedEnvironment = "RESEARCH";
  return { ok: true, invalidated: true, reason: row.disabledReason };
}

export function mayAutoExecute(registry, strategyId, environment = "FORWARD_PRACTICE") {
  const row = registry?.[strategyId];
  if (!row) return false;
  const rank = ENVIRONMENTS.indexOf(row.permittedEnvironment);
  const needed = ENVIRONMENTS.indexOf(environment);
  return rank >= 0 && needed >= 0 && rank >= needed;
}

export function applyStrategyDriftReview(registry, strategyId, review = {}, now = Date.now()) {
  const row = registry?.[strategyId];
  if (!row) return { ok: false, reason: "UNKNOWN_STRATEGY" };
  row.lastDriftReview = {
    at: new Date(now).toISOString(),
    action: review.action || "OBSERVE",
    reasons: Array.isArray(review.reasons) ? [...new Set(review.reasons)] : [],
    metrics: review.metrics || null,
  };
  if (review.action === "PAUSE") {
    row.disabled = true;
    row.disabledReason = row.lastDriftReview.reasons[0] || "LIVE_DRIFT";
    row.disabledAt = row.lastDriftReview.at;
    return { ok: true, disabled: true, reason: row.disabledReason };
  }
  // A healthy observation never auto-re-enables or retunes a strategy.
  return { ok: true, disabled: row.disabled === true, reason: row.disabledReason || null };
}

// Operator permission is separate from research/performance promotion. It never
// upgrades the registry or permits real-money execution.
export const FOREX_AUTOPILOT_POLICY_VERSION = "FOREX_VALIDATED_STRATEGY_V2";
export function automaticEntryPermission(registry, strategyId, { autopilotEnabled, environment = "FORWARD_PRACTICE" } = {}) {
  const base = { policyVersion: FOREX_AUTOPILOT_POLICY_VERSION, allowed: false, source: null };
  if (autopilotEnabled !== true) return { ...base, reason: "FOREX_AUTOPILOT_OFF" };
  if (environment !== "FORWARD_PRACTICE") return { ...base, reason: "LIVE_BLOCKED" };
  if (![STRATEGY_IDS.CONTINUATION, STRATEGY_IDS.BREAKOUT].includes(strategyId) || !registry?.[strategyId]) {
    return { ...base, reason: "STRATEGY_NOT_APPROVED" };
  }
  if (registry[strategyId].disabled === true) return { ...base, reason: "STRATEGY_DISABLED" };
  if (!mayAutoExecute(registry, strategyId, environment)) {
    return { ...base, reason: "STRATEGY_NOT_APPROVED" };
  }
  if (registry[strategyId].validatedConfigHash !== registry[strategyId].configHash) {
    return { ...base, reason: "DECISION_CONFIG_CHANGED" };
  }
  return { ...base, allowed: true, source: "STRATEGY_REGISTRY", reason: null };
}
