// Crypto quote currency verification against an independent reference trade.
//
// Alpaca's crypto venue is quiet: a coin's best bid/ask can stay unchanged for
// tens of seconds, so its PROVIDER timestamp ages although the quote is still
// the current one. A fresh Coinbase trade close to the Alpaca mid proves the
// quote is still current at the reference trade time. This module never
// mutates or re-stamps Alpaca provider timestamps; it produces a separate,
// fail-closed verification record that crypto freshness gates may consult.
// Stocks and forex never use it.

export const CRYPTO_REFERENCE_POLICY = Object.freeze({
  version: "CRYPTO_REFERENCE_V1",
  referenceSource: "coinbase_exchange_matches",
  // The reference trade (provider time) and its receipt must both be recent.
  maxReferenceAgeMs: 5000,
  // Clock-skew allowance for provider times that appear in the future.
  maxFutureMs: 1000,
  // |reference - Alpaca mid| / Alpaca mid, in percent.
  maxDeviationPercent: 0.3,
  // An unchanged Alpaca quote/book older than this is never verified.
  maxAlpacaQuoteAgeMs: 60000,
  maxAlpacaBookAgeMs: 60000,
  // A verification counts as fresh evidence for this long after verifiedAt.
  verifiedWindowMs: 5000,
});

export function referenceTimeMs(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 8.64e15 ? parsed : NaN;
}

function symbolKey(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function firstPositive(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

// The Alpaca bid/ask a verification binds to, read exactly as the verifier
// reads them. Every coverage check passes these same values back in.
export function cryptoQuoteTop(source = {}) {
  return {
    bid: firstPositive(source?.bid, source?.bp, source?.bidPrice),
    ask: firstPositive(source?.ask, source?.ap, source?.askPrice),
  };
}

// Best bid / best ask of an order book (levels {p, s}; positive size only).
// A missing, empty or crossed book has no top and can never be covered.
export function cryptoBookTop(book = null) {
  if (!book || typeof book !== "object") return { bid: null, ask: null };
  const best = (rows, better) => {
    let found = null;
    for (const row of Array.isArray(rows) ? rows : []) {
      const price = Number(row?.p ?? row?.price);
      const size = Number(row?.s ?? row?.size);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0) continue;
      found = found === null ? price : better(found, price);
    }
    return found;
  };
  const bid = best(book.bids ?? book.b, Math.max);
  const ask = best(book.asks ?? book.a, Math.min);
  return bid !== null && ask !== null && bid <= ask ? { bid, ask } : { bid: null, ask: null };
}

function topValid(top) {
  return Number.isFinite(top?.bid) && Number.isFinite(top?.ask) && top.bid > 0 && top.ask >= top.bid;
}

function checkAlpacaTime(name, value, maxAgeMs, now, reasons) {
  const at = referenceTimeMs(value);
  if (!Number.isFinite(at)) {
    reasons.push(`ALPACA_${name}_TIME_INVALID`);
    return NaN;
  }
  if (at > now + CRYPTO_REFERENCE_POLICY.maxFutureMs) reasons.push(`ALPACA_${name}_TIME_FUTURE`);
  else if (now - at > maxAgeMs) reasons.push(`ALPACA_${name}_TOO_OLD`);
  return at;
}

// verified only if ALL hold; anything missing or malformed fails closed.
// `bookBid`/`bookAsk` are the attached book's best levels: a book is covered
// only together with the exact top it had when it was checked.
export function verifyCryptoQuoteCurrent({
  symbol,
  bid,
  ask,
  quoteProviderAtMs,
  spreadProviderAtMs,
  bookProviderAtMs,
  bookBid = null,
  bookAsk = null,
  reference,
  now = Date.now(),
} = {}) {
  const policy = CRYPTO_REFERENCE_POLICY;
  const reasons = [];
  const nowMs = Number(now);
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  if (!Number.isFinite(nowMs)) reasons.push("NOW_INVALID");
  if (!cleanSymbol) reasons.push("SYMBOL_MISSING");

  let referencePrice = null;
  let referenceTradeAtMs = NaN;
  let referenceReceivedAtMs = NaN;
  if (!reference || typeof reference !== "object") {
    reasons.push("REFERENCE_MISSING");
  } else {
    if (reference.symbol != null && symbolKey(reference.symbol) !== symbolKey(cleanSymbol)) {
      reasons.push("REFERENCE_SYMBOL_MISMATCH");
    }
    const price = Number(reference.price);
    if (!Number.isFinite(price) || price <= 0) reasons.push("REFERENCE_PRICE_INVALID");
    else referencePrice = price;
    referenceTradeAtMs = referenceTimeMs(reference.tradeAt);
    referenceReceivedAtMs = referenceTimeMs(reference.receivedAt);
    if (!Number.isFinite(referenceTradeAtMs)) reasons.push("REFERENCE_TIME_INVALID");
    else if (referenceTradeAtMs > nowMs + policy.maxFutureMs) reasons.push("REFERENCE_TIME_FUTURE");
    else if (nowMs - referenceTradeAtMs > policy.maxReferenceAgeMs) reasons.push("REFERENCE_STALE");
    if (!Number.isFinite(referenceReceivedAtMs)) reasons.push("REFERENCE_RECEIPT_TIME_INVALID");
    else if (referenceReceivedAtMs > nowMs + policy.maxFutureMs) reasons.push("REFERENCE_RECEIPT_TIME_FUTURE");
    else if (nowMs - referenceReceivedAtMs > policy.maxReferenceAgeMs) reasons.push("REFERENCE_RECEIPT_STALE");
  }

  const bidValue = Number(bid);
  const askValue = Number(ask);
  const bidAskValid = Number.isFinite(bidValue) && Number.isFinite(askValue) && bidValue > 0 && bidValue <= askValue;
  if (!bidAskValid) reasons.push("ALPACA_BID_ASK_INVALID");
  const alpacaMid = bidAskValid ? (bidValue + askValue) / 2 : null;

  const quoteAt = checkAlpacaTime("QUOTE", quoteProviderAtMs, policy.maxAlpacaQuoteAgeMs, nowMs, reasons);
  const spreadInvolved = spreadProviderAtMs !== undefined && spreadProviderAtMs !== null;
  const spreadAt = spreadInvolved
    ? checkAlpacaTime("SPREAD", spreadProviderAtMs, policy.maxAlpacaQuoteAgeMs, nowMs, reasons)
    : NaN;
  const bookInvolved = bookProviderAtMs !== undefined && bookProviderAtMs !== null;
  const bookAt = bookInvolved
    ? checkAlpacaTime("BOOK", bookProviderAtMs, policy.maxAlpacaBookAgeMs, nowMs, reasons)
    : NaN;

  let deviationPct = null;
  if (alpacaMid !== null && referencePrice !== null) {
    deviationPct = (Math.abs(referencePrice - alpacaMid) / alpacaMid) * 100;
    if (!(deviationPct <= policy.maxDeviationPercent)) reasons.push("REFERENCE_DEVIATION_EXCEEDED");
  }

  const verified = reasons.length === 0;
  const verifiedAtMs = verified ? Math.min(referenceTradeAtMs, nowMs) : null;
  // Coverage is bound to the checked VALUES, not only to the provider
  // millisecond: a different bid/ask (or book top) carrying the same
  // timestamp is not covered. A book without a valid top is never covered.
  const bookTop = { bid: Number(bookBid), ask: Number(bookAsk) };
  // A book is covered only when it describes the same market as the verified
  // quote: the reference is within the deviation limit of the book mid, and the
  // book's best ask is within that limit of the quote's ask. A superseded book
  // (different top) keeps its own provider age.
  const bookMid = topValid(bookTop) ? (bookTop.bid + bookTop.ask) / 2 : null;
  const bookMatchesQuote = bookMid !== null && referencePrice !== null &&
    (Math.abs(referencePrice - bookMid) / bookMid) * 100 <= policy.maxDeviationPercent &&
    (Math.abs(bookTop.ask - askValue) / askValue) * 100 <= policy.maxDeviationPercent;
  const coveredEvidence = verified ? [
    { kind: "quote", at: quoteAt, bid: bidValue, ask: askValue },
    ...(spreadInvolved ? [{ kind: "spread", at: spreadAt, bid: bidValue, ask: askValue }] : []),
    ...(bookInvolved && topValid(bookTop) && bookMatchesQuote ? [{ kind: "book", at: bookAt, bid: bookTop.bid, ask: bookTop.ask }] : []),
  ] : [];
  return {
    version: policy.version,
    source: policy.referenceSource,
    symbol: cleanSymbol || null,
    verified,
    verifiedAtMs,
    verifiedAt: verified ? new Date(verifiedAtMs).toISOString() : null,
    checkedAtMs: Number.isFinite(nowMs) ? nowMs : null,
    referencePrice,
    referenceTradeAtMs: finiteOrNull(referenceTradeAtMs),
    referenceReceivedAtMs: finiteOrNull(referenceReceivedAtMs),
    referenceAgeMs: Number.isFinite(referenceTradeAtMs) && Number.isFinite(nowMs) ? nowMs - referenceTradeAtMs : null,
    referenceReceiptAgeMs: Number.isFinite(referenceReceivedAtMs) && Number.isFinite(nowMs) ? nowMs - referenceReceivedAtMs : null,
    alpacaBid: bidAskValid ? bidValue : null,
    alpacaAsk: bidAskValid ? askValue : null,
    alpacaMid,
    deviationPct: deviationPct === null ? null : Number(deviationPct.toFixed(6)),
    maxDeviationPct: policy.maxDeviationPercent,
    quoteProviderAtMs: finiteOrNull(quoteAt),
    spreadProviderAtMs: finiteOrNull(spreadAt),
    bookProviderAtMs: finiteOrNull(bookAt),
    // Only these exact Alpaca provider timestamps, each together with the
    // bid/ask (or book top) checked at that time, are covered by this record.
    coveredEvidence,
    coveredProviderAtMs: coveredEvidence.map((entry) => entry.at),
    reasons,
  };
}

// Convenience extraction from a signal / cached quote. The signal's own
// Alpaca evidence fields are read; nothing on the signal is changed.
export function verifyCryptoSignalAgainstReference(signal = {}, reference = null, {
  now = Date.now(),
  includeBook = true,
  symbol = signal?.symbol,
} = {}) {
  const spreadRaw = signal?.spreadUpdatedAt ?? signal?.bidAskUpdatedAt;
  const book = includeBook ? signal?.cryptoOrderbook : null;
  const bookObject = book && typeof book === "object" ? book : null;
  const top = cryptoQuoteTop(signal);
  const bookTop = cryptoBookTop(bookObject);
  return verifyCryptoQuoteCurrent({
    symbol,
    bid: top.bid,
    ask: top.ask,
    quoteProviderAtMs: signal?.liveQuoteUpdatedAt,
    spreadProviderAtMs: spreadRaw === undefined || spreadRaw === null || spreadRaw === "" ? undefined : spreadRaw,
    bookProviderAtMs: bookObject ? (bookObject.updatedAt ?? NaN) : undefined,
    bookBid: bookTop.bid,
    bookAsk: bookTop.ask,
    reference,
    now,
  });
}

// True when `verification` is a valid, still-fresh record that covers this
// exact Alpaca provider timestamp WITH these exact values (`bid`/`ask`: the
// quote's bid/ask, or the book's top for kind "book"), and that timestamp is
// within the 60 s cap. `kind` ("quote" | "spread" | "book"), when given, must
// match too. Missing values never match: callers must pass what they check.
export function cryptoReferenceCovers({ providerAtMs, verification, now = Date.now(), symbol = null,
  bid = null, ask = null, kind = null } = {}) {
  const policy = CRYPTO_REFERENCE_POLICY;
  const provider = referenceTimeMs(providerAtMs);
  const nowMs = Number(now);
  if (!verification || typeof verification !== "object") return false;
  if (verification.verified !== true || verification.version !== policy.version) return false;
  if (!Number.isFinite(provider) || !Number.isFinite(nowMs)) return false;
  const verifiedAt = Number(verification.verifiedAtMs);
  if (verification.verifiedAtMs === null || !Number.isFinite(verifiedAt)) return false;
  if (symbol !== null && symbol !== undefined && symbolKey(symbol) !== symbolKey(verification.symbol)) return false;
  const sinceVerified = nowMs - verifiedAt;
  if (sinceVerified > policy.verifiedWindowMs || sinceVerified < -policy.maxFutureMs) return false;
  if (nowMs - provider > policy.maxAlpacaQuoteAgeMs) return false;
  const values = { bid: bid === null || bid === undefined || bid === "" ? NaN : Number(bid),
    ask: ask === null || ask === undefined || ask === "" ? NaN : Number(ask) };
  if (!topValid(values)) return false;
  const covered = Array.isArray(verification.coveredEvidence) ? verification.coveredEvidence : [];
  return covered.some((entry) => entry && typeof entry === "object" &&
    Number(entry.at) === provider &&
    (kind === null || kind === undefined || entry.kind === kind) &&
    Number(entry.bid) === values.bid &&
    Number(entry.ask) === values.ask);
}

// The one shared crypto freshness helper. With a valid covering verification
// the age is the time since verification, but never more than the provider
// age (a covered provider time newer than verifiedAt keeps its own, smaller
// age); otherwise it is the provider age. Null when the provider time is
// missing or invalid. Pass the checked `bid`/`ask` (and `kind`) as for
// cryptoReferenceCovers.
export function effectiveCryptoEvidenceAgeMs({ providerAtMs, verification = null, now = Date.now(), symbol = null,
  bid = null, ask = null, kind = null } = {}) {
  const provider = referenceTimeMs(providerAtMs);
  const nowMs = Number(now);
  if (!Number.isFinite(provider) || !Number.isFinite(nowMs)) return null;
  const providerAgeMs = nowMs - provider;
  return cryptoReferenceCovers({ providerAtMs: provider, verification, now: nowMs, symbol, bid, ask, kind })
    ? Math.min(providerAgeMs, nowMs - Number(verification.verifiedAtMs))
    : providerAgeMs;
}

export function effectiveCryptoEvidenceAtMs(options = {}) {
  const nowMs = Number(options.now ?? Date.now());
  const age = effectiveCryptoEvidenceAgeMs({ ...options, now: nowMs });
  return age === null ? null : nowMs - age;
}

// A crypto price is live when the provider marked it live, or when a fresh
// reference verification covers its exact provider timestamp and bid/ask.
export function cryptoPriceLiveOrVerified(signal = {}, { now = Date.now(), verification = signal?.cryptoReferenceVerification } = {}) {
  if (signal?.priceIsLive === true) return true;
  return cryptoReferenceCovers({ providerAtMs: signal?.liveQuoteUpdatedAt, verification, now, symbol: signal?.symbol,
    ...cryptoQuoteTop(signal), kind: "quote" });
}

function positiveIncrement(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function withinIncrement(a, b, increment) {
  // Decimal prices in binary floating point: allow rounding noise only.
  const tolerance = increment * 1e-9 + Math.max(Math.abs(a), Math.abs(b)) * 1e-12;
  return Math.abs(a - b) <= increment + tolerance;
}

// The final guard re-reads Alpaca's order book. A cached Alpaca quote that a
// reference verification calls current is still Alpaca's latest only if that
// fresh book does not supersede it: the book's provider time is not later than
// the quote's bid/ask provider time, OR the book's best bid and best ask equal
// the quote's bid/ask within one price increment. Anything else, or anything
// missing (no book, invalid times or tops, unknown increment), fails closed.
export function assessCryptoQuoteSupersession({ quote = {}, book = null, priceIncrement = null } = {}) {
  const quoteTop = cryptoQuoteTop(quote);
  const spreadRaw = quote?.spreadUpdatedAt || quote?.bidAskUpdatedAt || null;
  const quoteAtMs = referenceTimeMs(spreadRaw);
  const bookObject = book && typeof book === "object" ? book : null;
  const bookAtMs = referenceTimeMs(bookObject?.updatedAt);
  const bookTop = cryptoBookTop(bookObject);
  const increment = positiveIncrement(priceIncrement);
  const detail = {
    quoteBid: quoteTop.bid, quoteAsk: quoteTop.ask, quoteAtMs: finiteOrNull(quoteAtMs),
    bookBid: bookTop.bid, bookAsk: bookTop.ask, bookAtMs: finiteOrNull(bookAtMs), priceIncrement: increment,
  };
  const result = (superseded, reason) => ({ superseded, reason, ...detail });
  if (!bookObject) return result(true, "FRESH_ALPACA_BOOK_UNAVAILABLE");
  if (!topValid(quoteTop)) return result(true, "QUOTE_BID_ASK_INVALID");
  if (Number.isFinite(bookAtMs) && Number.isFinite(quoteAtMs) && bookAtMs <= quoteAtMs) {
    return result(false, "FRESH_BOOK_NOT_NEWER_THAN_QUOTE");
  }
  if (!topValid(bookTop)) return result(true, "FRESH_ALPACA_BOOK_TOP_INVALID");
  if (increment === null) return result(true, "PRICE_INCREMENT_UNAVAILABLE");
  if (withinIncrement(bookTop.bid, quoteTop.bid, increment) && withinIncrement(bookTop.ask, quoteTop.ask, increment)) {
    return result(false, "FRESH_BOOK_TOP_MATCHES_QUOTE");
  }
  return result(true, Number.isFinite(bookAtMs) ? "FRESH_ALPACA_BOOK_TOP_DIFFERS" : "FRESH_ALPACA_BOOK_TIME_INVALID");
}

export function summarizeCryptoReferenceVerification(verification = null) {
  if (!verification || typeof verification !== "object") return null;
  return {
    version: verification.version || null,
    verified: verification.verified === true,
    verifiedAt: verification.verifiedAt || null,
    referencePrice: verification.referencePrice ?? null,
    deviationPct: verification.deviationPct ?? null,
    referenceAgeMs: verification.referenceAgeMs ?? null,
    reasons: Array.isArray(verification.reasons) ? verification.reasons.slice(0, 8) : [],
  };
}
