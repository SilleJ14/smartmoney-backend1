function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return number;
}

export function createOrderService({
  tradingRequest,
  normalizeSymbol,
  clientOrderPrefix = "SM_AI",
  now = () => Date.now(),
  duplicateOrderGuard,
  preTradeRiskGuard,
  onOrderSubmitted,
}) {
  async function submit(payload, options = {}) {
    if (preTradeRiskGuard) {
      await preTradeRiskGuard.assertAllowed(payload, options);
    }
    const release = duplicateOrderGuard
      ? await duplicateOrderGuard.reserve(payload, options)
      : () => {};
    try {
      const result = await tradingRequest("/v2/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (typeof onOrderSubmitted === "function") {
        onOrderSubmitted({ payload, options, result });
      }
      release({ success: true });
      return result;
    } catch (error) {
      release({ success: false });
      throw error;
    }
  }

  function cryptoMarketBuy({ symbol, dollars, allowExistingOpenOrder = false }) {
    const cleanSymbol = normalizeSymbol(symbol);
    const amount = positiveNumber(dollars, "crypto buy amount");
    return submit({
      symbol: cleanSymbol,
      notional: Number(amount.toFixed(2)),
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      client_order_id: `${clientOrderPrefix}_CRYPTO_BUY_${cleanSymbol}_${now()}`,
    }, { allowExistingOpenOrder, holdCategory: "crypto" });
  }

  function cryptoMarketSell({ symbol, qty, reason = "CRYPTO_EXIT" }) {
    const cleanSymbol = normalizeSymbol(symbol);
    const cleanQty = positiveNumber(qty, `sell quantity for ${cleanSymbol}`);
    return submit({
      symbol: cleanSymbol,
      qty: String(cleanQty),
      side: "sell",
      type: "market",
      time_in_force: "gtc",
      client_order_id: `${clientOrderPrefix}_${reason}_${cleanSymbol}_${now()}`,
    });
  }

  function stockBuy({
    symbol,
    dollars,
    score = 0,
    marketOpen,
    fractionable,
    referencePrice,
    allowExistingOpenOrder = false,
    holdCategory = "intraday",
  }) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (marketOpen !== true) {
      throw new Error(
        `${cleanSymbol || "Stock"} order blocked: stocks trade only while the regular market is open`
      );
    }
    const cleanNotional = Math.max(
      1,
      Number(positiveNumber(dollars, `buy amount for ${cleanSymbol}`).toFixed(2))
    );
    const price = positiveNumber(referencePrice, `buy price for ${cleanSymbol}`);
    const payload = {
      symbol: cleanSymbol,
      side: "buy",
      time_in_force: "day",
      client_order_id:
        `${clientOrderPrefix}_BUY_${cleanSymbol}_${Math.round(score)}_${now()}`,
    };

    if (fractionable) {
      return submit(
        { ...payload, notional: cleanNotional, type: "market" },
        { allowExistingOpenOrder, holdCategory }
      );
    }

    const qty = Math.floor(cleanNotional / price);
    if (qty < 1) {
      throw new Error(
        `${cleanSymbol} is not fractionable or requires whole-share buying. ` +
        `$${cleanNotional} is not enough for 1 share at about $${price}.`
      );
    }
    return submit({
      ...payload,
      qty: String(qty),
      type: "market",
    }, { allowExistingOpenOrder, holdCategory });
  }

  function stockSell({
    symbol,
    qty,
    reason = "AI_EXIT",
    marketOpen,
    fractionable,
  }) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (marketOpen !== true) {
      throw new Error(
        `${cleanSymbol || "Stock"} order blocked: stocks trade only while the regular market is open`
      );
    }
    const rawQty = positiveNumber(qty, `sell quantity for ${cleanSymbol}`);
    const cleanQty = fractionable ? Number(rawQty.toFixed(8)) : Math.floor(rawQty);
    if (cleanQty <= 0) throw new Error(`Invalid sell quantity for ${cleanSymbol}`);

    const payload = {
      symbol: cleanSymbol,
      qty: String(cleanQty),
      side: "sell",
      time_in_force: "day",
      client_order_id:
        `${clientOrderPrefix}_SELL_${cleanSymbol}_${reason}_${now()}`,
    };
    return submit({ ...payload, type: "market" });
  }

  function manualStockBuy({
    symbol,
    dollars,
    shares,
    buyMode = "dollars",
    fractionable,
    referencePrice,
    holdCategory = "intraday",
    marketOpen,
  }) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (!cleanSymbol) throw new Error("Missing symbol");
    if (marketOpen !== true) {
      throw new Error(
        `${cleanSymbol} order blocked: stocks trade only while the regular market is open`
      );
    }
    const payload = {
      symbol: cleanSymbol,
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: `${clientOrderPrefix}_MANUAL_BUY_${cleanSymbol}_${now()}`,
    };

    if (buyMode === "shares") {
      const shareAmount = positiveNumber(shares, "share amount");
      if (!fractionable && Math.floor(shareAmount) < 1) {
        throw new Error(`${cleanSymbol} is not fractionable. Enter at least 1 whole share.`);
      }
      return submit({
        ...payload,
        qty: fractionable ? String(shareAmount) : String(Math.floor(shareAmount)),
      }, { automated: false, holdCategory });
    }

    const amount = positiveNumber(dollars, "dollar amount");
    if (amount < 1) throw new Error("Invalid dollar amount");
    if (fractionable) {
      return submit(
        { ...payload, notional: Number(amount.toFixed(2)) },
        { automated: false, holdCategory }
      );
    }

    const price = positiveNumber(referencePrice, `price for ${cleanSymbol}`);
    const estimatedShares = Math.floor(amount / price);
    if (estimatedShares < 1) {
      throw new Error(
        `${cleanSymbol} is not fractionable. Enter enough dollars for at least ` +
        "1 whole share or use share mode."
      );
    }
    return submit({ ...payload, qty: String(estimatedShares) }, { automated: false, holdCategory });
  }

  async function closePosition(symbol) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (!cleanSymbol) throw new Error("Missing symbol");
    const release = duplicateOrderGuard
      ? await duplicateOrderGuard.reserve({ symbol: cleanSymbol, side: "sell" })
      : () => {};
    try {
      const result = await tradingRequest(
        `/v2/positions/${encodeURIComponent(cleanSymbol)}`,
        { method: "DELETE" }
      );
      release({ success: true });
      return result;
    } catch (error) {
      release({ success: false });
      throw error;
    }
  }

  return {
    cryptoMarketBuy,
    cryptoMarketSell,
    stockBuy,
    stockSell,
    manualStockBuy,
    closePosition,
  };
}
