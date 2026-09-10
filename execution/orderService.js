function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return number;
}

function requireStockHoldCategory(value, symbol) {
  const category = String(value || "").trim().toLowerCase();
  if (!['intraday', 'multi_day'].includes(category)) {
    throw new Error(`Stock order holding category is required for ${symbol || 'stock'}`);
  }
  return category;
}

export function createOrderService({
  tradingRequest,
  normalizeSymbol,
  clientOrderPrefix = "SM_AI",
  now = () => Date.now(),
  duplicateOrderGuard,
  preTradeRiskGuard,
  onOrderSubmitted,
  reserveRisk,
  executionLifecycle,
  isCrypto = () => false,
}) {
  let buyQueue = Promise.resolve();
  function submit(payload, options = {}) {
    if (executionLifecycle) return executionLifecycle.exclusive(() => submitNow(payload, options));
    if (payload.side !== 'buy') return submitNow(payload, options);
    const work = buyQueue.then(() => submitNow(payload, options));
    buyQueue = work.catch(() => {});
    return work;
  }
  async function submitNow(payload, options = {}) {
    const position = await executionLifecycle?.beforeSubmit(payload, options);
    const release = duplicateOrderGuard
      ? await duplicateOrderGuard.reserve(payload, options)
      : () => {};
    let riskReservation;
    let submitted = false;
    try {
      // Slow broker duplicate lookups must precede the final authorization.
      const authorization = preTradeRiskGuard ? await preTradeRiskGuard.assertAllowed(payload, options) : null;
      if (payload.side === 'buy' && reserveRisk) riskReservation = await reserveRisk(payload, options);
      authorization?.assertCurrent?.();
      executionLifecycle?.submitting(payload, options, position);
      submitted = true;
      const result = await tradingRequest("/v2/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await executionLifecycle?.submitted({ payload, options, result });
      if (typeof onOrderSubmitted === "function") {
        await onOrderSubmitted({ payload, options, result });
      }
      release({ success: true });
      await riskReservation?.settle?.({ result });
      return result;
    } catch (error) {
      executionLifecycle?.failed({ payload, error, submitted });
      release({ success: false });
      await riskReservation?.settle?.({ error, notSubmitted: !submitted });
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
    }, { reason });
  }

  function stockBuy({
    symbol,
    dollars,
    score = 0,
    marketOpen,
    fractionable,
    referencePrice,
    allowExistingOpenOrder = false,
    holdCategory,
  }) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (marketOpen !== true) {
      throw new Error(
        `${cleanSymbol || "Stock"} order blocked: stocks trade only while the regular market is open`
      );
    }
    const cleanHoldCategory = requireStockHoldCategory(holdCategory, cleanSymbol);
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

    if (fractionable && cleanHoldCategory !== 'multi_day') {
      return submit(
        { ...payload, notional: cleanNotional, type: "market" },
        { allowExistingOpenOrder, holdCategory: cleanHoldCategory }
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
    }, { allowExistingOpenOrder, holdCategory: cleanHoldCategory });
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
    return submit({ ...payload, type: "market" }, { reason });
  }

  function manualStockBuy({
    symbol,
    dollars,
    shares,
    buyMode = "dollars",
    fractionable,
    referencePrice,
    holdCategory,
    marketOpen,
    requireCandidateDecision = false,
  }) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (!cleanSymbol) throw new Error("Missing symbol");
    if (marketOpen !== true) {
      throw new Error(
        `${cleanSymbol} order blocked: stocks trade only while the regular market is open`
      );
    }
    const cleanHoldCategory = requireStockHoldCategory(holdCategory, cleanSymbol);
    const payload = {
      symbol: cleanSymbol,
      side: "buy",
      type: "market",
      time_in_force: "day",
      client_order_id: `${clientOrderPrefix}_MANUAL_BUY_${cleanSymbol}_${now()}`,
    };

    if (buyMode === "shares") {
      const shareAmount = positiveNumber(shares, "share amount");
      if (cleanHoldCategory === 'multi_day' && !Number.isInteger(shareAmount)) {
        throw new Error('Multi-day stocks require whole shares for persistent broker-held protection');
      }
      if (!fractionable && Math.floor(shareAmount) < 1) {
        throw new Error(`${cleanSymbol} is not fractionable. Enter at least 1 whole share.`);
      }
      return submit({
        ...payload,
        qty: fractionable ? String(shareAmount) : String(Math.floor(shareAmount)),
      }, { automated: false, requireCandidateDecision, holdCategory: cleanHoldCategory });
    }

    const amount = positiveNumber(dollars, "dollar amount");
    if (amount < 1) throw new Error("Invalid dollar amount");
    if (fractionable && cleanHoldCategory !== 'multi_day') {
      return submit(
        { ...payload, notional: Number(amount.toFixed(2)) },
        { automated: false, requireCandidateDecision, holdCategory: cleanHoldCategory }
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
    return submit(
      { ...payload, qty: String(estimatedShares) },
      { automated: false, requireCandidateDecision, holdCategory: cleanHoldCategory }
    );
  }

  async function closePosition(symbol) {
    const cleanSymbol = normalizeSymbol(symbol);
    if (!cleanSymbol) throw new Error("Missing symbol");
    if (executionLifecycle) return submit({ symbol: cleanSymbol, side: 'sell', qty: Infinity,
      type: 'market', time_in_force: isCrypto(cleanSymbol) ? 'gtc' : 'day',
      client_order_id: `${clientOrderPrefix}_CLOSE_${cleanSymbol}_${now()}` }, { reason: 'MANUAL_CLOSE' });
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
