export function operatingStatus({
  connected,
  analysisReady,
  executionReady,
  autoTradingAuthorized,
  forexAutoEnabled,
  incidentLockActive,
  halt,
} = {}) {
  const requested = forexAutoEnabled === true;
  const execute = executionReady === true && autoTradingAuthorized === true && incidentLockActive !== true;
  let executionLabel = "BLOCKED";
  if (execute) executionLabel = "READY";
  else if (executionReady) executionLabel = "READY_BUT_NOT_AUTHORIZED";
  return {
    connected: connected === true,
    analyzing: analysisReady === true,
    authorizedToTrade: autoTradingAuthorized === true,
    ableToExecute: execute,
    requestedAuto: requested,
    incidentLockActive: incidentLockActive === true,
    halt: halt || null,
    label: `Autopilot requested: ${requested ? "ON" : "OFF"}; execution: ${executionLabel}`,
  };
}

export const TASK_PRIORITY = Object.freeze({
  PROTECTION: 0,
  RECONCILE: 1,
  CLOSE: 2,
  SUBMIT: 3,
  MARKET_DATA: 4,
  DISCOVERY: 5,
});
