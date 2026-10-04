// Price-protected crypto buys. A marketable LIMIT order capped a fixed
// percentage above the Alpaca ask seen at the final pre-trade guard replaces
// the former notional MARKET order, so a fill can never be worse than the cap.
//
// Alpaca facts relied on (https://docs.alpaca.markets/docs/crypto-orders,
// https://docs.alpaca.markets/reference/postorder,
// https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id):
// - crypto supports market, limit and stop_limit orders;
// - crypto time_in_force is gtc or ioc;
// - `notional` "can only work for market order types", so a limit order is
//   sent with `qty` (up to 9 decimals), never with `notional`;
// - assets expose decimal-string min_order_size, min_trade_increment and
//   price_increment for crypto.
export const CRYPTO_LIMIT_BUY_POLICY = Object.freeze({
  type: "limit",
  // IOC: whatever cannot fill immediately at or below the cap is canceled by
  // Alpaca, so a price-protected buy never rests on the book.
  timeInForce: "ioc",
  maxPriceAboveAskPercent: 0.5,
  maxQtyDecimals: 9,
});

function decimalsOf(step) {
  const text = String(step).trim().toLowerCase();
  const [mantissa, exponent] = text.split("e");
  const fraction = (mantissa.split(".")[1] || "").replace(/0+$/, "").length;
  const shift = exponent === undefined ? 0 : Number(exponent);
  return Math.max(0, fraction - shift);
}

function positiveDecimal(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Largest multiple of `step` that is <= value (decimal-exact output string).
// Binary floating point can put an exact decimal product (100 * 1.005) a hair
// below its true value; a 1e-12 relative tolerance keeps such a boundary.
const FLOAT_TOLERANCE = 1e-12;
export function floorToIncrement(value, step) {
  const number = Number(value);
  const increment = positiveDecimal(step);
  if (!Number.isFinite(number) || number <= 0 || increment === null) return null;
  const decimals = Math.min(18, decimalsOf(step));
  const ceiling = number * (1 + FLOAT_TOLERANCE);
  let steps = Math.floor(number / increment);
  if ((steps + 1) * increment <= ceiling) steps += 1;
  while (steps > 0 && Number((steps * increment).toFixed(decimals)) > ceiling) steps -= 1;
  if (steps <= 0) return { value: 0, text: (0).toFixed(decimals), decimals };
  const text = (steps * increment).toFixed(decimals);
  return { value: Number(text), text, decimals };
}

export function buildCryptoLimitBuyOrder({
  symbol,
  notional,
  ask,
  asset = {},
  clientOrderId,
  maxPriceAboveAskPercent = CRYPTO_LIMIT_BUY_POLICY.maxPriceAboveAskPercent,
  timeInForce = CRYPTO_LIMIT_BUY_POLICY.timeInForce,
} = {}) {
  const reasons = [];
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  const amount = Number(notional);
  const askPrice = Number(ask);
  const priceIncrement = positiveDecimal(asset?.price_increment);
  const qtyIncrement = positiveDecimal(asset?.min_trade_increment);
  const minOrderSize = asset?.min_order_size === undefined || asset?.min_order_size === null || asset?.min_order_size === ""
    ? null : Number(asset.min_order_size);
  const capPercent = Number(maxPriceAboveAskPercent);
  if (!cleanSymbol) reasons.push("CRYPTO_LIMIT_SYMBOL_MISSING");
  if (!clientOrderId) reasons.push("CRYPTO_LIMIT_CLIENT_ORDER_ID_MISSING");
  if (!Number.isFinite(amount) || amount <= 0) reasons.push("CRYPTO_LIMIT_NOTIONAL_INVALID");
  if (!Number.isFinite(askPrice) || askPrice <= 0) reasons.push("CRYPTO_LIMIT_ASK_UNAVAILABLE");
  if (priceIncrement === null) reasons.push("CRYPTO_PRICE_INCREMENT_UNAVAILABLE");
  if (qtyIncrement === null) reasons.push("CRYPTO_MIN_TRADE_INCREMENT_UNAVAILABLE");
  if (minOrderSize === null || !Number.isFinite(minOrderSize) || minOrderSize < 0) reasons.push("CRYPTO_MIN_ORDER_SIZE_UNAVAILABLE");
  if (!Number.isFinite(capPercent) || capPercent < 0 || capPercent > 0.5) reasons.push("CRYPTO_LIMIT_CAP_POLICY_INVALID");
  if (!["ioc", "gtc"].includes(timeInForce)) reasons.push("CRYPTO_TIME_IN_FORCE_INVALID");
  if (qtyIncrement !== null && decimalsOf(asset.min_trade_increment) > CRYPTO_LIMIT_BUY_POLICY.maxQtyDecimals) {
    reasons.push("CRYPTO_QTY_PRECISION_UNSUPPORTED");
  }
  if (asset && asset.symbol && String(asset.symbol).toUpperCase().replace(/[^A-Z0-9]/g, "") !== cleanSymbol.replace(/[^A-Z0-9]/g, "")) {
    reasons.push("CRYPTO_ASSET_SYMBOL_MISMATCH");
  }
  if (asset?.tradable === false || (asset?.status && asset.status !== "active")) reasons.push("CRYPTO_ASSET_NOT_TRADABLE");
  if (reasons.length) return { ok: false, reasons };

  const limit = floorToIncrement(askPrice * (1 + capPercent / 100), asset.price_increment);
  if (!limit || !(limit.value > 0)) return { ok: false, reasons: ["CRYPTO_LIMIT_PRICE_INVALID"] };
  // A cap below the ask would not be marketable; IOC would just cancel.
  if (limit.value < askPrice) return { ok: false, reasons: ["CRYPTO_LIMIT_PRICE_BELOW_ASK"], limitPrice: limit.value, ask: askPrice };
  const qty = floorToIncrement(amount / limit.value, asset.min_trade_increment);
  if (!qty || !(qty.value > 0) || qty.value < minOrderSize) {
    return { ok: false, reasons: ["CRYPTO_ORDER_BELOW_MIN_SIZE"], limitPrice: limit.value, qty: qty?.value ?? 0, minOrderSize };
  }
  const maxSpend = qty.value * limit.value;
  // After rounding, the worst-case spend never exceeds the approved amount.
  if (!(maxSpend <= amount + 1e-9)) return { ok: false, reasons: ["CRYPTO_LIMIT_EXCEEDS_APPROVED_AMOUNT"] };
  return {
    ok: true,
    reasons: [],
    ask: askPrice,
    limitPrice: limit.value,
    qty: qty.value,
    maxSpend: Math.floor(maxSpend * 1e8) / 1e8,
    notional: amount,
    priceIncrement: String(asset.price_increment),
    minTradeIncrement: String(asset.min_trade_increment),
    minOrderSize,
    maxPriceAboveAskPercent: capPercent,
    payload: {
      symbol: cleanSymbol,
      qty: qty.text,
      side: "buy",
      type: CRYPTO_LIMIT_BUY_POLICY.type,
      limit_price: limit.text,
      time_in_force: timeInForce,
      client_order_id: clientOrderId,
    },
  };
}

// Defense in depth inside the order service: the final payload must be a
// qty-based IOC/GTC limit for the same symbol/identity, priced at or below
// the cap of the ask that authorized it, and never above the approved amount.
export function assertCryptoLimitBuyPayload(intent = {}, priced = {}) {
  const payload = priced?.payload;
  const fail = (reason) => { throw new Error(`CRYPTO_LIMIT_ORDER_REJECTED: ${reason}`); };
  if (!priced || priced.ok !== true || !payload) fail("price-protected limit order unavailable");
  if (payload.notional !== undefined) fail("notional cannot be combined with a limit order");
  if (payload.type !== "limit" || payload.side !== "buy") fail("payload must be a limit buy");
  if (!["ioc", "gtc"].includes(payload.time_in_force)) fail("crypto time_in_force must be ioc or gtc");
  if (String(payload.symbol) !== String(intent.symbol) || payload.client_order_id !== intent.client_order_id) fail("identity changed");
  const qty = Number(payload.qty);
  const limit = Number(payload.limit_price);
  const ask = Number(priced.ask);
  const amount = Number(intent.notional);
  if (!(qty > 0) || !(limit > 0) || !(ask > 0) || !(amount > 0)) fail("invalid qty, limit, ask or amount");
  if (limit > ask * (1 + CRYPTO_LIMIT_BUY_POLICY.maxPriceAboveAskPercent / 100) * (1 + 1e-9)) fail("limit exceeds the ask cap");
  if (qty * limit > amount + 1e-9) fail("worst-case spend exceeds the approved amount");
  return payload;
}
