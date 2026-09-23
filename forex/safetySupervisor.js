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
      pendingOrders = null,
      historyLoaded,
      forexAutoEnabled,
      clockOk = true,
      entryPauseRequested,
    } = {}) {
      const durable = store?.isDurable?.() === true;
      const statuses = {
        analysisReady: false,
        executionReady: false,
        autoTradingAuthorized: false,
        incidentLockActive: false,
        pauseEntries: entryPauseRequested === true,
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
      let uncertain = false;
      const accountId = accountSnapshot?.id;
      try {
        await store.commit((ledger) => {
          if (!ledger.owner) {
            ledger.owner = { instanceId, accountId, at: new Date().toISOString() };
          } else if (ledger.owner.instanceId !== instanceId) {
            throw Object.assign(new Error("NOT_EXECUTION_OWNER"), { reason: "NOT_EXECUTION_OWNER" });
          }
          ingestTransactions(ledger, accountId, transactions);
          if (historyLoaded) ledger.fillSchemaVersion = 1;
          missedOk = true;
          ledger.lastTransactionId[accountId] = Number(lastTransactionId || ledger.lastTransactionId[accountId] || 0);
          incident = Boolean(ledger.incidentLocks[accountId]);
          if (typeof entryPauseRequested === "boolean") ledger.pauseEntries[accountId] = entryPauseRequested;
          pause = Boolean(ledger.pauseEntries[accountId]);
          uncertain = ledger.intents.some((row) => row.accountId === accountId && ["INTENT_SAVED", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"].includes(row.state));
          const knownIds = new Set(ledger.fills.filter((row) => row.accountId === accountId && row.intentId).map((row) => String(row.brokerTradeId)));
          for (const trade of openTrades) {
            const check = protectionVerified(trade, {});
            if (!check.ok) {
              protectionOk = false;
              ledger.protection.push({ tradeId: trade.id, reason: check.reason, at: new Date().toISOString() });
            }
            if (!knownIds.has(String(trade.id)) && !ledger.intents.some((intent) => intent.accountId === accountId && String(intent.brokerTradeId) === String(trade.id))) {
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
        && !uncertain
        && lastTransactionId != null
        && !incident
        && Array.isArray(pendingOrders)
        && !pendingOrders.some((order) => !["STOP_LOSS", "GUARANTEED_STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP_LOSS"].includes(order.type));
      statuses.autoTradingAuthorized = statuses.executionReady && forexAutoEnabled === true && !pause;
      const halt = uncertain ? "UNCERTAIN_ORDER" : !Array.isArray(pendingOrders)
        ? "PENDING_ORDERS_UNVERIFIED"
        : pendingOrders.some((order) => !["STOP_LOSS", "GUARANTEED_STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP_LOSS"].includes(order.type))
          ? "PENDING_ENTRY_ORDERS"
        : !protectionOk
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
