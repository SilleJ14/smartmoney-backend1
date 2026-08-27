function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function orderValue(order, price) {
  if (finiteNumber(order?.notional) > 0) return finiteNumber(order.notional);
  return finiteNumber(order?.qty) * finiteNumber(price);
}

export function evaluatePreTradeRisk({ order = {}, context = {}, options = {} } = {}) {
  const side = String(order.side || "").toLowerCase();
  const symbol = String(order.symbol || "").trim().toUpperCase();
  const isBuy = side === "buy";
  const isSell = side === "sell";
  const reasons = [];

  if (!symbol) reasons.push("Missing symbol");
  if (!isBuy && !isSell) reasons.push("Invalid order side");
  if (finiteNumber(order.qty) <= 0 && finiteNumber(order.notional) <= 0) {
    reasons.push("Order has no positive quantity or notional");
  }

  if (isBuy) {
    const price = finiteNumber(context.price);
    const quoteAgeSeconds = finiteNumber(context.quoteAgeSeconds, Infinity);
    const spreadPercent = finiteNumber(context.spreadPercent);
    const spreadAvailable = context.spreadAvailable === true || (
      context.spreadAvailable !== false &&
      context.spreadPercent !== null &&
      context.spreadPercent !== undefined &&
      context.spreadPercent !== "" &&
      Number.isFinite(Number(context.spreadPercent))
    );
    const value = orderValue(order, price);
    const equity = finiteNumber(context.account?.equity || context.account?.portfolio_value);
    const exposure = (context.positions || []).reduce(
      (sum, position) => sum + Math.abs(finiteNumber(position.market_value)),
      0
    );
    const maxExposure = equity * (finiteNumber(context.maxExposurePercent) / 100);

    if (context.emergencyStopActive) reasons.push("Emergency stop is active");
    if (!context.realCashTradingUnlocked) reasons.push("Real cash trading is locked");
    if (options.automated !== false && !context.autoTradingEnabled) {
      reasons.push("Auto trading is disabled");
    }
    if (context.dailyLossLocked) reasons.push("Daily loss lock is active");
    if (context.profitLocked) reasons.push("Profit lock is active");
    if (!context.isCrypto && !context.marketOpen) reasons.push("Stock market is closed");
    if (price <= 0) reasons.push("Missing valid live price");
    if (!context.quoteIsLive) reasons.push("Quote is not from a live source");
    if (!spreadAvailable) reasons.push("Live bid/ask spread is unavailable");
    if (quoteAgeSeconds > finiteNumber(context.maxQuoteAgeSeconds, 5)) {
      reasons.push(`Live quote stale: ${quoteAgeSeconds}s old`);
    }
    if (spreadPercent > finiteNumber(context.maxSpreadPercent, 2.5)) {
      reasons.push(`Spread too wide: ${spreadPercent}%`);
    }
    if (context.requireLiveProvider && !context.liveProviderConnected) {
      reasons.push("Required live market-data provider is disconnected");
    }
    if (equity <= 0) reasons.push("Broker equity is unavailable");
    if (value <= 0) reasons.push("Order value cannot be calculated");
    if (maxExposure > 0 && exposure + value > maxExposure) {
      reasons.push(
        `Maximum bot exposure exceeded: ${Number((exposure + value).toFixed(2))} > ` +
        `${Number(maxExposure.toFixed(2))}`
      );
    }
    if (
      finiteNumber(context.maxOpenTrades) > 0 &&
      (context.positions || []).length >= finiteNumber(context.maxOpenTrades) &&
      !(context.positions || []).some(
        (position) => String(position.symbol || "").toUpperCase() === symbol
      )
    ) {
      reasons.push("Maximum open-trade count reached");
    }
    if (context.liveTradeLimitDecision?.approved === false) {
      reasons.push(...context.liveTradeLimitDecision.reasons);
    }
  }

  return {
    approved: reasons.length === 0,
    symbol,
    side: side.toUpperCase(),
    reasons,
    checkedAt: new Date().toISOString(),
  };
}

export function assertPreTradeRisk(input) {
  const result = evaluatePreTradeRisk(input);
  if (!result.approved) {
    throw new Error(`Pre-trade risk blocked ${result.side} ${result.symbol}: ${result.reasons.join("; ")}`);
  }
  return result;
}
