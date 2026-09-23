import { ingestTransactions } from "./fills.js";
import { protectionVerified, missingProtectionResponse } from "./protection.js";
import { operatingStatus } from "./monitoring.js";

export function createSafetySupervisor({ store, instanceId = "local" } = {}) {
  return {
    async recover({
      credentialsOk,
      accountSnapshot,
      lastTransactionId,
      transactions = [],
      openTrades = [],
      pendingOrders = [],
      historyLoaded,
      forexAutoEnabled,
      clockOk = true,
    } = {}) {
      const durable = store?.isDurable?.() === true;
      const statuses = {
        analysisReady: false,
        executionReady: false,
        autoTradingAuthorized: false,
        incidentLockActive: false,
        pauseEntries: false,
        connected: credentialsOk === true && Boolean(accountSnapshot),
      };
      if (!credentialsOk) {
        return { ...statuses, halt: "MISSING_CREDENTIALS", operating: operatingStatus({ ...statuses, forexAutoEnabled }) };
      }
      if (!durable) {
        statuses.analysisReady = Boolean(accountSnapshot && historyLoaded);
        return {
          ...statuses,
          halt: statuses.analysisReady ? "CLEAR" : "DURABLE_STORAGE_UNAVAILABLE",
          operating: operatingStatus({ ...statuses, forexAutoEnabled, halt: "DURABLE_STORAGE_UNAVAILABLE" }),
        };
      }
      if (!clockOk) {
        return { ...statuses, halt: "CLOCK_SKEW", operating: operatingStatus({ ...statuses, forexAutoEnabled, halt: "CLOCK_SKEW" }) };
      }

      let missedOk = false;
      let protectionOk = true;
      let unexplained = false;
      let incident = false;
      let pause = false;
      const accountId = accountSnapshot?.id;
      try {
        await store.commit((ledger) => {
          if (!ledger.owner) {
            ledger.owner = { instanceId, accountId, at: new Date().toISOString() };
          } else if (ledger.owner.instanceId !== instanceId) {
            throw Object.assign(new Error("NOT_EXECUTION_OWNER"), { reason: "NOT_EXECUTION_OWNER" });
          }
          ingestTransactions(ledger, accountId, transactions);
          missedOk = true;
          ledger.lastTransactionId[accountId] = Number(lastTransactionId || ledger.lastTransactionId[accountId] || 0);
          incident = Boolean(ledger.incidentLocks[accountId]);
          pause = Boolean(ledger.pauseEntries[accountId]);
          const knownIds = new Set(ledger.fills.map((row) => String(row.brokerTradeId)));
          for (const trade of openTrades) {
            const check = protectionVerified(trade, {});
            if (!check.ok) {
              protectionOk = false;
              ledger.protection.push({ tradeId: trade.id, reason: check.reason, at: new Date().toISOString() });
            }
            if (!knownIds.has(String(trade.id)) && !ledger.intents.some((intent) => intent.brokerTradeId === trade.id)) {
              unexplained = true;
              ledger.unexplained.push({ tradeId: trade.id, instrument: trade.instrument, units: trade.currentUnits });
            }
          }
          if (incident) statuses.incidentLockActive = true;
        });
      } catch (error) {
        return {
          ...statuses,
          halt: error.reason || "DURABLE_STORAGE_UNAVAILABLE",
          operating: operatingStatus({ ...statuses, forexAutoEnabled, halt: error.reason }),
        };
      }

      statuses.incidentLockActive = incident;
      statuses.pauseEntries = pause;
      statuses.analysisReady = historyLoaded === true;
      statuses.executionReady = statuses.analysisReady
        && missedOk
        && protectionOk
        && !unexplained
        && lastTransactionId != null
        && !incident
        && pendingOrders != null;
      statuses.autoTradingAuthorized = statuses.executionReady && forexAutoEnabled === true && !pause;
      const halt = !protectionOk
        ? "MISSING_PROTECTION"
        : unexplained
          ? "UNEXPLAINED_POSITION"
          : statuses.executionReady
            ? "CLEAR"
            : "EXECUTION_NOT_READY";
      return {
        ...statuses,
        halt,
        missingProtection: protectionOk ? null : missingProtectionResponse(),
        operating: operatingStatus({ ...statuses, forexAutoEnabled, halt }),
      };
    },
  };
}
