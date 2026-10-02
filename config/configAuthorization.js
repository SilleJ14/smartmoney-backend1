const NON_DECISION_KEYS = new Set([
  "autoTradingEnabled",
  "tradingMode",
  "tradingModeLocked",
]);

export function decisionAffectingConfigKeys(updates = {}) {
  return Object.keys(updates).filter((key) => !NON_DECISION_KEYS.has(key));
}

export function invalidateAuthorizationsForConfigChange(rows = [], updates = {}, revision = null) {
  const changedKeys = decisionAffectingConfigKeys(updates);
  if (!changedKeys.length) return { invalidated: 0, changedKeys };
  let invalidated = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object" || !row.symbol) continue;
    if (row.authorizedDecisionValid === true || row.approved === true || row.backendApproved === true) {
      invalidated += 1;
    }
    Object.assign(row, {
      authorizedDecisionValid: false,
      approved: false,
      backendApproved: false,
      autoTradeApproved: false,
      qualifiedToBuy: false,
      buyableNow: false,
      rescoreStatus: "QUEUED",
      rescoreReason: "DECISION_CONFIGURATION_CHANGED",
      authorizationInvalidatedByConfigRevision: revision,
      authorizationInvalidatedConfigKeys: changedKeys,
    });
  }
  return { invalidated, changedKeys };
}
