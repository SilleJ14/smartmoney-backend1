import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  calculateCryptoEntryQualityFromEvidence,
  hydrateCryptoContinuationMemoryFromDailyBars,
  resolveCryptoLiquidityEvidence,
  scoreSparseCryptoMarket,
} from "../scoring/cryptoScoring.js";
import { calculateCryptoEarlyDiscoveryScore } from "../scoring/earlyDiscovery.js";
import { assessCryptoSetup, assessBtcContext, cryptoSetupGate } from '../scoring/cryptoSetup.js';

export async function mapWithConcurrency(items = [], concurrency = 4, worker) {
  const values = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(values.length || 1, Number(concurrency) || 1));
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await worker(values[index], index);
    }
  });
  await Promise.all(workers);
}

function cryptoBarTimestamp(bar = {}) {
  const raw = bar.t ?? bar.timestamp ?? bar.time ?? bar.datetime ?? bar.date;
  if (raw === null || raw === undefined || raw === "") return null;
  const numeric = Number(raw);
  const parsed = Number.isFinite(numeric)
    ? numeric < 10_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveCryptoDailyChangeReference(
  dailyBars = [],
  { now = new Date() } = {}
) {
  const timestamp = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isFinite(timestamp.getTime())
    ? timestamp.getTime()
    : Date.now();
  const currentDayKey = new Date(nowMs).toISOString().slice(0, 10);
  const timestampedBars = (Array.isArray(dailyBars) ? dailyBars : [])
    .map((bar) => ({ bar, timestamp: cryptoBarTimestamp(bar) }))
    .filter(({ timestamp: barTimestamp }) => barTimestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  const completedBars = timestampedBars.filter(({ timestamp: barTimestamp }) =>
    new Date(barTimestamp).toISOString().slice(0, 10) < currentDayKey
  );
  for (let index = completedBars.length - 1; index >= 0; index -= 1) {
    const close = Number(
      completedBars[index].bar.c ?? completedBars[index].bar.close
    );
    if (Number.isFinite(close) && close > 0) {
      return {
        price: close,
        type: "previous_completed_utc_daily_close",
        source: completedBars[index].bar.source || "crypto_daily_bars",
        dayKey: new Date(completedBars[index].timestamp).toISOString().slice(0, 10),
      };
    }
  }
  const currentDayBars = timestampedBars.filter(({ timestamp: barTimestamp }) =>
    new Date(barTimestamp).toISOString().slice(0, 10) === currentDayKey
  );
  for (const { bar } of currentDayBars) {
    const open = Number(bar.o ?? bar.open);
    if (Number.isFinite(open) && open > 0) {
      return {
        price: open,
        type: "current_utc_day_open",
        source: bar.source || "crypto_daily_bars",
        dayKey: currentDayKey,
      };
    }
  }
  return null;
}

function cryptoQuoteTimestampMs(quote = {}) {
  const raw =
    quote.liveQuoteUpdatedAt ??
    quote.quoteFetchedAt ??
    quote.updatedAt;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = Number.isFinite(Number(raw))
    ? Number(raw)
    : Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeLatestCryptoPriceWithAlpacaSpread(
  priceQuote = null,
  alpacaQuote = null,
  { now = Date.now(), maxSpreadAgeSeconds = 5 } = {}
) {
  const priceTimestamp = cryptoQuoteTimestampMs(priceQuote || {});
  const alpacaTimestamp = cryptoQuoteTimestampMs(alpacaQuote || {});
  const latestPriceQuote = !priceQuote
    ? alpacaQuote
    : !alpacaQuote
      ? priceQuote
      : alpacaTimestamp !== null &&
        (priceTimestamp === null || alpacaTimestamp > priceTimestamp)
        ? alpacaQuote
        : priceQuote;
  if (!latestPriceQuote) return null;

  const bid = Number(alpacaQuote?.bid || 0);
  const ask = Number(alpacaQuote?.ask || 0);
  const spreadTimestamp = Date.parse(String(
    alpacaQuote?.spreadUpdatedAt || alpacaQuote?.bidAskUpdatedAt || ""
  ));
  const spreadAgeSeconds = Number.isFinite(spreadTimestamp)
    ? (Number(now) - spreadTimestamp) / 1000
    : null;
  const spreadAvailable =
    bid > 0 &&
    ask >= bid &&
    spreadAgeSeconds !== null &&
    spreadAgeSeconds >= -5 &&
    spreadAgeSeconds <= Math.max(1, Number(maxSpreadAgeSeconds) || 5);

  return {
    ...alpacaQuote,
    ...latestPriceQuote,
    bid: spreadAvailable ? bid : null,
    ask: spreadAvailable ? ask : null,
    spreadAvailable,
    spreadUpdatedAt: spreadAvailable
      ? alpacaQuote.spreadUpdatedAt || alpacaQuote.bidAskUpdatedAt
      : null,
    bidAskUpdatedAt: spreadAvailable
      ? alpacaQuote.bidAskUpdatedAt || alpacaQuote.spreadUpdatedAt
      : null,
    spreadSource: spreadAvailable
      ? alpacaQuote.spreadSource ||
        alpacaQuote.liveQuoteSource ||
        alpacaQuote.source ||
        "alpaca_crypto_latest"
      : null,
  };
}

export function createCryptoMarketScanner(dependencies) {
  const {
    CONFIG,
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality,
    calculateRunnerStageProfile,
    clampScore,
    engineState,
    getBestCryptoBars,
    getCryptoDailyBarsForDiscovery,
    getCryptoAssets,
    getCryptoNewsIntelligence,
    getCryptoLatestQuote,
    getCryptoLatestQuotes,
    getCryptoOrderbooks,
    getFreshLiveCryptoQuote,
    isCrypto,
    recordSkippedSymbol,
    updateQuoteCache,
    getRuntime,
  } = dependencies;

  function firstPositiveNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function boundedCenteredScore(value, pointsPerPercent, maxMovePercent) {
    const boundedValue = Math.max(
      -maxMovePercent,
      Math.min(maxMovePercent, Number(value) || 0)
    );
    return clampScore(50 + boundedValue * pointsPerPercent);
  }

  function scoreCrypto(quote, bars = []) {
    const cleanBars = Array.isArray(bars)
      ? bars.map((bar) => {
        const close = firstPositiveNumber(bar.c, bar.close, bar.price);
        const open = firstPositiveNumber(bar.o, bar.open, close);
        const high = Math.max(
          open,
          close,
          firstPositiveNumber(bar.h, bar.high, open, close)
        );
        const lowCandidate = firstPositiveNumber(bar.l, bar.low, open, close);
        const low = Math.min(open, close, lowCandidate || open || close);
        return {
          o: open,
          h: high,
          l: low,
          c: close,
          v: firstPositiveNumber(bar.v, bar.volume),
        };
      })
        .filter((bar) => bar.c > 0)
      : [];
    const current = firstPositiveNumber(
      quote?.current,
      quote?.price,
      quote?.last,
      quote?.close,
      cleanBars[cleanBars.length - 1]?.c
    );
    if (current <= 0) return 0;
    if (cleanBars.length < 3) {
      return scoreSparseCryptoMarket({ ...quote, current }, cleanBars.length);
    }
    const first = cleanBars[0];
    const latest = cleanBars[cleanBars.length - 1];
    const previous = cleanBars[cleanBars.length - 2];
    const open = firstPositiveNumber(first.o, first.c, current);
    const high = Math.max(...cleanBars.map((bar) => firstPositiveNumber(bar.h, bar.c)));
    const low = Math.min(...cleanBars.map((bar) => firstPositiveNumber(bar.l, bar.c)));
    const momentumPercent =
      open > 0 ? ((current - open) / open) * 100 : 0;
    const shortWindow = cleanBars.slice(-5);
    const shortFirst = shortWindow[0];
    const shortMomentumPercent =
      shortFirst?.c > 0
        ? ((current - shortFirst.c) / shortFirst.c) * 100
        : 0;
    const previousClose = firstPositiveNumber(previous.c, current);
    const lastBarMomentum =
      previousClose > 0 ? ((current - previousClose) / previousClose) * 100 : 0;
    const closeNearHigh =
      high > low ? ((current - low) / (high - low)) * 100 : 50;
    const minimumDirectionalBodyPercent = 0.02;
    const minimumBodyToRangeRatio = 0.15;
    let meaningfulGreenBars = 0;
    let meaningfulRedBars = 0;
    for (const bar of cleanBars) {
      const body = Number(bar.c || 0) - Number(bar.o || 0);
      const bodyPercent = bar.o > 0 ? (body / bar.o) * 100 : 0;
      const range = Math.max(0, Number(bar.h || 0) - Number(bar.l || 0));
      const bodyToRangeRatio = range > 0 ? Math.abs(body) / range : 0;
      if (
        bodyPercent >= minimumDirectionalBodyPercent &&
        bodyToRangeRatio >= minimumBodyToRangeRatio
      ) {
        meaningfulGreenBars += 1;
      } else if (
        bodyPercent <= -minimumDirectionalBodyPercent &&
        bodyToRangeRatio >= minimumBodyToRangeRatio
      ) {
        meaningfulRedBars += 1;
      }
    }
    const directionalBalance =
      (meaningfulGreenBars - meaningfulRedBars) /
      Math.max(1, cleanBars.length);

    const baselineVolumes = cleanBars
      .slice(0, -1)
      .map((bar) => Number(bar.v || 0))
      .filter((volume) => volume > 0);
    const avgVolume = baselineVolumes.length > 0
      ? baselineVolumes.reduce((sum, volume) => sum + volume, 0) /
        baselineVolumes.length
      : 0;
    const latestVolume = Number(latest.v || 0);
    const volumeRatio = avgVolume > 0 && latestVolume > 0
      ? latestVolume / avgVolume
      : avgVolume > 0
        ? 0
        : 1;

    // Long, short, last-bar, candle direction, and price location are correlated
    // views of the same price path. Blend them into one bounded trend family so
    // a tiny move cannot earn five independent bonuses.
    const longTrendScore = boundedCenteredScore(momentumPercent, 12.5, 4);
    const shortTrendScore = boundedCenteredScore(shortMomentumPercent, 20, 2.5);
    const lastBarTrendScore = boundedCenteredScore(lastBarMomentum, 30, 1.67);
    const candleDirectionScore = clampScore(50 + directionalBalance * 25);
    const observedRangePercent = open > 0 ? ((high - low) / open) * 100 : 0;
    const priceLocationScore = observedRangePercent >= 0.1
      ? clampScore(closeNearHigh)
      : 50;
    const trendFamilyScore =
      longTrendScore * 0.5 +
      shortTrendScore * 0.2 +
      lastBarTrendScore * 0.1 +
      candleDirectionScore * 0.1 +
      priceLocationScore * 0.1;

    const trendConfidence = Math.min(1, cleanBars.length / 20);
    const confidenceAdjustedTrend =
      50 + (trendFamilyScore - 50) * trendConfidence;
    const participationScore = volumeRatio >= 2
      ? 85
      : volumeRatio >= 1.5
        ? 72
        : volumeRatio >= 1.1
          ? 60
          : volumeRatio >= 0.75
            ? 50
            : volumeRatio >= 0.5
              ? 42
              : 32;
    const participationConfidence = Math.min(1, baselineVolumes.length / 10);
    const confidenceAdjustedParticipation =
      50 + (participationScore - 50) * participationConfidence;
    const score =
      confidenceAdjustedTrend * 0.78 +
      confidenceAdjustedParticipation * 0.22;
    const runnerStageProfile = calculateRunnerStageProfile({
      ...quote,
      current,
      price: current,
      open,
      high,
      low,
      percentChange: momentumPercent,
      volumeSpikeRatio: volumeRatio,
      confirmations: {
        volumeSpikeRatio: volumeRatio,
        aboveVwap: current >= open,
      },
      technicals: {
        rsi: 55,
      },
    });
    const runnerHoldQuality = calculateRunnerHoldQuality({
      ...quote,
      current,
      price: current,
      open,
      high,
      low,
      percentChange: momentumPercent,
      volumeSpikeRatio: volumeRatio,
      runnerStageProfile,
      confirmations: {
        volumeSpikeRatio: volumeRatio,
        aboveVwap: current >= open,
      },
      technicals: {
        rsi: 55,
      },
    });
    let finalScore = clampScore(score);
    if (!runnerHoldQuality.runnerHoldApproved) {
      finalScore = Math.min(finalScore, 86);
    }
    if (runnerHoldQuality.runnerHoldScore < 70) {
      finalScore = Math.min(finalScore, 82);
    }
    if (runnerStageProfile.runnerStage === "MATURE") {
      finalScore = Math.min(finalScore, 84);
    }
    if (
      runnerStageProfile.runnerStage === "EXHAUSTION" ||
      runnerStageProfile.lateChaseRisk === true
    ) {
      finalScore = Math.min(finalScore, 76);
    }
    return finalScore;
  }
  
  function calculateCryptoInstitutionalQualification({
    quote = {},
    score = 0,
    entryQualityScore = 0,
    bars = [],
    discoveryScorecard = null,
    liquidityMetrics = {},
    spreadPercent = null,
    spreadAvailable = false,
  }) {
    const barsFound = Array.isArray(bars) ? bars.length : 0;
    const volumeSpikeRatio = Number(
      liquidityMetrics.volumeSpikeRatio || 0
    );
    const dollarVolume = Number(
      liquidityMetrics.dollarVolume || 0
    );
    const volumeConfidenceScore = Number(
      liquidityMetrics.volumeConfidenceScore || 0
    );
    const cleanSpreadPercent = spreadAvailable && Number.isFinite(Number(spreadPercent))
      ? Number(spreadPercent)
      : null;
    const spreadPass =
      spreadAvailable &&
      cleanSpreadPercent <= CRYPTO_MAX_ENTRY_SPREAD_PERCENT;
    const cleanExecutionPass =
      spreadPass &&
      cleanSpreadPercent <= 0.65 &&
      barsFound >= 10;
    const trueLiquidityPass =
      spreadPass &&
      liquidityMetrics.liquidityPass === true &&
      (
        volumeSpikeRatio >= 0.15 ||
        volumeConfidenceScore >= 60
      );
    const smallCryptoProbePass =
      cleanExecutionPass &&
      Number(score || 0) >= 75 &&
      liquidityMetrics.liquidityProbePass === true &&
      (
        volumeConfidenceScore >= 35 ||
        volumeSpikeRatio >= 0.1
      );
    const liquidityPass =
      trueLiquidityPass || smallCryptoProbePass;
    const discoveryComponents = Object.fromEntries(
      (discoveryScorecard?.components || []).map((component) => [component.name, component])
    );
    const structureValues = [
      discoveryComponents.structure,
      discoveryComponents.accumulation,
    ].filter((component) => component?.available === true);
    const trendStructureScore = structureValues.length > 0
      ? clampScore(
        structureValues.reduce((sum, component) => sum + Number(component.value || 0), 0) /
        structureValues.length
      )
      : 0;
    const cryptoTrapRiskScore = clampScore(
      25 +
      (!spreadAvailable ? 20 : cleanSpreadPercent > 0.85 ? 25 : 0) +
      (volumeConfidenceScore < 35 ? 18 : 0) +
      (volumeSpikeRatio < 0.15 ? 12 : 0) +
      (barsFound < 10 ? 30 : 0) -
      (volumeConfidenceScore >= 65 ? 12 : 0)
    );
    const entryExecutionScore = clampScore(
      (spreadPass ? 55 : 0) +
      (liquidityMetrics.liquidityPass === true ? 30 : 0) +
      (barsFound >= 10 ? 15 : 0)
    );
    const institutionalCryptoScore = clampScore(
      Number(score || 0) * 0.6 +
      entryExecutionScore * 0.4
    );
    const institutionalCryptoGrade =
      institutionalCryptoScore >= 85 && cryptoTrapRiskScore <= 35
        ? "A_CRYPTO_INSTITUTIONAL"
        : institutionalCryptoScore >= 75 && cryptoTrapRiskScore <= 45
          ? "B_CRYPTO_STRONG"
          : institutionalCryptoScore >= 65 && cryptoTrapRiskScore <= 55
            ? "C_CRYPTO_PROBE"
            : "D_CRYPTO_AVOID";
    const cryptoDiscoveryThreshold = Math.max(
      60,
      Number(CONFIG.minCryptoDiscoveryScore || 60)
    );
    const discoveryPass = Number(score || 0) >= cryptoDiscoveryThreshold;
    // Use the same measured spread/liquidity Entry Quality shown to the user.
    // The legacy momentum timing score remains telemetry only and cannot act
    // as a hidden approval gate.
    const entryQualityPass = Number(entryQualityScore || 0) >= 75;
    const dataPass =
      barsFound >= 10 &&
      Number(quote.current || 0) > 0;
    const cryptoMacroOverride =
      engineState.marketCycleIntelligenceState?.marketCyclePhase === "ACCUMULATION" &&
      engineState.autonomousTradingSystemState?.shouldBlockNewTrades !== true &&
      engineState.phase21AutonomousBrainState?.shouldBlockNewTrades !== true;
    const macroPass =
      cryptoMacroOverride ||
      (
        engineState.macroRiskState?.shouldBlockNewTrades !== true &&
        engineState.marketCrashProtectionState?.shouldBlockNewTrades !== true
      );
    const institutionalStructurePass =
      Number(discoveryScorecard?.coverage || 0) >= 0.65 &&
      trendStructureScore >= 55 &&
      cryptoTrapRiskScore <= 60 &&
      institutionalCryptoGrade !== "D_CRYPTO_AVOID";
    const qualifiedToBuy =
      dataPass &&
      discoveryPass &&
      entryQualityPass &&
      liquidityPass &&
      macroPass &&
      institutionalStructurePass &&
      discoveryScorecard?.gates?.includes("NEGATIVE_NEWS_RISK") !== true;
    return {
      qualifiedToBuy,
      cryptoInstitutionalQualification: {
        passed: qualifiedToBuy,
        approved: qualifiedToBuy,
        dataPass,
        discoveryPass,
        momentumPass: discoveryPass,
        entryQualityPass,
        entryQualityScore: Number(entryQualityScore || 0),
        liquidityPass,
        macroPass,
        spreadPass,
        spreadAvailable,
        barsFound,
        score,
        cryptoDiscoveryThreshold,
        spreadPercent: cleanSpreadPercent,
        dollarVolume,
        volumeSpikeRatio,
        volumeConfidenceScore,
        institutionalCryptoScore,
        institutionalCryptoGrade,
        cryptoTrapRiskScore,
        trendStructureScore,
        entryExecutionScore,
        institutionalStructurePass,
        reason: qualifiedToBuy
          ? "Crypto institutional qualification passed"
          : !spreadAvailable
            ? "Crypto institutional qualification failed: missing live spread"
            : "Crypto institutional qualification failed",
      },
    };
  }
  
  let cryptoScanInFlight = null;
  function scanCryptoMarket() {
    if (!cryptoScanInFlight) cryptoScanInFlight = Promise.resolve().then(runCryptoMarketScan).finally(() => { cryptoScanInFlight = null; });
    return cryptoScanInFlight;
  }
  async function runCryptoMarketScan() {
    const {
      LIVE_ORDER_MAX_QUOTE_AGE_SECONDS,
      CRYPTO_SCAN_CONCURRENCY = 4,
    } = getRuntime();
    const symbols = await getCryptoAssets();
    const btcBars = await getBestCryptoBars('BTC/USD').catch(() => []);
    const cryptoSkipped = [];
    const results = [];
    console.log("CRYPTO SCAN START", {
      totalCryptoAssets: symbols.length,
      sampleAssets: symbols.slice(0, 10),
      usdPairs: symbols.filter((s) => String(s || "").endsWith("/USD")).length,
    });
    engineState.skippedSymbols = [];
    engineState.lastCryptoScanStartedAt = new Date().toISOString();
    // Preserve the last published snapshot until this generation completes.
    const scanSymbols = symbols.filter((symbol) =>
      String(symbol || "").endsWith("/USD")
    );
    let initialAlpacaQuotesBySymbol = new Map();
    if (typeof getCryptoLatestQuotes === "function" && scanSymbols.length > 0) {
      try {
        const initialQuotes = await getCryptoLatestQuotes(scanSymbols);
        initialAlpacaQuotesBySymbol = new Map(
          (Array.isArray(initialQuotes) ? initialQuotes : [])
            .filter((quote) => quote?.symbol)
            .map((quote) => [String(quote.symbol).toUpperCase(), quote])
        );
      } catch (error) {
        console.warn("Initial Alpaca crypto quote batch failed:", error.message);
      }
    }
    let processedSymbols = 0;
    await mapWithConcurrency(
      scanSymbols,
      Math.max(1, Math.min(8, Number(CRYPTO_SCAN_CONCURRENCY) || 4)),
      async (symbol) => {
      processedSymbols += 1;
      engineState.lastHeartbeatAt = new Date().toISOString();
      engineState.engineCycleStage = {
        stage: "SCANNING_CRYPTO",
        symbol,
        processedSymbols,
        totalSymbols: symbols.length,
        updatedAt: engineState.lastHeartbeatAt,
      };
      try {
        const liveCryptoQuote = getFreshLiveCryptoQuote(
          symbol,
          LIVE_ORDER_MAX_QUOTE_AGE_SECONDS
        );
        const initialAlpacaQuote = initialAlpacaQuotesBySymbol.get(
          String(symbol).toUpperCase()
        );
        const quote = mergeLatestCryptoPriceWithAlpacaSpread(
          liveCryptoQuote,
          initialAlpacaQuote,
          { maxSpreadAgeSeconds: 5 }
        ) || (
          typeof getCryptoLatestQuotes === "function"
            ? null
            : await getCryptoLatestQuote(symbol)
        );
        if (!quote) {
          throw new Error("No live crypto quote available from the batch providers");
        }
        const [bars, dailyBars, newsCatalyst] = await Promise.all([
          getBestCryptoBars(symbol),
          getCryptoDailyBarsForDiscovery(symbol),
          getCryptoNewsIntelligence(symbol),
        ]);
        engineState.multiTimeframeCryptoMemory ||= {};
        const cryptoContinuationMemory =
          hydrateCryptoContinuationMemoryFromDailyBars(
            engineState.multiTimeframeCryptoMemory[symbol] || {},
            dailyBars,
            { now: new Date() }
          );
        engineState.multiTimeframeCryptoMemory[symbol] = cryptoContinuationMemory;
        const legacyMomentumScore = scoreCrypto(quote, bars);
        const validBars = Array.isArray(bars)
          ? bars.filter((bar) => Number(bar.c || bar.close || 0) > 0)
          : [];
        const firstBarClose = Number(
          validBars[0]?.c ||
          validBars[0]?.close ||
          0
        );
        const lastBarClose = Number(
          validBars[validBars.length - 1]?.c ||
          validBars[validBars.length - 1]?.close ||
          0
        );
        const latestPrice = Number(
          quote.current ||
          quote.price ||
          quote.last ||
          quote.close ||
          0
        );
        const providerReferencePrice = firstPositiveNumber(
          quote.previousClose,
          quote.prevClose,
          quote.percentChangeReferencePrice,
          quote.changeReferencePrice
        );
        const quoteReferenceTime =
          quote.liveQuoteUpdatedAt || quote.quoteFetchedAt || new Date();
        const dailyChangeReference = resolveCryptoDailyChangeReference(
          dailyBars,
          { now: quoteReferenceTime }
        );
        const changeBasePrice = dailyChangeReference?.price > 0
          ? dailyChangeReference.price
          : firstBarClose > 0
            ? firstBarClose
            : providerReferencePrice;
        const explicitProviderPercent = [
          quote.changePercent,
          quote.percentChange,
          quote.change_percent,
          quote.dp,
        ].find((value) =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          Number.isFinite(Number(value))
        );
        const explicitProviderPercentAvailable =
          quote.changePercentAvailable === true ||
          quote.percentChangeAvailable === true;
        const percentChangeAvailable =
          (changeBasePrice > 0 && latestPrice > 0) ||
          (
            explicitProviderPercentAvailable &&
            explicitProviderPercent !== undefined
          );
        const cryptoPercentChange = changeBasePrice > 0 && latestPrice > 0
          ? ((latestPrice - changeBasePrice) / changeBasePrice) * 100
          : percentChangeAvailable
            ? Number(explicitProviderPercent)
            : null;
        const changeReferenceType = dailyChangeReference?.type ||
          (firstBarClose > 0
            ? "intraday_window_open"
            : providerReferencePrice > 0
              ? quote.percentChangeReferenceType ||
                quote.changeReferenceType ||
                "provider_reference"
            : explicitProviderPercentAvailable
              ? "provider_measured_percent"
              : null);
        const percentChangeSource = dailyChangeReference?.source ||
          (firstBarClose > 0
            ? "crypto_scanner_intraday_bars"
            : quote.liveQuoteSource || quote.source || null);
        const dayChangeAvailable = percentChangeAvailable && [
          "previous_completed_utc_daily_close",
          "current_utc_day_open",
          "previous_close",
        ].includes(changeReferenceType);
        const cryptoDollarChange =
          changeBasePrice > 0 && latestPrice > 0
            ? latestPrice - changeBasePrice
            : percentChangeAvailable && latestPrice > 0
              ? latestPrice * (cryptoPercentChange / 100)
              : null;
        const cachedCryptoQuote = updateQuoteCache(symbol, {
          price: latestPrice,
          current: latestPrice,
          bid: quote.bid,
          ask: quote.ask,
          source: quote.liveQuoteSource || "crypto_quote_unavailable",
          liveQuoteSource: quote.liveQuoteSource || "crypto_quote_unavailable",
          liveQuoteUpdatedAt:
            quote.liveQuoteUpdatedAt || quote.quoteFetchedAt || null,
          quoteFetchedAt: quote.quoteFetchedAt,
          spreadUpdatedAt:
            quote.spreadUpdatedAt || quote.bidAskUpdatedAt || null,
          bidAskUpdatedAt:
            quote.spreadUpdatedAt || quote.bidAskUpdatedAt || null,
          spreadSource:
            quote.spreadSource || quote.liveQuoteSource || null,
          priceIsLive: quote.priceIsLive === true,
          percentChange: cryptoPercentChange,
          changePercent: cryptoPercentChange,
          dayChangePercent: dayChangeAvailable ? cryptoPercentChange : null,
          percentChangeAvailable,
          changePercentAvailable: percentChangeAvailable,
          dayChangePercentAvailable: dayChangeAvailable,
          percentChangeReferencePrice:
            changeBasePrice > 0 ? changeBasePrice : null,
          changeReferencePrice:
            changeBasePrice > 0 ? changeBasePrice : null,
          percentChangeReferenceType: changeReferenceType,
          changeReferenceType,
          percentChangeSource,
          dayChangePercentSource:
            dayChangeAvailable ? percentChangeSource : null,
          raw: quote,
        });
        const liquidityMetrics =
          calculateCryptoLiquidityFromBars(
            bars,
            latestPrice,
            quote
          );
        const spreadAvailable =
          Number(quote.bid || 0) > 0 &&
          Number(quote.ask || 0) >= Number(quote.bid || 0);
        const spreadPercent =
          spreadAvailable
            ? ((Number(quote.ask) - Number(quote.bid)) /
              ((Number(quote.ask) + Number(quote.bid)) / 2)) *
            100
            : null;
        const cryptoDiscoveryScorecard = calculateCryptoEarlyDiscoveryScore({
          symbol,
          dailyBars,
          intradayBars: bars,
          currentPrice: latestPrice,
          newsCatalyst,
          learning: engineState.quietCandidateOutcomeLearning?.crypto || null,
        });
        const score = cryptoDiscoveryScorecard.score;
        const canonicalCryptoEntryQuality = calculateCryptoEntryQualityFromEvidence({
          spreadAvailable,
          spreadPercent,
          liquidityEvidence: resolveCryptoLiquidityEvidence(liquidityMetrics),
        });
        const cryptoChartBars = Array.isArray(bars)
          ? bars
            .map((bar) => {
              const close = Number(bar.c || bar.close || 0);
              const open = Number(bar.o || bar.open || close || 0);
              const high = Number(bar.h || bar.high || close || 0);
              const low = Number(bar.l || bar.low || close || 0);
              const volume = Number(bar.v || bar.volume || 0);
              return {
                time: bar.t || bar.timestamp || bar.time || null,
                open,
                high,
                low,
                close,
                price: close,
                volume,
                intervalMs: bar.intervalMs,
              };
            })
            .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
          : [];
        const cryptoSparkline = cryptoChartBars.map((bar) => bar.close);
        const cryptoQualification =
          calculateCryptoInstitutionalQualification({
            quote,
            score,
            entryQualityScore: canonicalCryptoEntryQuality.score,
            bars,
            discoveryScorecard: cryptoDiscoveryScorecard,
            liquidityMetrics,
            spreadPercent,
            spreadAvailable,
          });
        results.push({
          ...quote,
          scoringModelVersion: "SMARTMONEY_CRYPTO_DECISION_V4",
          assetClass: "crypto",
          asset_class: "crypto",
          livePrice: latestPrice,
          displayPrice: latestPrice,
          price: latestPrice,
          current: latestPrice,
          liveQuoteUpdatedAt:
            cachedCryptoQuote?.liveQuoteUpdatedAt ||
            cachedCryptoQuote?.updatedAt ||
            null,
          spreadUpdatedAt:
            cachedCryptoQuote?.spreadUpdatedAt ||
            cachedCryptoQuote?.bidAskUpdatedAt ||
            null,
          bidAskUpdatedAt:
            cachedCryptoQuote?.spreadUpdatedAt ||
            cachedCryptoQuote?.bidAskUpdatedAt ||
            null,
          liveQuoteSource:
            cachedCryptoQuote?.liveQuoteSource ||
            cachedCryptoQuote?.source ||
            quote.liveQuoteSource ||
            "crypto_quote_unavailable",
          spreadSource:
            cachedCryptoQuote?.spreadSource ||
            cachedCryptoQuote?.source ||
            null,
          priceIsLive:
            cachedCryptoQuote?.priceIsLive === true,
          priceStale:
            cachedCryptoQuote?.priceIsLive !== true,
          dayChangePercent: dayChangeAvailable
            ? Number(cryptoPercentChange.toFixed(2))
            : null,
          dayChangeDollars: dayChangeAvailable
            ? Number(cryptoDollarChange.toFixed(2))
            : null,
          percentChange: percentChangeAvailable
            ? Number(cryptoPercentChange.toFixed(2))
            : null,
          changePercent: percentChangeAvailable
            ? Number(cryptoPercentChange.toFixed(2))
            : null,
          percentChangeAvailable,
          changePercentAvailable: percentChangeAvailable,
          dayChangePercentAvailable: dayChangeAvailable,
          percentChangeReferencePrice:
            changeBasePrice > 0 ? changeBasePrice : null,
          changeReferencePrice:
            changeBasePrice > 0 ? changeBasePrice : null,
          percentChangeReferenceType: changeReferenceType,
          changeReferenceType,
          percentChangeSource,
          dayChangePercentSource:
            dayChangeAvailable ? percentChangeSource : null,
          rawCryptoScore: score,
          scannerScore: score,
          score,
          legacyMomentumScore,
          cryptoEntryScore: canonicalCryptoEntryQuality.available
            ? canonicalCryptoEntryQuality.score
            : null,
          cryptoEntryScoreAvailable: canonicalCryptoEntryQuality.available === true,
          cryptoEntryScorecard: canonicalCryptoEntryQuality,
          cryptoDiscoveryScore: score,
          cryptoDiscoveryScoreAvailable:
            Number(cryptoDiscoveryScorecard.coverage || 0) >= 0.5,
          cryptoDiscoveryTier: cryptoDiscoveryScorecard.tier,
          cryptoDiscoveryScorecard,
          discoveryScorecard: cryptoDiscoveryScorecard,
          discoveryScore: score,
          discoveryTier: cryptoDiscoveryScorecard.tier,
          multiHorizonExtension: cryptoDiscoveryScorecard.extension,
          continuationScorecard: {
            score: cryptoContinuationMemory.available === true
              ? cryptoContinuationMemory.score
              : null,
            available: cryptoContinuationMemory.available === true,
            coverage: Number(cryptoContinuationMemory.coverage || 0),
            tier: cryptoContinuationMemory.tier,
            source:
              cryptoContinuationMemory.source ||
              "persisted_crypto_daily_sessions",
            observedSessions: Number(
              cryptoContinuationMemory.observedSessions || 0
            ),
          },
          multiDayContinuationScore:
            cryptoContinuationMemory.available === true
              ? cryptoContinuationMemory.score
              : null,
          multiDayScore:
            cryptoContinuationMemory.available === true
              ? cryptoContinuationMemory.score
              : null,
          multiDayScoreAvailable: cryptoContinuationMemory.available === true,
          cryptoDecisionScore: null,
          cryptoDecisionScoreAvailable: false,
          missingEvidenceReasons: [
            ...(canonicalCryptoEntryQuality.available
              ? []
              : ["CRYPTO_ENTRY_SCORE_UNAVAILABLE"]),
            ...(cryptoContinuationMemory.available === true
              ? []
              : ["CRYPTO_MULTI_DAY_EVIDENCE_UNAVAILABLE"]),
            "CANONICAL_CRYPTO_FINAL_DECISION_PENDING_CENTRAL_CORE",
          ],
          newsCatalyst,
          newsRisk: newsCatalyst?.riskDetected === true,
          dailyBarsFound: Array.isArray(dailyBars) ? dailyBars.length : 0,
          barsFound: bars.length,
          chartBars: cryptoChartBars,
          sparkline: cryptoSparkline,
          chartSource: "alpaca_crypto_bars",
          chartTimeframe: "best_available_live_crypto",
          latestChartClose:
            cryptoSparkline[cryptoSparkline.length - 1] || latestPrice,
          volume: liquidityMetrics.volume,
          averageVolume: liquidityMetrics.averageVolume,
          volumeSpikeRatio: liquidityMetrics.volumeSpikeRatio,
          dollarVolume: liquidityMetrics.dollarVolume,
          dollarVolume24h: liquidityMetrics.dollarVolume24h,
          windowDollarVolume: liquidityMetrics.windowDollarVolume,
          normalizedWindowDollarVolume:
            liquidityMetrics.normalizedWindowDollarVolume,
          liquidityWindowMinutes: liquidityMetrics.liquidityWindowMinutes,
          medianBarMinutes: liquidityMetrics.medianBarMinutes,
          latestBarDollarVolume: liquidityMetrics.latestBarDollarVolume,
          averageBarDollarVolume: liquidityMetrics.averageBarDollarVolume,
          liquiditySource: liquidityMetrics.liquiditySource,
          spreadAvailable,
          spreadPercent: spreadPercent === null
            ? null
            : Number(spreadPercent.toFixed(3)),
          confirmations: {
            volumeSpikeRatio: liquidityMetrics.volumeSpikeRatio,
          },
          autoTradeApproved:
            cryptoQualification.qualifiedToBuy === true,
          approved:
            cryptoQualification.qualifiedToBuy === true,
          backendApproved:
            cryptoQualification.qualifiedToBuy === true,
          decisionLevel:
            cryptoQualification.qualifiedToBuy === true
              ? "Auto-Trade Approved"
              : "Watchlist",
          ...cryptoQualification,
        });
      } catch (err) {
        cryptoSkipped.push({
          symbol,
          reason: err.message,
        });
        recordSkippedSymbol(symbol, err.message);
      }
    });
    if (typeof getCryptoLatestQuotes === "function" && results.length > 0) {
      try {
        const refreshedAt = Date.now();
        const finalAlpacaQuotes = await getCryptoLatestQuotes(
          results.map((signal) => signal.symbol)
        );
        const finalAlpacaQuotesBySymbol = new Map(
          (Array.isArray(finalAlpacaQuotes) ? finalAlpacaQuotes : [])
            .filter((quote) => quote?.symbol)
            .map((quote) => [String(quote.symbol).toUpperCase(), quote])
        );
        for (const signal of results) {
          const alpacaQuote = finalAlpacaQuotesBySymbol.get(
            String(signal.symbol).toUpperCase()
          );
          const executionQuote = mergeLatestCryptoPriceWithAlpacaSpread(
            signal,
            alpacaQuote,
            { now: refreshedAt, maxSpreadAgeSeconds: 5 }
          );
          if (!executionQuote) continue;
          const refreshedPrice = firstPositiveNumber(
            executionQuote.current,
            executionQuote.price,
            signal.current
          );
          const referencePrice = firstPositiveNumber(
            signal.percentChangeReferencePrice,
            signal.changeReferencePrice
          );
          const refreshedPercentAvailable =
            refreshedPrice > 0 && referencePrice > 0
              ? true
              : signal.percentChangeAvailable === true;
          const refreshedPercentChange =
            refreshedPrice > 0 && referencePrice > 0
              ? ((refreshedPrice - referencePrice) / referencePrice) * 100
              : refreshedPercentAvailable
                ? Number(signal.percentChange)
                : null;
          const refreshedDayChangeAvailable =
            refreshedPercentAvailable && signal.dayChangePercentAvailable === true;
          const refreshedCache = updateQuoteCache(signal.symbol, {
            ...executionQuote,
            price: refreshedPrice,
            current: refreshedPrice,
            percentChange: refreshedPercentChange,
            changePercent: refreshedPercentChange,
            dayChangePercent: refreshedDayChangeAvailable
              ? refreshedPercentChange
              : null,
            percentChangeAvailable: refreshedPercentAvailable,
            changePercentAvailable: refreshedPercentAvailable,
            dayChangePercentAvailable: refreshedDayChangeAvailable,
            percentChangeReferencePrice: referencePrice || null,
            changeReferencePrice: referencePrice || null,
            percentChangeReferenceType: signal.percentChangeReferenceType,
            changeReferenceType: signal.changeReferenceType,
            percentChangeSource: signal.percentChangeSource,
          });
          const finalPrice = firstPositiveNumber(
            refreshedCache?.price,
            refreshedPrice
          );
          const spreadAvailable =
            executionQuote.spreadAvailable === true &&
            Number(executionQuote.bid || 0) > 0 &&
            Number(executionQuote.ask || 0) >= Number(executionQuote.bid || 0);
          const spreadPercent = spreadAvailable
            ? ((Number(executionQuote.ask) - Number(executionQuote.bid)) /
              ((Number(executionQuote.ask) + Number(executionQuote.bid)) / 2)) * 100
            : null;
          const liquidityMetrics = calculateCryptoLiquidityFromBars(
            signal.chartBars,
            finalPrice,
            { ...signal, ...executionQuote, current: finalPrice }
          );
          const entryQuality = calculateCryptoEntryQualityFromEvidence({
            spreadAvailable,
            spreadPercent,
            liquidityEvidence: resolveCryptoLiquidityEvidence(liquidityMetrics),
          });
          const qualification = calculateCryptoInstitutionalQualification({
            quote: {
              ...signal,
              ...executionQuote,
              current: finalPrice,
              price: finalPrice,
            },
            score: signal.cryptoDiscoveryScore,
            entryQualityScore: entryQuality.score,
            bars: signal.chartBars,
            discoveryScorecard: signal.cryptoDiscoveryScorecard,
            liquidityMetrics,
            spreadPercent,
            spreadAvailable,
          });
          const finalPercentChange = referencePrice > 0 && finalPrice > 0
            ? ((finalPrice - referencePrice) / referencePrice) * 100
            : refreshedPercentChange;
          Object.assign(signal, {
            livePrice: finalPrice,
            displayPrice: finalPrice,
            price: finalPrice,
            current: finalPrice,
            bid: spreadAvailable ? Number(executionQuote.bid) : null,
            ask: spreadAvailable ? Number(executionQuote.ask) : null,
            spreadAvailable,
            spreadPercent: spreadPercent === null
              ? null
              : Number(spreadPercent.toFixed(3)),
            spreadUpdatedAt: spreadAvailable
              ? executionQuote.spreadUpdatedAt || executionQuote.bidAskUpdatedAt
              : null,
            bidAskUpdatedAt: spreadAvailable
              ? executionQuote.bidAskUpdatedAt || executionQuote.spreadUpdatedAt
              : null,
            spreadSource: spreadAvailable
              ? executionQuote.spreadSource
              : null,
            liveQuoteUpdatedAt:
              refreshedCache?.liveQuoteUpdatedAt ||
              executionQuote.liveQuoteUpdatedAt ||
              executionQuote.quoteFetchedAt ||
              null,
            liveQuoteSource:
              refreshedCache?.liveQuoteSource ||
              executionQuote.liveQuoteSource ||
              executionQuote.source ||
              null,
            priceIsLive: refreshedCache?.priceIsLive === true,
            priceStale: refreshedCache?.priceIsLive !== true,
            percentChange: refreshedPercentAvailable
              ? Number(finalPercentChange.toFixed(2))
              : null,
            changePercent: refreshedPercentAvailable
              ? Number(finalPercentChange.toFixed(2))
              : null,
            dayChangePercent: refreshedDayChangeAvailable
              ? Number(finalPercentChange.toFixed(2))
              : null,
            dayChangeDollars: refreshedDayChangeAvailable
              ? Number((finalPrice - referencePrice).toFixed(2))
              : null,
            percentChangeAvailable: refreshedPercentAvailable,
            changePercentAvailable: refreshedPercentAvailable,
            dayChangePercentAvailable: refreshedDayChangeAvailable,
            cryptoEntryScore: entryQuality.available
              ? entryQuality.score
              : null,
            cryptoEntryScoreAvailable: entryQuality.available === true,
            missingEvidenceReasons: [
              ...(Array.isArray(signal.missingEvidenceReasons)
                ? signal.missingEvidenceReasons.filter(
                  (reason) => reason !== "CRYPTO_ENTRY_SCORE_UNAVAILABLE"
                )
                : []),
              ...(entryQuality.available
                ? []
                : ["CRYPTO_ENTRY_SCORE_UNAVAILABLE"]),
            ],
            cryptoEntryScorecard: entryQuality,
            ...qualification,
            autoTradeApproved: qualification.qualifiedToBuy === true,
            approved: qualification.qualifiedToBuy === true,
            backendApproved: qualification.qualifiedToBuy === true,
            decisionLevel: qualification.qualifiedToBuy === true
              ? "Auto-Trade Approved"
              : "Watchlist",
          });
        }
      } catch (error) {
        console.warn("Final Alpaca crypto quote batch failed:", error.message);
      }
    }
    const btcMarketContext = assessBtcContext(btcBars);
    for (const signal of results) {
      signal.btcMarketContext = btcMarketContext;
      signal.cryptoSetup = assessCryptoSetup(signal);
      signal.cryptoOpportunityLane = signal.cryptoSetup.eligible ? signal.cryptoSetup.route : 'EARLY_DISCOVERY';
      signal.stopPrice = signal.cryptoSetup.eligible ? signal.cryptoSetup.stopPrice : null;
      signal.cryptoDerivativesContext = signal.cryptoSetup.derivatives;
      const gate = cryptoSetupGate(signal);
      signal.cryptoSetupGate = { approved: gate.approved, reasons: gate.reasons };
      signal.missingEvidenceReasons = [...new Set([...(signal.missingEvidenceReasons || []), ...gate.reasons])];
      // A measured continuation can qualify despite an intentionally low early-D.
      const continuation = signal.cryptoSetup.eligible;
      const q = signal.cryptoInstitutionalQualification;
      const approved = gate.approved && q?.dataPass && q?.entryQualityPass && q?.liquidityPass && q?.macroPass &&
        (q?.discoveryPass && q?.institutionalStructurePass || continuation && q?.cryptoTrapRiskScore <= 60) && !signal.newsRisk;
      Object.assign(signal, { qualifiedToBuy: Boolean(approved), autoTradeApproved: Boolean(approved), approved: Boolean(approved),
        backendApproved: Boolean(approved), decisionLevel: approved ? 'Auto-Trade Approved' : 'Watchlist' });
    }
    // Depth is needed only for actionable setups; keep routine provider load bounded.
    const depthSymbols = results.filter(s => s.cryptoSetup?.eligible).sort((a, b) => b.cryptoSetup.score - a.cryptoSetup.score)
      .slice(0, 20).map(s => s.symbol);
    const books = typeof getCryptoOrderbooks === 'function' && depthSymbols.length
      ? await getCryptoOrderbooks(depthSymbols).catch(() => []) : [];
    for (const signal of results) signal.cryptoOrderbook = books.find(b => b.symbol === signal.symbol) || null;
    console.log("CRYPTO SCAN DEBUG", {
      totalCryptoAssets: symbols.length,
      usdPairs: symbols.filter((s) => String(s || "").endsWith("/USD")).length,
      results: results.length,
      skipped: cryptoSkipped.slice(0, 20),
    });
    console.log("SCAN DEBUG", {
      totalResults: results.length,
      stockResults: results.filter((s) => !isCrypto(s.symbol)).length,
      cryptoResults: results.filter((s) => isCrypto(s.symbol)).length,
      topSymbols: results.slice(0, 10).map((s) => s.symbol),
    });
    const quietCandidates = results
      .filter((signal) =>
        Number(signal.cryptoDiscoveryScore || 0) >= 58 &&
        signal.cryptoDiscoveryScorecard?.extension?.alreadyExtended !== true &&
        signal.newsCatalyst?.riskDetected !== true
      )
      .sort((a, b) => Number(b.cryptoDiscoveryScore || 0) - Number(a.cryptoDiscoveryScore || 0))
      .slice(0, 25);
    const compactQuietCandidates = quietCandidates.map((signal) => ({
      symbol: signal.symbol,
      assetClass: "crypto",
      candidateSource: "EARLY_DISCOVERY",
      current: Number(signal.current || 0),
      cryptoDiscoveryScore: Number(signal.cryptoDiscoveryScore || 0),
      cryptoDiscoveryTier: signal.cryptoDiscoveryTier,
      cryptoDiscoveryScorecard: {
        stage: signal.cryptoDiscoveryScorecard?.stage,
        score: signal.cryptoDiscoveryScorecard?.score,
        rawScore: signal.cryptoDiscoveryScorecard?.rawScore,
        coverage: signal.cryptoDiscoveryScorecard?.coverage,
        components: signal.cryptoDiscoveryScorecard?.components,
        extension: signal.cryptoDiscoveryScorecard?.extension,
        gates: signal.cryptoDiscoveryScorecard?.gates,
      },
      newsCatalyst: signal.newsCatalyst
        ? {
          catalystAvailable: signal.newsCatalyst.catalystAvailable,
          catalystScore: signal.newsCatalyst.catalystScore,
          riskDetected: signal.newsCatalyst.riskDetected,
          label: signal.newsCatalyst.label,
          articleCount: signal.newsCatalyst.articleCount,
        }
        : null,
    }));
    engineState.cryptoQuietDiscoveryState = {
      phase: "CRYPTO_QUIET_PRE_MOVE_DISCOVERY",
      updatedAt: new Date().toISOString(),
      reviewedCount: results.length,
      selectedCount: compactQuietCandidates.length,
      topCandidates: compactQuietCandidates,
      reason: quietCandidates.length > 0
        ? "Quiet crypto candidates selected before extension."
        : "No quiet crypto candidate met the current discovery floor.",
    };
    return results.sort((a, b) => b.score - a.score);
  }

  return { scoreCrypto, calculateCryptoInstitutionalQualification, scanCryptoMarket };
}
