import { protectionVerified } from "./protection.js";

export function capitalSummaryContract(account = {}, freshness = {}) {
  return {
    accountId: account.id || null,
    environment: account.environment || "practice",
    currency: account.currency || null,
    balance: account.balance ?? null,
    equity: account.NAV ?? null,
    marginUsed: account.marginUsed ?? null,
    marginAvailable: account.marginAvailable ?? null,
    unrealizedPL: account.unrealizedPL ?? null,
    freshness,
  };
}

export function autoTradeLimitsContract({ configured, consumed, pending, remaining, locks } = {}) {
  return {
    limitType: "FOREX_ACCOUNT_RISK",
    configuredCeiling: configured ?? null,
    consumedAmount: consumed ?? null,
    pendingReservations: pending ?? 0,
    remainingCapacity: remaining ?? 0,
    locks: locks || [],
  };
}

export function positionContract(trade = {}) {
  return {
    symbol: String(trade.instrument || "").replace("_", "/"),
    instrument: trade.instrument,
    assetClass: "forex",
    broker: "oanda",
    status: Number(trade.currentUnits) !== 0 ? "OPEN" : "CLOSED",
    qty: Math.abs(Number(trade.currentUnits)),
    avg_entry_price: Number(trade.price),
    current_price: trade.currentPrice ?? null,
    unrealized_pl: Number(trade.unrealizedPL),
    quantity: trade.currentUnits,
    direction: Number(trade.currentUnits) > 0 ? "long" : Number(trade.currentUnits) < 0 ? "short" : "flat",
    entry: trade.price,
    valuation: trade.unrealizedPL,
    protectionStatus: protectionVerified(trade).ok ? "VERIFIED" : "MISSING",
    account: trade.accountId,
    brokerTradeId: trade.id,
  };
}
