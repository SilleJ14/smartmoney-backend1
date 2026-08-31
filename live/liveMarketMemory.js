export function clampLiveScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

export function updateOneSecondCandle(memory, tick = {}, maxSecondCandles = 120) {
  const price = Number(tick.price || 0);
  const volume = Number(tick.volume || tick.size || 0);
  const providerTime = Date.parse(
    String(tick.liveQuoteUpdatedAt || tick.quoteFetchedAt || tick.providerTimestamp || "")
  );
  if (!Number.isFinite(providerTime)) return null;
  const now = providerTime;
  const secondKey = Math.floor(now / 1000) * 1000;

  if (!Array.isArray(memory.secondCandles)) {
    memory.secondCandles = [];
  }

  let candle = memory.secondCandles[memory.secondCandles.length - 1];

  if (!candle || candle.secondKey !== secondKey) {
    candle = {
      secondKey,
      startedAt: new Date(secondKey).toISOString(),
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      tickCount: 0,
    };

    memory.secondCandles.push(candle);
  }

  candle.high = Math.max(Number(candle.high || price), price);
  candle.low = Math.min(Number(candle.low || price), price);
  candle.close = price;
  candle.volume = Number(candle.volume || 0) + volume;
  candle.tickCount = Number(candle.tickCount || 0) + 1;

  memory.secondCandles = memory.secondCandles.slice(-maxSecondCandles);

  return candle;
}

export function calculateFastRunnerScoreFromMemory(memory = {}) {
  const candles = Array.isArray(memory.secondCandles)
    ? memory.secondCandles
    : [];

  const last = candles[candles.length - 1] || null;
  const prior10 = candles.slice(-10);
  const prior30 = candles.slice(-30);

  const first10 = prior10[0];
  const first30 = prior30[0];

  const price = Number(memory.price || 0);

  const momentum10 =
    first10?.open && price > 0
      ? ((price - Number(first10.open || 0)) / Number(first10.open || 1)) * 100
      : 0;

  const momentum30 =
    first30?.open && price > 0
      ? ((price - Number(first30.open || 0)) / Number(first30.open || 1)) * 100
      : 0;

  const recentVolume = prior10.reduce(
    (sum, candle) => sum + Number(candle.volume || 0),
    0
  );

  const longerVolume = prior30.reduce(
    (sum, candle) => sum + Number(candle.volume || 0),
    0
  );

  const avgVolumePerSecond =
    prior30.length > 0 ? longerVolume / prior30.length : 0;

  const volumeSpikeRatio =
    avgVolumePerSecond > 0
      ? recentVolume / Math.max(1, avgVolumePerSecond * Math.max(1, prior10.length))
      : 0;

  const closeNearHighPercent =
    last?.high && last?.low && Number(last.high) !== Number(last.low)
      ? ((Number(last.close || 0) - Number(last.low || 0)) /
          Math.max(0.0001, Number(last.high || 0) - Number(last.low || 0))) *
        100
      : 50;

  const spreadPercent = Number(memory.spreadPercent || 0);
  const tapeSpeed = Number(memory.tapeSpeed || 0);

  const liquidityScore =
    spreadPercent <= 0
      ? 50
      : spreadPercent <= 0.15
        ? 95
        : spreadPercent <= 0.35
          ? 80
          : spreadPercent <= 0.75
            ? 60
            : 35;

  const momentumScore = clampLiveScore(momentum10 * 12 + momentum30 * 6 + 50);
  const volumeScore = clampLiveScore(volumeSpikeRatio * 35 + 45);
  const closeNearHighScore = clampLiveScore(closeNearHighPercent);
  const tapeAccelerationScore = clampLiveScore(
    tapeSpeed * 14 +
      (volumeSpikeRatio >= 2 ? 12 : 0) +
      (volumeSpikeRatio >= 4 ? 18 : 0) +
      (momentum10 > 0 ? 10 : 0) +
      (momentum10 >= 0.4 ? 18 : 0) +
      (closeNearHighPercent >= 80 ? 12 : 0)
  );

  const tapeSpeedScore = tapeAccelerationScore;

  const fakeBreakoutRisk =
    momentum10 > 0.35 && closeNearHighPercent < 35
      ? 25
      : spreadPercent > 1
        ? 20
        : 0;

  const fastRunnerScore = clampLiveScore(
    momentumScore * 0.28 +
      volumeScore * 0.24 +
      tapeSpeedScore * 0.24 +
      closeNearHighScore * 0.16 +
      liquidityScore * 0.08 -
      fakeBreakoutRisk
  );

  return {
    fastRunnerScore: Number(fastRunnerScore.toFixed(2)),
    momentum10: Number(momentum10.toFixed(4)),
    momentum30: Number(momentum30.toFixed(4)),
    volumeSpikeRatio: Number(volumeSpikeRatio.toFixed(4)),
    tapeAccelerationScore: Number(tapeAccelerationScore.toFixed(2)),
    tapeSpeedScore: Number(tapeSpeedScore.toFixed(2)),
    closeNearHighPercent: Number(closeNearHighPercent.toFixed(2)),
    liquidityScore,
    tapeSpeed,
    fakeBreakoutRisk,
  };
}

export function buildRobinhoodStylePercentFields({
  price = 0,
  previousClose = 0,
  dayOpen = 0,
  regularClose = 0,
  session = "closed",
}) {
  const cleanPrice = Number(price || 0);
  const cleanPreviousClose = Number(previousClose || 0);
  const cleanDayOpen = Number(dayOpen || 0);
  const cleanRegularClose = Number(regularClose || 0);

  const todayPercent =
    cleanPrice > 0 && cleanPreviousClose > 0
      ? Number((((cleanPrice - cleanPreviousClose) / cleanPreviousClose) * 100).toFixed(4))
      : 0;

  const intradayPercent =
    cleanPrice > 0 && cleanDayOpen > 0
      ? Number((((cleanPrice - cleanDayOpen) / cleanDayOpen) * 100).toFixed(4))
      : todayPercent;

  const afterhoursPercent =
    cleanPrice > 0 && cleanRegularClose > 0
      ? Number((((cleanPrice - cleanRegularClose) / cleanRegularClose) * 100).toFixed(4))
      : 0;

  const displayPercent = session === "afterhours" ? afterhoursPercent : todayPercent;

  const displayPercentLabel =
    session === "premarket"
      ? "Pre-market"
      : session === "afterhours"
        ? "After-hours"
        : "Today";

  return {
    todayPercent,
    intradayPercent,
    afterhoursPercent,
    displayPercent,
    displayPercentLabel,
  };
}

export function updateLiveMarketMemory(symbol, tick = {}, {
  engineState,
  normalizeSymbol,
  getMarketSession,
  maxSecondCandles,
} = {}) {
  const cleanSymbol = normalizeSymbol(symbol);
  const price = Number(tick.price || 0);

  if (!cleanSymbol || !price || price <= 0) {
    return {};
  }

  engineState.liveMarketMemory ||= {};

  const previous =
    engineState.liveMarketMemory[cleanSymbol] || {
      symbol: cleanSymbol,
      price: 0,
      firstSeenAt: new Date().toISOString(),
      tickWindow: [],
      secondCandles: [],
    };

  const providerTime = Date.parse(
    String(tick.liveQuoteUpdatedAt || tick.quoteFetchedAt || tick.providerTimestamp || "")
  );
  if (!Number.isFinite(providerTime)) return previous;
  const previousProviderTime = Date.parse(String(previous.updatedAt || ""));
  if (
    Number.isFinite(previousProviderTime) &&
    providerTime < previousProviderTime
  ) {
    return previous;
  }
  const now = providerTime;
  const previousPrice = Number(previous.price || 0);

  const incomingPreviousClose = Number(
    tick.previousClose ||
      tick.pc ||
      tick.regularMarketPreviousClose ||
      0
  );

  const previousClose =
    incomingPreviousClose > 0
      ? incomingPreviousClose
      : Number(
          previous.previousClose ||
            previous.regularClose ||
            previous.dayPreviousClose ||
            0
        );

  const dayOpen = Number(
    tick.dayOpen ||
      tick.open ||
      tick.o ||
      previous.dayOpen ||
      0
  );

  const fallbackPercent = Number(
    tick.livePercentChange ??
      tick.percentChange ??
      tick.changePercent ??
      0
  );

  const session = getMarketSession({
    is_open: Boolean(engineState.marketOpen),
  });

  const regularClose = Number(
    tick.regularClose ||
      tick.close ||
      tick.c ||
      previous.regularClose ||
      previousClose ||
      0
  );

  const robinhoodPercent = buildRobinhoodStylePercentFields({
    price,
    previousClose,
    dayOpen,
    regularClose,
    session,
  });

  const livePercentChange =
    robinhoodPercent.todayPercent || Number(fallbackPercent || 0);

  const premarketPercent = robinhoodPercent.todayPercent;
  const intradayPercent = robinhoodPercent.intradayPercent;

  const bid = Number(tick.bid || previous.bid || 0);
  const ask = Number(tick.ask || previous.ask || 0);

  const spread =
    Number(tick.spread || 0) ||
    (bid > 0 && ask > 0
      ? Number((ask - bid).toFixed(4))
      : Number(previous.spread || 0));

  const spreadPercent =
    Number(tick.spreadPercent || 0) ||
    (spread > 0 && price > 0
      ? Number(((spread / price) * 100).toFixed(4))
      : Number(previous.spreadPercent || 0));

  const incomingVwap = Number(
    tick.vwap ||
      tick.dayVwap ||
      tick.avgPrice ||
      previous.vwap ||
      previous.dayVwap ||
      previous.avgPrice ||
      0
  );

  const tickWindow = Array.isArray(previous.tickWindow)
    ? previous.tickWindow
    : [];

  tickWindow.push({
    at: now,
    price,
    volume: Number(tick.volume || tick.size || 0),
  });

  const cutoff = now - 10000;
  const freshTickWindow = tickWindow.filter(
    (item) => Number(item.at || 0) >= cutoff
  );

  const tapeSpeed = Number((freshTickWindow.length / 10).toFixed(2));

  const nextMemory = {
    ...previous,
    symbol: cleanSymbol,
    price,
    current: price,
    previousClose,
    dayOpen,
    livePercentChange,
    premarketPercent,
    intradayPercent,
    todayPercent: robinhoodPercent.todayPercent,
    afterhoursPercent: robinhoodPercent.afterhoursPercent,
    displayPercent: robinhoodPercent.displayPercent,
    displayPercentLabel: robinhoodPercent.displayPercentLabel,
    regularClose,
    session,
    previousPrice: previousPrice || null,
    bid,
    ask,
    spread,
    spreadPercent,
    lastVolume: Number(tick.volume || 0),
    vwap: incomingVwap,
    dayVwap: incomingVwap,
    avgPrice: incomingVwap,
    lastSize: Number(tick.size || 0),
    source: tick.source || previous.source || "live_stream",
    updatedAt: new Date(providerTime).toISOString(),
    tickWindow: freshTickWindow,
    tapeSpeed,
    liquidityPressure:
      spreadPercent > 0
        ? Number((100 / Math.max(0.01, spreadPercent)).toFixed(2))
        : 0,
    raw: tick.raw || null,
  };

  updateOneSecondCandle(nextMemory, tick, maxSecondCandles);

  const vwapCandles = Array.isArray(nextMemory.secondCandles)
    ? nextMemory.secondCandles
    : [];

  const vwapTotals = vwapCandles.reduce(
    (totals, candle) => {
      const high = Number(candle.high || 0);
      const low = Number(candle.low || 0);
      const close = Number(candle.close || 0);
      const volume = Number(candle.volume || 0);

      if (high > 0 && low > 0 && close > 0 && volume > 0) {
        const typicalPrice = (high + low + close) / 3;
        totals.priceVolume += typicalPrice * volume;
        totals.volume += volume;
      }

      return totals;
    },
    {
      priceVolume: 0,
      volume: 0,
    }
  );

  const calculatedVwap =
    vwapTotals.volume > 0
      ? Number((vwapTotals.priceVolume / vwapTotals.volume).toFixed(4))
      : Number(nextMemory.vwap || 0);

  if (calculatedVwap > 0) {
    nextMemory.vwap = calculatedVwap;
    nextMemory.dayVwap = calculatedVwap;
    nextMemory.avgPrice = calculatedVwap;
  }

  const fastScore = calculateFastRunnerScoreFromMemory(nextMemory);

  nextMemory.fastRunnerScore = fastScore.fastRunnerScore;
  nextMemory.fastRunnerBreakdown = fastScore;
  nextMemory.liveMomentumPercent = fastScore.momentum10;

  engineState.liveMarketMemory[cleanSymbol] = nextMemory;

  return nextMemory;
}
