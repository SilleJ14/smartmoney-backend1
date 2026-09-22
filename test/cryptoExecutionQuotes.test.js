import test from "node:test";
import assert from "node:assert/strict";
import { mergeLiveQuoteEvidence } from "../live/liveQuoteCache.js";
import {
  applyTradeTickWithoutClearingAlpacaBook,
  cryptoQuoteHasFreshAlpacaBook,
  isAlpacaCryptoExecutionSource,
  selectAlpacaCryptoStreamSymbols,
  selectCryptoRestQuoteBatch,
} from "../live/cryptoExecutionQuotes.js";

const now = Date.parse("2026-09-20T11:15:00.000Z");
const freshStamp = new Date(now - 1000).toISOString();
const alpacaBook = {
  price: 100,
  current: 100,
  bid: 99.9,
  ask: 100.1,
  spreadAvailable: true,
  spreadSource: "alpaca_crypto_ws",
  liveQuoteSource: "alpaca_crypto_ws",
  source: "alpaca_crypto_ws",
  liveQuoteUpdatedAt: freshStamp,
  spreadUpdatedAt: freshStamp,
  bidAskUpdatedAt: freshStamp,
  priceIsLive: true,
};

test("only Alpaca crypto sources count as executable quotes", () => {
  assert.equal(isAlpacaCryptoExecutionSource("alpaca_crypto_ws"), true);
  assert.equal(isAlpacaCryptoExecutionSource("alpaca_crypto_latest"), true);
  assert.equal(isAlpacaCryptoExecutionSource("finnhub_ws_trade"), false);
});

test("stream slots go to held names and names that still need an Alpaca book", () => {
  const selected = selectAlpacaCryptoStreamSymbols({
    symbols: ["USDT/USD", "BTC/USD", "ETH/USD", "DOGE/USD"],
    quotes: { "BTC/USD": alpacaBook },
    scores: { "USDT/USD": 40, "BTC/USD": 90, "ETH/USD": 80, "DOGE/USD": 70 },
    heldSymbols: ["DOGE/USD"],
    limit: 2,
    now,
  });
  assert.deepEqual(selected, ["DOGE/USD", "ETH/USD"]);
});

test("already subscribed coins stay pinned instead of rotating off the socket", () => {
  const selected = selectAlpacaCryptoStreamSymbols({
    symbols: ["USDT/USD", "BTC/USD", "ETH/USD", "DOGE/USD"],
    quotes: { "BTC/USD": alpacaBook },
    scores: { "USDT/USD": 40, "BTC/USD": 90, "ETH/USD": 80, "DOGE/USD": 70 },
    heldSymbols: [],
    pinnedSymbols: ["BTC/USD", "USDT/USD"],
    limit: 2,
    now,
  });
  assert.deepEqual(selected, ["BTC/USD", "USDT/USD"]);
});

test("REST snapshots stream coins whose Alpaca book is stale", () => {
  const first = selectCryptoRestQuoteBatch({
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "DOT/USD", "LINK/USD"],
    streamSymbols: ["BTC/USD", "ETH/USD"],
    quotes: {},
    batchSize: 3,
    cursor: 0,
    now,
    streamConnected: true,
  });
  assert.deepEqual(first.symbols, ["BTC/USD", "ETH/USD", "SOL/USD"]);
  const second = selectCryptoRestQuoteBatch({
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "DOT/USD", "LINK/USD"],
    streamSymbols: ["BTC/USD", "ETH/USD"],
    quotes: {},
    batchSize: 3,
    cursor: first.nextCursor,
    now,
    streamConnected: true,
  });
  assert.deepEqual(second.symbols, ["XRP/USD", "ADA/USD", "DOT/USD"]);
});

test("REST skips coins that already have a fresh Alpaca book", () => {
  const batch = selectCryptoRestQuoteBatch({
    symbols: ["BTC/USD", "ETH/USD", "SOL/USD"],
    streamSymbols: ["BTC/USD"],
    quotes: { "BTC/USD": alpacaBook },
    batchSize: 3,
    cursor: 0,
    now,
    streamConnected: true,
  });
  assert.deepEqual(batch.symbols, ["ETH/USD", "SOL/USD"]);
});

test("a Finnhub last trade keeps the Alpaca bid and ask", () => {
  const incoming = applyTradeTickWithoutClearingAlpacaBook(alpacaBook, {
    price: 101,
    liveQuoteSource: "finnhub_ws_trade",
    source: "finnhub_ws_trade",
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    priceIsLive: true,
    eventType: "trade",
  });
  assert.equal(incoming.liveQuoteSource, "alpaca_crypto_ws");
  assert.equal(incoming.price, 100);
  assert.equal(incoming.lastTradePrice, 101);
  assert.equal(incoming.bid, 99.9);
  assert.equal(incoming.ask, 100.1);
  const merged = mergeLiveQuoteEvidence(alpacaBook, incoming, {
    price: incoming.price,
    quoteUpdatedAt: incoming.liveQuoteUpdatedAt,
    quoteSource: incoming.liveQuoteSource,
  });
  assert.equal(merged.bid, 99.9);
  assert.equal(merged.ask, 100.1);
  assert.equal(merged.spreadSource, "alpaca_crypto_ws");
  assert.equal(merged.spreadPreservedFromPrevious, true);
  assert.equal(cryptoQuoteHasFreshAlpacaBook({ ...alpacaBook, ...merged }, { now, maxAgeSeconds: 5 }), true);
});

test("a last trade does not invent a book when Alpaca never supplied one", () => {
  const incoming = applyTradeTickWithoutClearingAlpacaBook({}, {
    price: 101,
    liveQuoteSource: "finnhub_ws_trade",
    source: "finnhub_ws_trade",
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    priceIsLive: true,
    eventType: "trade",
    spreadAvailable: false,
  });
  assert.equal(incoming.spreadAvailable, false);
  assert.equal(incoming.liveQuoteSource, "finnhub_ws_trade");
  const merged = mergeLiveQuoteEvidence({}, incoming, {
    price: incoming.price,
    quoteUpdatedAt: incoming.liveQuoteUpdatedAt,
    quoteSource: incoming.liveQuoteSource,
  });
  assert.equal(merged.bid, 0);
  assert.equal(merged.ask, 0);
  assert.equal(merged.spreadAvailable, false);
});

test("a later non-trade quote can still withdraw a measured book", () => {
  const merged = mergeLiveQuoteEvidence(alpacaBook, {
    liveQuoteSource: "alpaca_crypto_latest",
    source: "alpaca_crypto_latest",
    spreadAvailable: false,
    liveQuoteUpdatedAt: new Date(now).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString(),
  }, {
    price: 100,
    quoteUpdatedAt: new Date(now).toISOString(),
    quoteSource: "alpaca_crypto_latest",
  });
  assert.equal(merged.bid, 0);
  assert.equal(merged.spreadAvailable, false);
  assert.equal(merged.spreadPreservedFromPrevious, false);
});
