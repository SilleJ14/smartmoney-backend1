import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

// Execute the actual TS helpers without mounting the app or contacting its
// trading backend. This contract suite runs when the sibling app is present.
let api;
try {
  const requireFrontend = createRequire(new URL("../../package.json", import.meta.url));
  const ts = requireFrontend("typescript");
  const source = fs.readFileSync(new URL("../../app/(tabs)/index.tsx", import.meta.url), "utf8");
  const names = new Set([
    "num", "normalizeSymbol", "isCryptoSymbol", "parseSignalTimestamp",
    "getDecisionTimestamp", "isQuoteOnlySignal", "isLiveScoreSignal",
    "hasFreshIncomingDecision", "hasFreshIncomingQuote", "mergeSignalByFreshness",
    "getCurrentSpreadAgeSeconds", "getLiveQuoteStatus", "hasFreshUiExecutionEvidence",
    "sweepSignalUiFreshness", "hasMeasuredNumber", "inferAvailability",
    "compareExplicitDecisionRecency",
    "getBestTradeAmount", "hasExplicitUiApproval", "asWatchOnlySignal",
  ]);
  const ast = ts.createSourceFile("index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(functions.length, names.size, "all tested helpers must exist");
  const js = ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  api = vm.createContext({ Date, LIVE_FRESH_SECONDS: 5, LIVE_STALE_SECONDS: 180,
    QUOTE_ONLY_SIGNAL_MARKER: "__smartmoneyQuoteOnly", LIVE_SCORE_SIGNAL_MARKER: "__smartmoneyLiveScore" });
  vm.runInContext(js, api);
  let preserve;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "preserveSignals") preserve = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(preserve);
  Object.assign(api, { getStableSignalKey: (s) => s.symbol, compareSignalsByCanonicalDecision: () => 0,
    SIGNAL_EXPIRE_SECONDS: 180, snapshotStartedAt: Date.now() });
  vm.runInContext(ts.transpileModule(`globalThis.preserveSignals = ${preserve}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, api);
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND" && error.code !== "ENOENT") throw error;
}
const options = { skip: !api && "sibling Expo source/dependencies unavailable" };

test("phone freshness expires at 5.001 seconds with one state change", options, () => {
  const now = Date.now();
  const item = { symbol: "BTC/USD", priceIsLive: true, spreadAvailable: true, liveSpreadFresh: true,
    uiExecutionFresh: true, liveQuoteUpdatedAt: new Date(now - 5000).toISOString(),
    spreadUpdatedAt: new Date(now).toISOString() };
  const rows = [item];
  assert.equal(api.getLiveQuoteStatus(item, now).isFresh, true);
  assert.equal(api.sweepSignalUiFreshness(rows, now), rows);
  const expired = api.sweepSignalUiFreshness(rows, now + 1);
  assert.equal(expired[0].uiExecutionFresh, false);
  assert.equal(api.sweepSignalUiFreshness(expired, now + 1000), expired);
});

test("phone merges newer bid-ask independently without changing F or approval", options, () => {
  const now = Date.now();
  const old = { symbol: "BTC/USD", price: 100, displayPrice: 100, livePrice: 100,
    liveQuoteUpdatedAt: new Date(now).toISOString(), spreadUpdatedAt: new Date(now - 4000).toISOString(),
    bid: 99, ask: 101, spreadPercent: 2, spreadAvailable: true, liveSpreadFresh: true,
    cryptoDecisionScore: 80, cryptoDecisionScoreAvailable: true, approved: false, raw: {} };
  const incoming = { ...old, liveQuoteUpdatedAt: new Date(now - 1000).toISOString(),
    spreadUpdatedAt: new Date(now - 1).toISOString(), bid: 99.9, ask: 100.1, spreadPercent: 0.2,
    cryptoDecisionScore: 99, approved: true, raw: { __smartmoneyQuoteOnly: true } };
  const merged = api.mergeSignalByFreshness(old, incoming, now);
  assert.equal(merged.spreadPercent, 0.2);
  assert.equal(merged.liveQuoteUpdatedAt, old.liveQuoteUpdatedAt);
  assert.equal(merged.cryptoDecisionScore, 80);
  assert.equal(merged.approved, false);
});

test("phone preserves explicit unavailable measurements and orders decisions by recency", options, () => {
  assert.equal(api.inferAvailability(false, 85), false);
  assert.equal(api.inferAvailability(true, 0), true);
  const old = { raw: { approved: true, decisionUpdatedAt: "2026-09-01T14:00:00Z" } };
  const next = { raw: { approved: false, decisionUpdatedAt: "2026-09-01T14:01:00Z" } };
  assert.equal(api.compareExplicitDecisionRecency(old, next), 1);
  assert.equal(api.compareExplicitDecisionRecency(next, old), -1);
});

test("live-score refresh cannot make an old approval newer than a rejection", options, () => {
  const now = Date.now();
  const old = { approved: true, backendApproved: true, autoTradeApproved: true, qualifiedToBuy: true,
    raw: { approved: true, decisionUpdatedAt: new Date(now - 10000).toISOString(), liveScoreUpdatedAt: new Date(now).toISOString() } };
  const rejected = { ...old, approved: false, raw: { approved: false, decisionUpdatedAt: new Date(now - 1000).toISOString() } };
  assert.equal(api.compareExplicitDecisionRecency(old, rejected), 1);
  assert.equal(api.compareExplicitDecisionRecency(rejected, old), -1);
});

test("full refresh and forced merges cannot restore delayed approval", options, () => {
  const now = Date.now();
  const rejected = { symbol: "AAPL", approved: false, backendApproved: false, raw: { approved: false, decisionUpdatedAt: new Date(now).toISOString() } };
  const delayed = { ...rejected, approved: true, backendApproved: true, qualifiedToBuy: true, autoTradeApproved: true,
    raw: { approved: true, decisionUpdatedAt: new Date(now - 1000).toISOString() } };
  assert.equal(api.mergeSignalByFreshness(rejected, delayed, now, true).approved, false);
  assert.equal(api.preserveSignals([delayed], [rejected])[0].approved, false);
});

test("phone applies explicit spread revocation without recycling the old pair", options, () => {
  const now = Date.now();
  const old = { symbol: "BTC/USD", price: 100, livePrice: 100, displayPrice: 100,
    liveQuoteUpdatedAt: new Date(now - 1000).toISOString(), spreadUpdatedAt: new Date(now - 1000).toISOString(),
    bid: 99, ask: 101, spreadAvailable: true, raw: {} };
  const next = { ...old, bid: null, ask: null, spreadAvailable: false, spreadUpdatedAt: null,
    liveQuoteUpdatedAt: new Date(now).toISOString(), raw: { spreadAvailable: false, __smartmoneyQuoteOnly: true } };
  const merged = api.mergeSignalByFreshness(old, next, now);
  assert.equal(merged.spreadAvailable, false);
  assert.equal(merged.bid, null);
});

test("bounded snapshot omission does not hide a freshly streamed candidate", options, () => {
  api.snapshotStartedAt = Date.now() - 100;
  const rows = api.preserveSignals([], [{ symbol: "NEW", lastSeenAt: Date.now(), approved: true, raw: {} }]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].expired, true);
  assert.equal(rows[0].approved, true);
  const olderRows = api.preserveSignals([], [{ symbol: "OLD", lastSeenAt: Date.now() - 1000, approved: true, raw: {} }]);
  assert.equal(olderRows[0].approved, false);
  assert.equal(olderRows[0].finalStockExecutionApproved, false);
});

test("phone requires all four flags and respects failed aggregate execution", options, () => {
  const full = { approved: true, backendApproved: true, qualifiedToBuy: true, autoTradeApproved: true,
    raw: { decisionUpdatedAt: new Date().toISOString() } };
  assert.equal(api.hasExplicitUiApproval(full), true);
  assert.equal(api.hasExplicitUiApproval({ ...full, qualifiedToBuy: false, finalStockExecutionApproved: true }), false);
  assert.equal(api.hasExplicitUiApproval({ ...full, raw: { executionEligibility: { approved: false } } }), false);
  assert.equal(api.getBestTradeAmount({ recommendedTradeAmount: 0, rawRecommendedTradeAmount: 125, raw: { recommendedTradeAmount: 125 } }), 0);
  assert.equal(api.getBestTradeAmount({ recommendedTradeAmount: 100, decisionUpdatedAt: "new", sizingDecisionUpdatedAt: "old" }), 0);
});
