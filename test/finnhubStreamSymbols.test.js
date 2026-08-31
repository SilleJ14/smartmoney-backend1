import test from "node:test";
import assert from "node:assert/strict";
import {
  fromFinnhubStreamSymbol,
  isAppCryptoSymbol,
  toFinnhubStreamSymbol,
} from "../live/finnhubStreamSymbols.js";

test("Finnhub stock stream symbols remain unchanged", () => {
  assert.equal(toFinnhubStreamSymbol("AAPL"), "AAPL");
  assert.equal(fromFinnhubStreamSymbol("AAPL"), "AAPL");
  assert.equal(isAppCryptoSymbol("AAPL"), false);
});

test("Finnhub crypto stream symbols map to and from app symbols", () => {
  assert.equal(isAppCryptoSymbol("BTC/USD"), true);
  assert.equal(toFinnhubStreamSymbol("BTC/USD"), "BINANCE:BTCUSDT");
  assert.equal(fromFinnhubStreamSymbol("BINANCE:BTCUSDT"), "BTC/USD");
});

test("Finnhub crypto mapping supports configured exchanges and quote currencies", () => {
  const options = { exchange: "COINBASE", quoteCurrency: "USD" };
  assert.equal(toFinnhubStreamSymbol("ETH/USD", options), "COINBASE:ETHUSD");
  assert.equal(fromFinnhubStreamSymbol("COINBASE:ETHUSD", options), "ETH/USD");
  assert.equal(fromFinnhubStreamSymbol("BINANCE:ETHUSDT", options), "");
});
