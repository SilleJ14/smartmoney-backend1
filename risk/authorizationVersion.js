import { createHash } from 'node:crypto';

// Only risk-policy inputs: never credentials, account identifiers or UI settings.
export function riskPolicyVersion(config = {}, safety = {}) {
  const policy = Object.fromEntries([
    'maxBotExposurePercent', 'maxAccountExposurePercent', 'maxOpenTrades', 'minStockPrice',
    'dailyLossLimitPercent', 'realCashTradingUnlocked', 'minAutonomousTradeAmount',
  ].map(key => [key, config[key] ?? null]));
  const locks = Object.fromEntries(['emergencyStopActive', 'dailyLossLocked',
    'profitLocked', 'safetyReconciliationRequired'].map(key => [key, safety[key] === true]));
  return createHash('sha256').update(JSON.stringify({ policy, locks })).digest('hex').slice(0, 24);
}

export function assertRiskPolicyVersion(recorded, current) {
  if (!recorded || recorded !== current) throw new Error('RISK_POLICY_CHANGED_REASSESSMENT_REQUIRED');
}
