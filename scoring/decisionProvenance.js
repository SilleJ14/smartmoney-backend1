import { createHash } from 'node:crypto';
import { EVIDENCE_POLICY_VERSION } from '../risk/evidencePolicy.js';
import { policyManifest } from './policyBundle.js';
import { barSnapshot } from '../market-data/barSnapshot.js';
import { assessSnapshotTimes, SNAPSHOT_TIME_POLICY_VERSION } from '../risk/snapshotTimePolicy.js';
import { isCryptoSignal } from './canonicalSignalRank.js';

export const SCORING_POLICY_VERSION = 'BASELINE_2026_09_19_V1';
export const STRATEGY_VERSION = 'EXISTING_STRATEGY_2026_09_19_V1';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
// Only allowlisted strategy/risk configuration; never keys, tokens or accounts.
export function configurationSnapshot(config = {}) {
  const values = Object.fromEntries(['maxBotExposurePercent','maxAccountExposurePercent','maxOpenTrades',
    'minStockPrice','dailyLossLimitPercent','minAutonomousTradeAmount','minScoreToBuy',
    'liveHardStopPercent','stopLossPercent','maxStockPrice','minVolume','minVolumeSpikeRatio',
    'minCloseNearHighPercent','enableAdvancedFilters','maxStockOpenTrades','maxCryptoOpenTrades',
    'trailingStopPercent','takeProfitPercent','profitLockTriggerPercent','profitLockProtectPercent',
    'realCashTradingUnlocked','minRelativeVolume','maxSpreadPercent'].map(k => {
      const value = config[k];
      return [k, typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : null];
    }));
  return freeze({ id: digest(values), values });
}
export function createDecisionSnapshot(signal, config = {}, now = Date.now()) {
  const copy = structuredClone(signal);
  const issues = [];
  if (copy.barSnapshotId && copy.technicals?.barSnapshotId && copy.barSnapshotId !== copy.technicals.barSnapshotId) {
    issues.push('TECHNICAL_BAR_SNAPSHOT_MISMATCH');
    copy.technicals = {};
    delete copy.entryQualityScorecard;
    copy.technicalBarsFound = 0;
  }
  if (copy.cryptoSetup?.inputBarSnapshotId) {
    const history = barSnapshot(copy.chartBars);
    copy.barSnapshotId = history.id;
    if (copy.cryptoSetup.inputBarSnapshotId !== history.id) {
      issues.push('CRYPTO_SETUP_BAR_SNAPSHOT_MISMATCH');
      copy.cryptoSetup = { ...copy.cryptoSetup, available: false, eligible: false, score: null,
        reasons: ['CRYPTO_SETUP_BAR_SNAPSHOT_MISMATCH'] };
    }
  }
  copy.evidenceCoherence = { issues, status: issues.length ? 'INCOHERENT' : 'NO_KNOWN_DEPENDENCY_CONFLICT' };
  copy.snapshotTemporalEvidence = assessSnapshotTimes(copy, { now,
    crypto: isCryptoSignal(copy) });
  const input = freeze(copy);
  const configuration = configurationSnapshot(config);
  // Hash exact inputs, retaining the input only for the duration of evaluation.
  // No global map of large signal snapshots is kept in process memory.
  const evidenceSnapshotId = digest(input);
  return { input, provenance: freeze({ evidenceSnapshotId, configurationSnapshot: configuration,
    scoringPolicyVersion: SCORING_POLICY_VERSION, strategyVersion: STRATEGY_VERSION,
    evidencePolicyVersion: EVIDENCE_POLICY_VERSION, assessmentStartedAt: new Date(now).toISOString(),
    policyBundleId: policyManifest.id, releaseCommit: policyManifest.releaseCommit,
    temporalPolicyVersion: SNAPSHOT_TIME_POLICY_VERSION,
    temporalEvidence: input.snapshotTemporalEvidence,
    evidenceTimes: { price: signal.liveQuoteUpdatedAt ?? null, spread: signal.spreadUpdatedAt ?? null,
      news: signal.confirmations?.newsReviewedAt ?? signal.newsCatalyst?.reviewedAt ?? signal.newsRiskCheckedAt ?? null,
      fundamentals: signal.fundamentalValidation?.asOf ?? null },
    technicalBarSnapshotId: signal.technicals?.barSnapshotId ?? null,
    historySnapshotId: input.barSnapshotId ?? null,
    evidenceCoherence: input.evidenceCoherence,
  }) };
}
export function canPublishDecision(current, incoming) {
  const previous = Number(current?.decisionRevision ?? 0);
  const next = Number(incoming?.decisionRevision ?? 0);
  if (previous > 0) return Number.isSafeInteger(next) && next > previous;
  return next === 0 || (Number.isSafeInteger(next) && next > 0);
}
