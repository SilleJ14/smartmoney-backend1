import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCryptoOrderbookRefresher } from "../market-data/cryptoOrderbookRefresh.js";
import { attachCryptoExecutionShadow } from "../scoring/cryptoExecutionEconomics.js";

const book = (symbol, at = Date.now(), price = 100) => ({ symbol, source: "alpaca_crypto_orderbook", location: "us",
  updatedAt: new Date(at).toISOString(), asks: [{ p: price * 1.0005, s: 10000 }], bids: [{ p: price * 0.9995, s: 10000 }] });
const coin = (symbol, F, extra = {}) => ({ symbol, masterFinalScore: F, cryptoSetup: { eligible: true },
  price: 100, intendedNotional: 25, ...extra });
const deps = (overrides = {}) => {
  const requested = [];
  return {
    requested,
    refresher: createCryptoOrderbookRefresher({
      getLatestOrderbooks: async (symbols) => { requested.push(symbols); return symbols.map((s) => book(s)); },
      normalizeSymbol: (s) => String(s || "").toUpperCase(),
      isCrypto: (s) => String(s).includes("/"),
      getCanonicalFinalScore: (s) => s.masterFinalScore ?? null,
      attachShadow: attachCryptoExecutionShadow,
      ...overrides,
    }),
  };
};

test("refreshes books for the top setup-eligible coins only, highest score first, capped", async () => {
  const { refresher, requested } = deps();
  const coins = Array.from({ length: 25 }, (_, i) => coin(`C${i}/USD`, i));
  const rows = [...coins, coin("AAPL", 99), coin("SKIP/USD", 98, { cryptoSetup: { eligible: false } })];
  await refresher(rows);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].length, 20);
  assert.equal(requested[0][0], "C24/USD");
  assert.ok(!requested[0].includes("AAPL") && !requested[0].includes("SKIP/USD"));
});

test("a stale book becomes fresh execution evidence on every collection holding the coin", async () => {
  const { refresher } = deps();
  const stale = coin("BTC/USD", 80, { cryptoOrderbook: book("BTC/USD", Date.now() - 30_000) });
  attachCryptoExecutionShadow(stale);
  assert.ok(stale.cryptoExecutionEconomics.reasons.includes("ORDER_BOOK_STALE"));
  const copy = { ...stale };
  const attached = await refresher([stale], [[stale], [copy], null]);
  assert.equal(attached, 2);
  for (const row of [stale, copy]) {
    assert.ok(Date.now() - Date.parse(row.cryptoOrderbook.updatedAt) < 5000);
    assert.equal(row.cryptoExecutionEconomics.reasons.includes("ORDER_BOOK_STALE"), false,
      JSON.stringify(row.cryptoExecutionEconomics.reasons));
  }
});

test("a provider's own old timestamp still counts as stale after a refresh", async () => {
  const { refresher } = deps({ getLatestOrderbooks: async (symbols) => symbols.map((s) => book(s, Date.now() - 60_000)) });
  const quiet = coin("QUIET/USD", 70);
  await refresher([quiet]);
  assert.ok(quiet.cryptoExecutionEconomics.reasons.includes("ORDER_BOOK_STALE"));
});

test("a failed book request leaves candidates untouched and reports the error", async () => {
  const errors = [];
  const { refresher } = deps({ getLatestOrderbooks: async () => { throw new Error("Alpaca down"); }, onError: (e) => errors.push(e.message) });
  const row = coin("BTC/USD", 80, { cryptoOrderbook: book("BTC/USD", Date.now() - 30_000) });
  const before = row.cryptoOrderbook;
  assert.equal(await refresher([row]), 0);
  assert.equal(row.cryptoOrderbook, before);
  assert.deepEqual(errors, ["Alpaca down"]);
});

test("books still fresh by provider time are not fetched again", async () => {
  const { refresher, requested } = deps();
  const fresh = coin("BTC/USD", 90, { cryptoOrderbook: book("BTC/USD", Date.now() - 200) });
  const old = coin("ETH/USD", 80, { cryptoOrderbook: book("ETH/USD", Date.now() - 4000) });
  const none = coin("SOL/USD", 70);
  await refresher([fresh, old, none]);
  assert.deepEqual(requested, [["ETH/USD", "SOL/USD"]]);
});

test("failures back off instead of retrying every run, and success resets", async () => {
  let clock = 1_000_000, fail = true, calls = 0;
  const errors = [];
  const { refresher } = deps({
    now: () => clock,
    getLatestOrderbooks: async (symbols) => { calls += 1; if (fail) throw Object.assign(new Error("429"), { retryAfterMs: 0 }); return symbols.map((s) => book(s, clock)); },
    onError: (e, info) => errors.push(info),
  });
  const rows = () => [coin("BTC/USD", 90)];
  await refresher(rows());
  assert.equal(calls, 1);
  clock += 2000; await refresher(rows());
  assert.equal(calls, 1, "still inside the 5 s backoff");
  clock += 4000; await refresher(rows());
  assert.equal(calls, 2);
  clock += 5000; await refresher(rows());
  assert.equal(calls, 2, "second failure doubles the backoff to 10 s");
  assert.equal(errors.length, 1, "a failure streak logs once, not every run");
  fail = false; clock += 6000;
  const row = coin("BTC/USD", 90);
  assert.equal(await refresher([row]), 1);
  assert.equal(calls, 3);
  clock += 2000; await refresher([coin("ETH/USD", 80)]);
  assert.equal(calls, 4, "success resets the backoff");
});

test("the bot cycle fetches books in parallel with prices and rebuilds the permission shadow", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function refreshCryptoExecutionQuotes("), source.indexOf("const refreshCryptoExecutionQuotesOnly"));
  assert.match(body, /Promise\.all\(\[\s*refreshCryptoExecutionQuotesOnly\(signals\),\s*refreshTopCryptoOrderbooks\.fetchBooks\(signals\),/);
  assert.match(body, /signal\.cryptoAnalyticalShadow = buildCryptoDecisionScore\(signal\)\.cryptoAnalyticalShadow/);
  assert.ok(source.includes("runLiveScheduledTask('refreshTopCryptoOrderbooks', 2000"));
});
