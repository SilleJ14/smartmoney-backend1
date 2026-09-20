import { createHash } from 'node:crypto';
import { getApprovedTradeAmount } from './approvedSizing.js';

// A projection of the current canonical gate, never an independent scoring rule.
export function decisionAuthorization(signal, gate, now = Date.now()) {
  const at = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const priceAt = at(signal.liveQuoteUpdatedAt);
  const spreadAt = at(signal.spreadUpdatedAt || signal.bidAskUpdatedAt);
  const decisionAt = at(signal.decisionUpdatedAt);
  const datesValid = [priceAt, spreadAt, decisionAt].every(n => Number.isFinite(n) && n <= now + 5000);
  const expiresMs = datesValid ? Math.min(priceAt + 5000, spreadAt + 5000, decisionAt + 300000) : NaN;
  const amount = getApprovedTradeAmount(signal);
  const reasons = [...(gate.reasons || [])];
  if (signal.currentRiskPolicyVersion && signal.riskPolicyVersion !== signal.currentRiskPolicyVersion) {
    reasons.push('RISK_POLICY_CHANGED_REASSESSMENT_REQUIRED');
  }
  if (!datesValid) reasons.push('DECISION_EVIDENCE_TIMESTAMP_UNAVAILABLE');
  else if (expiresMs <= now) reasons.push('DECISION_AUTHORIZATION_EXPIRED');
  if (!(amount >= 1)) reasons.push('POSITION_SIZING_PENDING');
  const approved = gate.approved === true && reasons.length === 0 && datesValid && expiresMs > now && amount >= 1;
  const record = { schemaVersion: 1, symbol: signal.symbol, approved,
    decisionRevision: signal.decisionRevision ?? signal.centralAutonomousDecisionCore?.decisionRevision ?? null,
    provenance: signal.decisionProvenance ?? signal.centralAutonomousDecisionCore?.provenance ?? null,
    approvedAmount: approved ? amount : 0, blockingReasons: [...new Set(reasons)],
    riskPolicyVersion: signal.riskPolicyVersion || null,
    decisionAt: signal.decisionUpdatedAt || null,
    sizingAt: signal.sizingDecisionUpdatedAt || signal.decisionUpdatedAt || null,
    priceAt: Number.isFinite(priceAt) ? new Date(priceAt).toISOString() : null,
    spreadAt: Number.isFinite(spreadAt) ? new Date(spreadAt).toISOString() : null,
    expiresAt: Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null };
  return { ...record, decisionVersion: createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 24) };
}
