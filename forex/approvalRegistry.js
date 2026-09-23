import { evaluateStrategyReport, permittedEnvironmentForReport } from "./evaluationGate.js";

export const STRATEGY_IDS = Object.freeze({
  BREAKOUT: "FOREX_BREAKOUT_RETEST_V1",
  CONTINUATION: "FOREX_TREND_CONTINUATION_V1",
  MANUAL: "FOREX_MANUAL_PRACTICE_V1",
});

const ENVIRONMENTS = ["RESEARCH", "HISTORICAL_VALIDATION", "FORWARD_PRACTICE", "LIMITED_LIVE", "LIVE"];

export function createApprovalRegistry(entries = {}) {
  return {
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
  return { ok: true, environment: row.permittedEnvironment };
}

export function mayAutoExecute(registry, strategyId, environment = "FORWARD_PRACTICE") {
  const row = registry?.[strategyId];
  if (!row) return false;
  const rank = ENVIRONMENTS.indexOf(row.permittedEnvironment);
  const needed = ENVIRONMENTS.indexOf(environment);
  return rank >= 0 && needed >= 0 && rank >= needed;
}
