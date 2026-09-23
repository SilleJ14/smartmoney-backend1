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
    consumedAmount: consumed ?? 0,
    pendingReservations: pending ?? 0,
    remainingCapacity: remaining ?? 0,
    locks: locks || [],
  };
}

export function positionContract(trade = {}) {
  return {
    quantity: trade.currentUnits,
    direction: Number(trade.currentUnits) > 0 ? "long" : Number(trade.currentUnits) < 0 ? "short" : "flat",
    entry: trade.price,
    valuation: trade.unrealizedPL,
    protectionStatus: trade.stopLossOrder ? "VERIFIED" : "MISSING",
    account: trade.accountId,
    brokerTradeId: trade.id,
  };
}
