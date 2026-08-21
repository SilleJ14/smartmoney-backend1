import {
  CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
  scoreSparseCryptoMarket,
} from "../scoring/cryptoScoring.js";

export function createCryptoMarketScanner(dependencies) {
  const {
    CONFIG,
    calculateCryptoLiquidityFromBars,
    calculateRunnerHoldQuality,
    calculateRunnerStageProfile,
    clampScore,
    engineState,
    getBestCryptoBars,
    getCryptoAssets,
    getCryptoLatestQuote,
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
    bars = [],
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
    const trendStructureScore = clampScore(
      45 +
      (Number(score || 0) >= 65 ? 10 : 0) +
      (Number(score || 0) >= 75 ? 12 : 0) +
      (volumeSpikeRatio >= 0.5 ? 10 : 0) +
      (volumeSpikeRatio >= 1.2 ? 12 : 0) +
      (volumeConfidenceScore >= 60 ? 12 : 0) +
      (spreadAvailable && cleanSpreadPercent <= 0.45 ? 10 : 0) -
      (!spreadAvailable ? 20 : cleanSpreadPercent > 0.85 ? 25 : 0) -
      (barsFound < 10 ? 30 : 0)
    );
    const cryptoTrapRiskScore = clampScore(
      25 +
      (!spreadAvailable ? 20 : cleanSpreadPercent > 0.85 ? 25 : 0) +
      (volumeConfidenceScore < 35 ? 18 : 0) +
      (volumeSpikeRatio < 0.15 ? 12 : 0) +
      (barsFound < 10 ? 30 : 0) -
      (Number(score || 0) >= 75 ? 10 : 0) -
      (volumeConfidenceScore >= 65 ? 12 : 0)
    );
    const institutionalCryptoScore = clampScore(
      Number(score || 0) * 0.45 +
      trendStructureScore * 0.25 +
      volumeConfidenceScore * 0.2 +
      (100 - cryptoTrapRiskScore) * 0.1
    );
    const institutionalCryptoGrade =
      institutionalCryptoScore >= 85 && cryptoTrapRiskScore <= 35
        ? "A_CRYPTO_INSTITUTIONAL"
        : institutionalCryptoScore >= 75 && cryptoTrapRiskScore <= 45
          ? "B_CRYPTO_STRONG"
          : institutionalCryptoScore >= 65 && cryptoTrapRiskScore <= 55
            ? "C_CRYPTO_PROBE"
            : "D_CRYPTO_AVOID";
    const momentumPass =
      Number(score || 0) >=
      Math.max(
        70,
        Number(CONFIG.minScoreToBuy || 70),
        Number(engineState.selfOptimizationState?.adaptiveMinScoreToBuy || 0)
      );
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
      institutionalCryptoScore >= 65 &&
      cryptoTrapRiskScore <= 60 &&
      institutionalCryptoGrade !== "D_CRYPTO_AVOID";
    const qualifiedToBuy =
      dataPass &&
      momentumPass &&
      liquidityPass &&
      macroPass &&
      institutionalStructurePass;
    return {
      qualifiedToBuy,
      cryptoInstitutionalQualification: {
        passed: qualifiedToBuy,
        approved: qualifiedToBuy,
        dataPass,
        momentumPass,
        liquidityPass,
        macroPass,
        spreadPass,
        spreadAvailable,
        barsFound,
        score,
        spreadPercent: cleanSpreadPercent,
        dollarVolume,
        volumeSpikeRatio,
        volumeConfidenceScore,
        institutionalCryptoScore,
        institutionalCryptoGrade,
        cryptoTrapRiskScore,
        trendStructureScore,
        institutionalStructurePass,
        reason: qualifiedToBuy
          ? "Crypto institutional qualification passed"
          : !spreadAvailable
            ? "Crypto institutional qualification failed: missing live spread"
            : "Crypto institutional qualification failed",
      },
    };
  }
  
  async function scanCryptoMarket() {
    const { TRADING_MODE, LIVE_ORDER_MAX_QUOTE_AGE_SECONDS } = getRuntime();
    if (!["live_crypto", "smart"].includes(TRADING_MODE)) {
      throw new Error("Crypto scanner is only available in live modes");
    }
    const symbols = await getCryptoAssets();
    const cryptoSkipped = [];
    const results = [];
    console.log("CRYPTO SCAN START", {
      totalCryptoAssets: symbols.length,
      sampleAssets: symbols.slice(0, 10),
      usdPairs: symbols.filter((s) => String(s || "").endsWith("/USD")).length,
    });
    engineState.skippedSymbols = [];
    engineState.lastCryptoScanStartedAt = new Date().toISOString();
    engineState.topCryptoSignals = [];
    for (const symbol of symbols) {
      const institutionalUsdPair = String(symbol || "").endsWith("/USD");
      if (!institutionalUsdPair) {
        continue;
      }
      try {
        const liveCryptoQuote = getFreshLiveCryptoQuote(
          symbol,
          LIVE_ORDER_MAX_QUOTE_AGE_SECONDS
        );
        const quote = liveCryptoQuote || await getCryptoLatestQuote(symbol);
        const bars = await getBestCryptoBars(symbol);
        const score = scoreCrypto(quote, bars);
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
        const changeBasePrice =
          firstBarClose > 0 && firstBarClose !== latestPrice
            ? firstBarClose
            : lastBarClose > 0 && lastBarClose !== latestPrice
              ? lastBarClose
              : Number(
                quote.previousClose ||
                quote.prevClose ||
                quote.open ||
                quote.o ||
                0
              );
        const cryptoPercentChange =
          changeBasePrice > 0 && latestPrice > 0
            ? ((latestPrice - changeBasePrice) / changeBasePrice) * 100
            : Number(
              quote.changePercent ||
              quote.percentChange ||
              quote.change_percent ||
              quote.dp ||
              0
            );
        const cryptoDollarChange =
          changeBasePrice > 0 && latestPrice > 0
            ? latestPrice - changeBasePrice
            : cryptoPercentChange !== 0 && latestPrice > 0
              ? latestPrice * (cryptoPercentChange / 100)
              : Number(
                quote.change ||
                quote.changeDollars ||
                quote.dollarChange ||
                0
              );
        const cachedCryptoQuote = updateQuoteCache(symbol, {
          price: latestPrice,
          current: latestPrice,
          bid: quote.bid,
          ask: quote.ask,
          source: quote.liveQuoteSource || "polygon_crypto_snapshot",
          liveQuoteSource: quote.liveQuoteSource || "polygon_crypto_snapshot",
          quoteFetchedAt: quote.quoteFetchedAt,
          priceIsLive: quote.priceIsLive === true,
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
              };
            })
            .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
          : [];
        const cryptoSparkline = cryptoChartBars.map((bar) => bar.close);
        const cryptoQualification =
          calculateCryptoInstitutionalQualification({
            quote,
            score,
            bars,
            liquidityMetrics,
            spreadPercent,
            spreadAvailable,
          });
        results.push({
          ...quote,
          assetClass: "crypto",
          asset_class: "crypto",
          livePrice: latestPrice,
          displayPrice: latestPrice,
          price: latestPrice,
          current: latestPrice,
          liveQuoteUpdatedAt:
            quote.quoteFetchedAt || cachedCryptoQuote?.updatedAt || new Date().toISOString(),
          liveQuoteSource:
            quote.liveQuoteSource || cachedCryptoQuote?.source || "polygon_crypto_snapshot",
          priceIsLive:
            cachedCryptoQuote?.priceIsLive === true ||
            quote.priceIsLive === true,
          priceStale:
            cachedCryptoQuote?.priceIsLive !== true &&
            quote.priceIsLive !== true,
          dayChangePercent: Number(cryptoPercentChange.toFixed(2)),
          dayChangeDollars: Number(cryptoDollarChange.toFixed(2)),
          percentChange: Number(cryptoPercentChange.toFixed(2)),
          changePercent: Number(cryptoPercentChange.toFixed(2)),
          rawCryptoScore: score,
          scannerScore: score,
          score,
          barsFound: bars.length,
          chartBars: cryptoChartBars,
          historicalBars: cryptoChartBars,
          sparkline: cryptoSparkline,
          chartSource: "polygon_crypto_aggs",
          chartTimeframe: "best_available_live_crypto",
          latestChartClose:
            cryptoSparkline[cryptoSparkline.length - 1] || latestPrice,
          volume: liquidityMetrics.volume,
          averageVolume: liquidityMetrics.averageVolume,
          volumeSpikeRatio: liquidityMetrics.volumeSpikeRatio,
          dollarVolume: liquidityMetrics.dollarVolume,
          dollarVolume24h: liquidityMetrics.dollarVolume24h,
          windowDollarVolume: liquidityMetrics.windowDollarVolume,
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
    }
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
    return results.sort((a, b) => b.score - a.score);
  }

  return { scoreCrypto, calculateCryptoInstitutionalQualification, scanCryptoMarket };
}
