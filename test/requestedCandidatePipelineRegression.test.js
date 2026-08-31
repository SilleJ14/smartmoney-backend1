import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const engineCycleSource = fs.readFileSync(
  new URL("../engine/createEngineCycle.js", import.meta.url),
  "utf8"
);
const cryptoScannerSource = fs.readFileSync(
  new URL("../strategies/cryptoMarketScanner.js", import.meta.url),
  "utf8"
);
const frontendPath = new URL("../../app/(tabs)/index.tsx", import.meta.url);
const frontendSource = fs.existsSync(frontendPath)
  ? fs.readFileSync(frontendPath, "utf8")
  : null;
const frontendTestOptions = {
  skip: frontendSource === null
    ? "frontend source is validated in the app repository"
    : false,
};

test("every automated stock market-buy path supplies a holding category", () => {
  const calls = [...serverSource.matchAll(/await placeMarketBuy\(/g)];
  assert.equal(calls.length, 4);
  for (const call of calls) {
    const callWindow = serverSource.slice(call.index, call.index + 650);
    assert.match(callWindow, /holdCategory:/);
  }
  assert.match(serverSource, /Stock order holding category is required/);
});

test("live WebSocket feeds never substitute receipt time for provider time", () => {
  for (const [startName, endName] of [
    ["function handlePolygonLiveMessage", "function startPolygonStockStream"],
  ]) {
    const block = serverSource.slice(serverSource.indexOf(startName), serverSource.indexOf(endName));
    assert.match(block, /providerTimestamp/);
    assert.doesNotMatch(block, /new Date\(\)\.toISOString\(\)/);
  }
  const finnhubBlock = serverSource.slice(
    serverSource.indexOf("finnhubLiveSocket.onmessage"),
    serverSource.indexOf("finnhubLiveSocket.onerror")
  );
  assert.match(finnhubBlock, /parseProviderTimestamp\(trade\.t\)/);
  assert.doesNotMatch(finnhubBlock, /new Date\(\)\.toISOString\(\)/);
});

test("provider routing uses all three stock providers but never starts Polygon crypto", () => {
  const lifecycleBlock = serverSource.slice(
    serverSource.indexOf("startServerLifecycle({"),
    serverSource.indexOf("});", serverSource.indexOf("startServerLifecycle({")) + 3
  );
  assert.match(lifecycleBlock, /startFinnhubStream/);
  assert.match(lifecycleBlock, /startPolygonStockStream/);
  assert.doesNotMatch(lifecycleBlock, /startPolygonCryptoStream/);
  assert.match(serverSource, /FINNHUB_CRYPTO_EXCHANGE/);
  assert.match(serverSource, /subscribedCount: finnhubSubscribedSymbols\.size/);
  assert.match(serverSource, /getAlpacaLatestStockQuotes/);
  assert.match(serverSource, /alpacaCryptoMarketData\.getLatestQuotes/);
  if (frontendSource !== null) {
    assert.doesNotMatch(frontendSource, /polygon_crypto_ws_quote/);
  }
});

test("fresh trade ticks cannot starve independent bid-ask refreshes", () => {
  const refreshBlock = serverSource.slice(
    serverSource.indexOf("async function refreshActiveCandidateQuotes"),
    serverSource.indexOf("function buildLiveOrderDedupKey")
  );
  assert.match(refreshBlock, /getSpreadAgeSeconds/);
  assert.match(refreshBlock, /isFreshMeasuredSpread/);
  assert.doesNotMatch(refreshBlock, /incomingTimestamp < currentTimestamp/);

  const cacheBlock = serverSource.slice(
    serverSource.indexOf("function updateQuoteCache"),
    serverSource.indexOf("function getSymbolsForPolygonLiveStream")
  );
  assert.match(cacheBlock, /hasNewerMeasuredSpread/);
  assert.match(cacheBlock, /spreadSource: incomingSpreadSource/);
  assert.match(cacheBlock, /liveQuoteSource: previous\.liveQuoteSource/);

  const cryptoCacheCall = cryptoScannerSource.slice(
    cryptoScannerSource.indexOf("const cachedCryptoQuote = updateQuoteCache"),
    cryptoScannerSource.indexOf("const liquidityMetrics")
  );
  assert.match(cryptoCacheCall, /spreadUpdatedAt:/);
  assert.match(cryptoCacheCall, /bidAskUpdatedAt:/);
  assert.match(cryptoCacheCall, /spreadSource:/);
});

test("frontend live-score merge updates measured evidence without overwriting approval or sizing", frontendTestOptions, () => {
  const mergeBlock = frontendSource.slice(
    frontendSource.indexOf("function mergeSignalByFreshness"),
    frontendSource.indexOf("function getSignalDerivedIntel")
  );
  assert.match(mergeBlock, /spreadUpdatedAt: incomingSignal\.spreadUpdatedAt/);
  assert.match(mergeBlock, /liveSpreadFresh: incomingSignal\.liveSpreadFresh/);
  const liveScoreBlock = mergeBlock.slice(
    mergeBlock.indexOf("if (isLiveScoreSignal"),
    mergeBlock.indexOf("if (!decisionIsFresh)")
  );
  assert.doesNotMatch(liveScoreBlock, /\.\.\.incomingSignal,/);
  assert.doesNotMatch(liveScoreBlock, /recommendedTradeAmount:\s*incomingSignal/);
  assert.doesNotMatch(liveScoreBlock, /backendApproved:\s*incomingSignal/);
  assert.match(liveScoreBlock, /stockDecisionScore: incomingSignal\.stockDecisionScore/);
  assert.match(liveScoreBlock, /cryptoDecisionScore: incomingSignal\.cryptoDecisionScore/);
});

test("frontend polling and streaming insert symbols that were not already present", frontendTestOptions, () => {
  assert.match(frontendSource, /if \(!old\) \{\s+map\.set\(incomingKey/);
  assert.match(frontendSource, /liveMap\.forEach\(\(incoming, incomingKey\)/);
  assert.match(frontendSource, /mergedMap\.set\(incomingKey/);
  for (const eventType of [
    "FAST_RUNNER_UPDATE",
    "QUICK_INSTITUTIONAL_GATE_UPDATE",
    "LIVE_EARLY_MOVER_REFRESH",
  ]) {
    const eventIndex = serverSource.indexOf(`type: "${eventType}"`);
    assert.notEqual(eventIndex, -1);
    const eventBlock = serverSource.slice(Math.max(0, eventIndex - 120), eventIndex + 300);
    assert.match(eventBlock, /\.\.\.buildLiveSignalPushPayload\(\)/);
    assert.doesNotMatch(eventBlock, /liveSignals:\s*buildLiveSignalPushPayload\(\)/);
  }
});

test("frontend renders unavailable final scores as dash and keeps exact evidence reasons", frontendTestOptions, () => {
  const displayBlock = frontendSource.slice(
    frontendSource.indexOf("function displayFinalDecisionScore"),
    frontendSource.indexOf("function averageScore")
  );
  assert.match(displayBlock, /return "—"/);
  assert.doesNotMatch(displayBlock, /provisionalCryptoDecisionScore/);
  assert.match(frontendSource, /missingEvidenceReasons\.join\(", "\)/);
  assert.match(frontendSource, /compareSignalsByCanonicalDecision/);
});

test("frontend uses the backend live-source and four-approval contract", frontendTestOptions, () => {
  assert.match(frontendSource, /RECOGNIZED_LIVE_QUOTE_SOURCES/);
  assert.match(frontendSource, /item\?\.priceIsLive === true/);
  assert.match(frontendSource, /item\.approved === true/);
  assert.match(frontendSource, /item\.raw\?\.executionEligibility\?\.approved === true/);
  assert.doesNotMatch(frontendSource, /executionEligibility\?\.approved !== false/);
  assert.doesNotMatch(frontendSource, /item\?\.backendApproved === true \|\| item\?\.approved === true/);
});

test("compact score availability and engine crypto approval use the canonical contract", () => {
  if (frontendSource !== null) {
    assert.match(frontendSource, /explicitStockDecisionAvailability === true/);
    assert.match(frontendSource, /explicitCryptoDecisionAvailability === true/);
  }
  const approvedCryptoBlock = engineCycleSource.slice(
    engineCycleSource.indexOf("const approvedCryptoSignals"),
    engineCycleSource.indexOf("effectiveMode = selectSmartTradingMode")
  );
  assert.match(approvedCryptoBlock, /hasExplicitTradeApproval\(signal\)/);
  assert.match(approvedCryptoBlock, /getCanonicalFinalScore\(signal\)/);
  assert.doesNotMatch(approvedCryptoBlock, /autoTradeApproved !== false/);
});

test("candidate freshness and sizing accept only recognized provider sources", () => {
  const freshnessBlock = serverSource.slice(
    serverSource.indexOf("function isLiveQuoteFresh(symbol"),
    serverSource.indexOf("let lastLiveSignalPushAt")
  );
  assert.match(freshnessBlock, /quote\.priceIsLive === true/);
  assert.match(freshnessBlock, /isLiveQuoteSource/);

  const sizingBlock = serverSource.slice(
    serverSource.indexOf("function calculateFinalPositionSizingReconciliation"),
    serverSource.indexOf("function calculateSmartCapitalCompoundingEngine")
  );
  assert.match(sizingBlock, /signal\.priceIsLive === true/);
  assert.match(sizingBlock, /isLiveQuoteSource/);
  assert.doesNotMatch(sizingBlock, /\.includes\("live"\)/);
});

test("combined stock quotes expose one authoritative spread source", () => {
  const quoteBlock = serverSource.slice(
    serverSource.indexOf("const combinedQuote = {"),
    serverSource.indexOf("return combinedQuote", serverSource.indexOf("const combinedQuote = {") )
  );
  assert.equal((quoteBlock.match(/\bspreadSource:/g) || []).length, 1);
});

test("quiet-discovery outcome updates receive the current ET date key", () => {
  const quietDiscoveryBlock = serverSource.slice(
    serverSource.indexOf("async function runBoundedQuietDiscoveryScan"),
    serverSource.indexOf("function buildQuietDiscoveryStatus")
  );
  assert.match(quietDiscoveryBlock, /dayKey: dateKey/);
  assert.doesNotMatch(quietDiscoveryBlock, /\bdayKey,\s*\n\s*tradedSymbols/);
});

test("final engine collections are canonically ranked", () => {
  const canonicalRankImport = engineCycleSource.slice(
    engineCycleSource.indexOf("from \"../scoring/canonicalSignalRank.js\"") - 180,
    engineCycleSource.indexOf("from \"../scoring/canonicalSignalRank.js\"") + 50
  );
  assert.match(canonicalRankImport, /compareCanonicalSignals/);
  const finalStateBlock = engineCycleSource.slice(
    engineCycleSource.lastIndexOf("engineState.lastSignals ="),
    engineCycleSource.indexOf("pushLiveSignalUpdate", engineCycleSource.lastIndexOf("engineState.lastSignals ="))
  );
  assert.match(finalStateBlock, /lastSignals = \[\.\.\.signals\]\.sort\(compareCanonicalSignals\)/);
  assert.equal((finalStateBlock.match(/\.sort\(compareCanonicalSignals\)/g) || []).length, 4);
});

test("frontend preservation resets every approval bit from the latest decision", frontendTestOptions, () => {
  const preserveBlock = frontendSource.slice(
    frontendSource.indexOf("const preserveSignals"),
    frontendSource.indexOf("setSignals", frontendSource.indexOf("const preserveSignals"))
  );
  for (const field of [
    "qualifiedToBuy",
    "autoTradeApproved",
    "approved",
    "backendApproved",
  ]) {
    assert.match(preserveBlock, new RegExp(`${field}: signal\\.${field} === true`));
  }
});

test("signal tape cannot promote a partial or legacy approval to approved", () => {
  const approvalBlock = serverSource.slice(
    serverSource.indexOf("function getSignalTapeApproval"),
    serverSource.indexOf("function getSignalTapeRiskBlocked")
  );
  assert.match(approvalBlock, /hasExplicitTradeApproval\(signal\)/);
  assert.match(approvalBlock, /\? "WATCHLIST"/);
  assert.doesNotMatch(
    approvalBlock,
    /qualifiedToBuy === true && signal\.autoTradeApproved === true/
  );
});

test("frontend AI decisions do not mistake the default no-exit label for an exit", frontendTestOptions, () => {
  const decisionBlock = frontendSource.slice(
    frontendSource.indexOf("const getAiDecisionBucket"),
    frontendSource.indexOf("const previewAiSignal", frontendSource.indexOf("const getAiDecisionBucket"))
  );
  assert.doesNotMatch(decisionBlock, /signal\.liveExitLabel/);
  assert.doesNotMatch(decisionBlock, /signal\.portfolioManagerReason/);
  assert.match(decisionBlock, /signal\.liveExitActive === true/);
  assert.match(decisionBlock, /isCryptoBuyableNow\(signal\)/);
  assert.match(decisionBlock, /isStockBuyableNow\(signal\)/);
});

test("top-signal hydration preserves provider time and rejects invented live sources", () => {
  const topSignalsBlock = serverSource.slice(
    serverSource.indexOf("function getTopSignals(signals"),
    serverSource.indexOf("function getInstitutionalBrainConsensus")
  );
  assert.match(
    topSignalsBlock,
    /isLiveQuoteSource\(signal\.liveQuoteSource \|\| signal\.source \|\| ""\)/
  );
  assert.match(
    topSignalsBlock,
    /isLiveQuoteSource\(liveQuote\?\.liveQuoteSource \|\| liveQuote\?\.source \|\| ""\)/
  );
  assert.match(
    topSignalsBlock,
    /liveQuote\.liveQuoteUpdatedAt \|\| liveQuote\.quoteFetchedAt \|\| null/
  );
  assert.doesNotMatch(topSignalsBlock, /liveQuoteUpdatedAt:\s*hasFreshLiveQuote\s*\?\s*liveQuote\.updatedAt/);
});
