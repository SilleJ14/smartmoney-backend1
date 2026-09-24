// Only forex state is changed. Reset never clears unrelated incident locks.
export async function resetForexDailyLoss({ store, client, now = Date.now() }) {
  if (!store.isDurable()) throw new Error('DURABLE_STORAGE_UNAVAILABLE');
  const payload = await client.getAccount();
  const account = payload?.account;
  const equity = Number(account?.NAV);
  if (!account?.id || !Number.isFinite(equity) || equity <= 0) throw new Error('FOREX_ACCOUNT_UNAVAILABLE');
  await store.commit(ledger => {
    const key = account.id;
    ledger.dayStart[key] = { date: new Date(now).toISOString().slice(0, 10), equity,
      adjustedEquity: equity, at: new Date(now).toISOString(), cursor: String(account.lastTransactionID || '0') };
    delete ledger.dailyLoss[key];
    if (ledger.incidentLocks[key]?.reason === 'DAILY_LOSS_LOCK') delete ledger.incidentLocks[key];
    ledger.audits.push({ type: 'MANUAL_DAILY_LOSS_RESET', accountId: key, equity, at: new Date(now).toISOString() });
  });
}

export function validateForexSettings(body, state) {
  if (typeof body?.forexAutoEnabled !== 'boolean' || typeof body?.forexEmergencyStopActive !== 'boolean')
    throw new Error('Forex ON/OFF settings are required.');
  if (state.forexEmergencyStopActive && !body.forexEmergencyStopActive && body.confirmRelease !== true)
    throw new Error('Confirm release of the forex emergency stop.');
  if (body.resetDailyLoss === true && body.confirmReset !== true) throw new Error('Confirm the forex daily-loss reset.');
  if (body.forexAutoEnabled && body.forexEmergencyStopActive) throw new Error('Release the forex emergency stop first.');
  if (body.forexAutoEnabled && state.forexDailyLossLocked && !body.resetDailyLoss)
    throw new Error('Reset the forex daily-loss lock before enabling Autotrade.');
  return { forexAutoEnabled: body.forexAutoEnabled, forexEmergencyStopActive: body.forexEmergencyStopActive };
}
