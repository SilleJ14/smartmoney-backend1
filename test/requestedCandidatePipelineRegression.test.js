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
  assert.match(serverSource, /import \{\s*fromFinnhubStreamSymbol,\s*toFinnhubStreamSymbol,\s*\} from "\.\/live\/finnhubStreamSymbols\.js";/);
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
  assert.match(refreshBlock, /selectCryptoRestQuoteBatch/);
  assert.match(refreshBlock, /isAlpacaCryptoExecutionSource/);
  assert.match(refreshBlock, /alpacaCryptoBook/);
  assert.doesNotMatch(refreshBlock, /incomingTimestamp < currentTimestamp/);

  const cacheBlock = serverSource.slice(
    serverSource.indexOf("function updateQuoteCache"),
    serverSource.indexOf("function getSymbolsForPolygonLiveStream")
  );
  assert.match(cacheBlock, /applyTradeTickWithoutClearingAlpacaBook/);
  assert.match(cacheBlock, /hasNewerMeasuredSpread/);
  assert.match(cacheBlock, /spreadSource: incomingSpreadSource/);
  assert.match(cacheBlock, /liveQuoteSource: previous\.liveQuoteSource/);
  assert.match(cacheBlock, /lastTradePrice/);

  const readyBlock = serverSource.slice(
    serverSource.indexOf("function isPreTradeQuoteReady"),
    serverSource.indexOf("async function resolveVerifiedPreTradeQuote")
  );
  assert.match(readyBlock, /isAlpacaCryptoExecutionSource\(quoteSource\)/);
  assert.match(readyBlock, /isAlpacaCryptoExecutionSource\(spreadSource\)/);

  const finnhubBlock = serverSource.slice(
    serverSource.indexOf("finnhubLiveSocket.onmessage"),
    serverSource.indexOf("finnhubLiveSocket.onerror")
  );
  assert.match(finnhubBlock, /eventType: "trade"/);
  assert.match(finnhubBlock, /spreadAvailable: false/);
  assert.match(finnhubBlock, /if \(isCrypto\(symbol\)\) continue/);

  const finnhubSymbolsBlock = serverSource.slice(
    serverSource.indexOf("function getSymbolsForFinnhubLiveStream"),
    serverSource.indexOf("function subscribeFinnhubSymbol")
  );
  assert.doesNotMatch(finnhubSymbolsBlock, /collectCryptoSymbols/);
  assert.match(finnhubSymbolsBlock, /filter\(\(symbol\) => !isCrypto\(symbol\)\)/);

  const cryptoCacheCall = cryptoScannerSource.slice(
    cryptoScannerSource.indexOf("const cachedCryptoQuote = updateQuoteCache"),
    cryptoScannerSource.indexOf("const liquidityMetrics")
  );
  assert.match(cryptoCacheCall, /spreadUpdatedAt:/);
  assert.match(cryptoCacheCall, /bidAskUpdatedAt:/);
  assert.match(cryptoCacheCall, /spreadSource:/);

  const streamBlock = serverSource.slice(
    serverSource.indexOf("alpacaCryptoStream = createAlpacaCryptoStream"),
    serverSource.indexOf("startServerLifecycle({")
  );
  assert.match(streamBlock, /selectAlpacaCryptoStreamSymbols/);
  assert.match(streamBlock, /heldSymbols:/);
  assert.match(streamBlock, /pinnedSymbols:/);
});

test("portfolio desk keeps forex off Autopilot and shares the position book filter", frontendTestOptions, () => {
  const portfolioBlock = frontendSource.slice(
    frontendSource.indexOf("const PortfolioTab = () => {"),
    frontendSource.indexOf("const AiTab = () => {")
  );
  assert.match(frontendSource, /STOCKS \/ CRYPTO/);
  assert.match(frontendSource, /FOREX OPEN/);
  assert.match(frontendSource, /OANDA PRACTICE/);
  assert.match(frontendSource, /FREE MARGIN/);
  assert.match(frontendSource, /showForexDesk \? "FOREX" : "TRADING MODE"/);
  assert.match(frontendSource, /showForexDesk \? null : \(/);
  assert.match(frontendSource, /setPortfolioDesk\(key\)/);
  assert.match(portfolioBlock, /OPEN RISK LIMIT/);
  assert.match(portfolioBlock, /reviewForexTrade/);
  assert.match(portfolioBlock, /No OANDA order yet/);
  assert.match(portfolioBlock, /\["forex", "FOREX"\]/);
  assert.doesNotMatch(portfolioBlock, /setAutoTrading\(true\)/);
  assert.match(frontendSource, /function isForexSymbol/);
});

test("home buyable and watching mix stocks crypto and forex", frontendTestOptions, () => {
  const homeTables = frontendSource.slice(
    frontendSource.indexOf("const AssetFilterTabs"),
    frontendSource.indexOf("const HomeTab = () =>")
  );
  assert.match(homeTables, /\["forex", "FOREX"\]/);
  assert.match(homeTables, /homeForexTape\.ready/);
  assert.match(homeTables, /homeForexTape\.watching/);
  assert.match(homeTables, /homeForexTape\.equityBuyable/);
  assert.match(homeTables, /homeForexTape\.equityWatching/);
  assert.doesNotMatch(homeTables, /showForexDesk/);
  assert.match(homeTables, />REVIEW</);
  assert.match(homeTables, /buySignalWithAiSizing\(item\)/);
  assert.match(frontendSource, /return items\.filter\(\(item\) => matchesOpportunityFilter\(item, filter\)\)/);
});

test("signals forex chip stays off F scores and Alpaca buy", frontendTestOptions, () => {
  const signalsBlock = frontendSource.slice(
    frontendSource.indexOf("const SignalsTab = () => {"),
    frontendSource.indexOf("const firstFinite = (...values")
  );
  assert.match(signalsBlock, /\["all", "stock", "crypto", "forex"\]/);
  assert.match(signalsBlock, /FOREX MOVERS/);
  assert.match(signalsBlock, /TRADE READY/);
  assert.match(signalsBlock, /reviewForexSignal/);
  assert.match(signalsBlock, /forex \? "REVIEW" : "BUY"/);
  assert.match(signalsBlock, /buySignalWithAiSizing\(item\)/);
  assert.match(frontendSource, /function matchesOpportunityFilter/);
});

test("ai forex desk stays off Autopilot and mixes all three on All", frontendTestOptions, () => {
  const aiBlock = frontendSource.slice(
    frontendSource.indexOf("const AiTab = () => {"),
    frontendSource.indexOf("const SettingsTab = () => {")
  );
  assert.match(aiBlock, /\["all", "stock", "crypto", "forex"\]/);
  assert.match(aiBlock, /AUTO OFF/);
  assert.match(aiBlock, /ECONOMIC CALENDAR/);
  assert.match(aiBlock, /FOREX/);
  assert.match(aiBlock, /DETAILS/);
  assert.doesNotMatch(aiBlock, /setAutoTrading\(true\)/);
  assert.match(aiBlock, /matchesOpportunityFilter\(row\.candidate, aiDecisionAssetFilter\)/);
});

test("settings forex engine stays off Autopilot and keeps OANDA practice keys local", frontendTestOptions, () => {
  const settingsBlock = frontendSource.slice(
    frontendSource.indexOf("const SettingsTab = () => {"),
    frontendSource.indexOf("const renderWelcomeScreen = () => {")
  );
  assert.match(settingsBlock, /Forex Engine/);
  assert.match(settingsBlock, /OANDA Practice Account ID/);
  assert.match(settingsBlock, /Forex Autopilot/);
  assert.match(settingsBlock, /FOREX AUTO OFF/);
  assert.match(settingsBlock, /FOREX AUTO ON/);
  assert.match(settingsBlock, /oandaForexPairList/);
  assert.doesNotMatch(settingsBlock, /OANDA practice desk/);
  assert.doesNotMatch(settingsBlock, /Live forex orders stay blocked/);
  assert.doesNotMatch(settingsBlock, /FOREX AUTO STAYS OFF/);
  assert.doesNotMatch(settingsBlock, /Live Orders/);
  assert.match(settingsBlock, /Autopilot requested/);
  assert.match(settingsBlock, /\/forex-auto\//);
  assert.match(frontendSource, /forexAutoEnabled/);
  assert.doesNotMatch(settingsBlock, /setAutoTrading\(true\)/);
  assert.match(frontendSource, /SMARTMONEY_OANDA_PRACTICE_TOKEN/);
  assert.match(frontendSource, /OANDA_FOREX_PAIRS/);
});

test("frontend live-score merge updates canonical approval and sizing only when explicitly supplied", frontendTestOptions, () => {
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
  assert.match(liveScoreBlock, /const hasTradeAmountPayload =/);
  assert.match(liveScoreBlock, /\.\.\.\(hasTradeAmountPayload \? \{/);
  assert.match(liveScoreBlock, /recommendedTradeAmount:\s*incomingSignal\.recommendedTradeAmount/);
  assert.match(liveScoreBlock, /hasIncomingBoolean\("backendApproved"\)/);
  assert.match(liveScoreBlock, /backendApproved:\s*incomingSignal\.backendApproved/);
  assert.match(liveScoreBlock, /stockDecisionScore: incomingSignal\.stockDecisionScore/);
  assert.match(liveScoreBlock, /cryptoDecisionScore: incomingSignal\.cryptoDecisionScore/);
});

test("frontend crypto quote refresh preserves measured change instead of inventing zero", frontendTestOptions, () => {
  const normalizeBlock = frontendSource.slice(
    frontendSource.indexOf("function normalizeSignal"),
    frontendSource.indexOf("function getSignalDecisionTimestamp")
  );
  const mergeBlock = frontendSource.slice(
    frontendSource.indexOf("function mergeSignalByFreshness"),
    frontendSource.indexOf("function getSignalDerivedIntel")
  );

  assert.match(normalizeBlock, /const explicitChangeAvailability =/);
  assert.match(normalizeBlock, /const hasChangeBaseline =/);
  assert.match(normalizeBlock, /explicitChangeAvailability === true/);
  assert.match(mergeBlock, /incomingSignal\.changePercentMeasured !== true/);
  assert.match(mergeBlock, /dayChangePercent: oldSignal\.dayChangePercent/);
  assert.match(mergeBlock, /sessionChangePercent: oldSignal\.sessionChangePercent/);
  assert.match(mergeBlock, /changePercent: oldSignal\.changePercent/);
  assert.match(frontendSource, /function measuredPct\(value: number, available: boolean\)/);
  assert.match(frontendSource, /measuredPct\(item\.sessionChangePercent, item\.changePercentMeasured\)/);
});

test("frontend live-score refresh carries every canonical crypto score family", frontendTestOptions, () => {
  const mergeBlock = frontendSource.slice(
    frontendSource.indexOf("function mergeSignalByFreshness"),
    frontendSource.indexOf("function getSignalDerivedIntel")
  );
  const liveScoreBlock = mergeBlock.slice(
    mergeBlock.indexOf("if (isLiveScoreSignal"),
    mergeBlock.indexOf("if (!decisionIsFresh)")
  );

  for (const field of [
    "rawCryptoScore",
    "cryptoDiscoveryScoreAvailable",
    "cryptoDiscoveryScoreCoverage",
    "cryptoDiscoveryScoreFresh",
    "cryptoEntryScore",
    "cryptoEntryScoreAvailable",
    "cryptoDecisionScore",
    "cryptoDecisionScoreAvailable",
    "cryptoDecisionCoverage",
    "provisionalCryptoDecisionScore",
    "provisionalCryptoDecisionScoreAvailable",
    "multiDayScore",
    "multiDayProbability",
    "multiDayScoreAvailable",
    "cryptoScoreTelemetry",
    "centralAutonomousDecisionCore",
    "missingEvidenceReasons",
  ]) {
    assert.match(liveScoreBlock, new RegExp(`${field}:`));
  }
});

test("frontend crypto score availability honors explicit evidence without promoting legacy scores", frontendTestOptions, () => {
  const normalizeBlock = frontendSource.slice(
    frontendSource.indexOf("function normalizeSignal"),
    frontendSource.indexOf("function getSignalDecisionTimestamp")
  );
  const discoveryBlock = normalizeBlock.slice(
    normalizeBlock.indexOf("const explicitCryptoDiscoveryScore ="),
    normalizeBlock.indexOf("const explicitCryptoEntryScore =")
  );
  const finalBlock = normalizeBlock.slice(
    normalizeBlock.indexOf("const explicitCryptoDecisionScore ="),
    normalizeBlock.indexOf("const provisionalCryptoDecisionScoreAvailable =")
  );

  assert.match(discoveryBlock, /inferAvailability\(\s*explicitCryptoDiscoveryAvailability/);
  assert.match(frontendSource, /if \(explicitAvailability === false\) return false/);
  assert.doesNotMatch(discoveryBlock, /scannerScore|item\?\.score/);
  assert.match(normalizeBlock, /inferAvailability\(\s*explicitCryptoEntryAvailability/);
  assert.match(normalizeBlock, /explicitMultiDayAvailability === true/);
  assert.match(normalizeBlock, /cryptoContinuationComponent\?\.value/);
  assert.match(finalBlock, /!cryptoDecisionIsProvisional/);
  assert.doesNotMatch(finalBlock, /masterFinalScore|finalAutonomousDecisionScore/);
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
    if (eventType === "QUICK_INSTITUTIONAL_GATE_UPDATE") {
      assert.match(eventBlock, /approvedSymbols:/);
      assert.doesNotMatch(eventBlock, /buildLiveSignalPushPayload/);
    } else {
      assert.match(eventBlock, /\.\.\.buildLiveSignalPushPayload\(\)/);
    }
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

test("frontend demotes stale buyable rows even while the SSE connection stays open", frontendTestOptions, () => {
  assert.match(
    frontendSource,
    /const freshnessTimer = setInterval\(\(\) => \{\s*setSignals\(\(previousSignals\) => sweepSignalUiFreshness\(previousSignals\)\)/
  );
  assert.match(frontendSource, /clearInterval\(freshnessTimer\)/);
  assert.match(frontendSource, /const quoteTimer = setInterval/);
  assert.match(frontendSource, /const scoreTimer = setInterval/);
  const streamBlock = frontendSource.slice(frontendSource.indexOf("stream.onmessage ="), frontendSource.indexOf("const refreshRef ="));
  assert.doesNotMatch(streamBlock, /liveQuoteStateVersionRef\.current =/);
});

test("frontend uses authoritative backend decisions without legacy approval reconstruction", frontendTestOptions, () => {
  assert.match(frontendSource, /RECOGNIZED_LIVE_QUOTE_SOURCES/);
  for (const name of ['isStockBuyableNow', 'isCryptoBuyableNow']) {
    const body = frontendSource.match(new RegExp(`function ${name}\\([^]*?\\n}`))?.[0];
    assert.ok(body, `${name} missing`);
    assert.match(body, /backendDecisionBuyable\(item\.raw\?\.currentDecision\?\.authorization, item\.symbol\)/);
    assert.doesNotMatch(body, /legacyFourWay|aggregateExecutionApproved|item\.approved/);
  }
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
  assert.match(preserveBlock, /mergeSignalByFreshness\(old, incoming, now\)/);
  assert.doesNotMatch(preserveBlock, /\.\.\.signal,/);
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
