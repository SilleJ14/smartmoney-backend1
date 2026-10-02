import { applyStrategyDriftReview } from "./approvalRegistry.js";
import { monitorDrift } from "./research/drift.js";

const finite = value => typeof value === "number" && Number.isFinite(value);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function metrics(rows) {
  const returns = rows.map(row => Number(row.rMultiple)).filter(finite);
  const costs = rows.map(row => Number(row.costR)).filter(finite);
  const calibration = rows.flatMap(row => {
    const probability = Number(row.predictedProbability);
    const outcome = row.success === true ? 1 : row.success === false ? 0 : null;
    return finite(probability) && outcome !== null ? [(probability - outcome) ** 2] : [];
  });
  let equity = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
  }
  return {
    expectancy: mean(returns),
    cost: mean(costs),
    calibration: mean(calibration),
    drawdown: returns.length ? maximumDrawdown : null,
  };
}

export function applyJournalDriftSafeguards({
  registry,
  journal,
  minimumOutcomes = 20,
  now = Date.now(),
} = {}) {
  if (!registry || !journal?.listEvents) return [];
  let events;
  try { events = journal.listEvents({ type: "OUTCOME", limit: 1000 }); }
  catch { return []; }
  const reviews = [];
  for (const [strategyId, strategy] of Object.entries(registry)) {
    const rows = events.map(event => event.payload || {})
      .filter(row => row.strategyId === strategyId)
      .slice(0, 100);
    if (rows.length < minimumOutcomes || !strategy.validatedConfidenceBands) continue;
    const current = metrics(rows);
    const drift = monitorDrift({
      current,
      confidenceBands: strategy.validatedConfidenceBands,
    });
    const last = strategy.lastDriftReview;
    const reasons = drift.breaches.map(item => `LIVE_${item.reason}_DRIFT`);
    const review = {
      action: drift.action,
      reasons,
      metrics: { ...current, sampleSize: rows.length, breaches: drift.breaches },
    };
    if (drift.action === "PAUSE" || !last || last.metrics?.sampleSize !== rows.length) {
      applyStrategyDriftReview(registry, strategyId, review, now);
      reviews.push({ strategyId, ...review, disabled: registry[strategyId].disabled === true });
    }
  }
  return reviews;
}
