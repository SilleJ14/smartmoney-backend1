function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findLiveQuote(state, symbol, normalizeSymbol) {
  const clean = normalizeSymbol(symbol);
  const cache = state.liveQuoteCache || {};
  return (
    cache[clean] ||
    cache[clean.replace("/", "")] ||
    cache[clean.replace("-USD", "USD")] ||
    cache[clean.replace("/USD", "USD")] ||
    cache[clean.replace("USD", "/USD")] ||
    null
  );
}

function positiveNumbers(values) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

export function buildLiveMovers({
  state,
  limit = 50,
  normalizeSymbol,
  mergeLiveQuote,
  isCrypto,
  now = () => new Date(),
}) {
  const sourceSignals = [
    ...asArray(state.topStockSignals),
    ...asArray(state.lastStockSignals),
    ...asArray(state.topCryptoSignals),
    ...asArray(state.lastCryptoSignals),
    ...asArray(state.topSignals),
    ...asArray(state.lastSignals),
  ];
  const moversBySymbol = new Map();

  for (const rawSignal of sourceSignals) {
    const symbol = normalizeSymbol(rawSignal?.symbol);
    if (!symbol) continue;
    const merged = mergeLiveQuote(rawSignal);
    const liveQuote = findLiveQuote(state, symbol, normalizeSymbol) || {};
    const livePrice = Number(
      liveQuote.lastTradePrice ||
      liveQuote.tradePrice ||
      liveQuote.lastPrice ||
      liveQuote.markPrice ||
      liveQuote.midPrice ||
      liveQuote.price ||
      liveQuote.livePrice ||
      merged.lastTradePrice ||
      merged.tradePrice ||
      merged.lastPrice ||
      merged.markPrice ||
      merged.midPrice ||
      merged.livePrice ||
      merged.currentPrice ||
      (Number(merged.price || 0) > 0 && Number(merged.price || 0) !== Number(merged.high || 0)
        ? merged.price
        : 0) ||
      merged.current ||
      merged.close ||
      merged.c ||
      0
    );
    if (!Number.isFinite(livePrice) || livePrice <= 0) continue;

    const previousClose = Number(
      liveQuote.previousClose || liveQuote.prevClose || merged.previousClose || merged.prevClose || merged.pc || 0
    );
    const open = Number(liveQuote.open || liveQuote.dayOpen || merged.open || merged.dayOpen || merged.o || 0);
    const changePercent = previousClose > 0
      ? ((livePrice - previousClose) / previousClose) * 100
      : Number(
        merged.dayChangePercent ||
        merged.percentChange ||
        merged.changePercent ||
        liveQuote.percentChange ||
        liveQuote.livePercentChange ||
        0
      );
    const liveStarterCandidate =
      asArray(state.liveStarterBuyHistory).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.quickInstitutionalCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.fastRunnerCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      asArray(state.topAutonomousCandidates).find((item) => normalizeSymbol(item?.symbol) === symbol) ||
      {};
    const recommendedTradeAmount = Number(
      merged.recommendedTradeAmount ||
      merged.rawRecommendedTradeAmount ||
      merged.recommendedSize ||
      merged.tradeAmount ||
      merged.positionSize ||
      merged.dollarAmount ||
      merged.notional ||
      merged.positionSizing?.recommendedTradeAmount ||
      merged.positionSizing?.recommendedSize ||
      merged.portfolioManager?.recommendedTradeAmount ||
      merged.portfolioManager?.aiRecommendedTradeAmount ||
      liveStarterCandidate.decision?.starterAmount ||
      liveStarterCandidate.decision?.plannedFullTradeAmount ||
      state.aiEntryScores?.[symbol]?.starterAmount ||
      state.aiEntryScores?.[symbol]?.plannedFullTradeAmount ||
      liveStarterCandidate.recommendedTradeAmount ||
      liveStarterCandidate.rawRecommendedTradeAmount ||
      liveStarterCandidate.recommendedSize ||
      liveStarterCandidate.tradeAmount ||
      liveStarterCandidate.positionSize ||
      liveStarterCandidate.dollarAmount ||
      0
    );
    const cryptoAsset = isCrypto(symbol);
    const cryptoMemory =
      state.cryptoInstitutionalMemory?.[symbol] ||
      state.cryptoInstitutionalMemory?.[symbol.replace("/", "")] ||
      state.cryptoInstitutionalMemory?.[symbol.replace("-USD", "USD")] ||
      {};
    const cryptoScores = positiveNumbers([
      merged.score,
      merged.institutionalScore,
      merged.aiConfidence,
      merged.autonomousConfidenceScore,
      merged.quickInstitutionalScore,
      merged.executionConfidence,
      merged.cryptoInstitutionalScore,
      merged.cryptoLiquidityScore,
      merged.cryptoMomentumScore,
      merged.phase42CryptoInstitutional?.cryptoInstitutionalScore,
      merged.cryptoInstitutionalQualification?.cryptoInstitutionalScore,
      merged.cryptoInstitutionalQualification?.score,
      merged.cryptoInstitutionalQualification?.volumeConfidenceScore,
      cryptoMemory.cryptoInstitutionalScore,
      cryptoMemory.cryptoLiquidityScore,
      cryptoMemory.cryptoMomentumScore,
    ]);
    const stockScores = positiveNumbers([
      merged.score,
      merged.institutionalScore,
      merged.aiConfidence,
      merged.autonomousConfidenceScore,
      merged.quickInstitutionalScore,
      merged.executionConfidence,
      merged.runnerScore,
      merged.fastRunnerScore,
      merged.finalLiveScore,
      merged.gateScore,
    ]);
    const displayScore = cryptoAsset
      ? Math.max(...cryptoScores, Number(merged.score || 0))
      : Math.max(...stockScores, Number(merged.score || 0));
    const quickInstitutionalScore = cryptoAsset
      ? Math.max(
        displayScore,
        Number(merged.quickInstitutionalScore || 0),
        Number(merged.institutionalScore || 0),
        Number(merged.phase42CryptoInstitutional?.cryptoInstitutionalScore || 0),
        Number(cryptoMemory.cryptoInstitutionalScore || 0)
      )
      : Number(merged.quickInstitutionalScore || merged.institutionalScore || merged.score || 0);
    const next = {
      symbol,
      assetClass: merged.assetClass || merged.asset_class || (cryptoAsset ? "crypto" : "stock"),
      price: livePrice,
      livePrice,
      displayPrice: livePrice,
      current: livePrice,
      previousClose,
      open,
      dayOpen: open,
      changePercent,
      dayChangePercent: changePercent,
      percentChange: changePercent,
      bid: Number(liveQuote.bid || merged.bid || 0),
      ask: Number(liveQuote.ask || merged.ask || 0),
      spreadPercent: Number(liveQuote.spreadPercent || merged.spreadPercent || 0),
      liveQuoteUpdatedAt: now().toISOString(),
      liveQuoteSource:
        liveQuote.liveQuoteSource ||
        liveQuote.source ||
        liveQuote.dataSource ||
        merged.liveQuoteSource ||
        merged.source ||
        merged.dataSource ||
        "live_movers",
      priceIsLive: true,
      score: displayScore,
      institutionalScore: displayScore,
      aiConfidence: displayScore,
      autonomousConfidenceScore: displayScore,
      cryptoInstitutionalScore: displayScore,
      runnerScore: Number(merged.runnerScore || merged.fastRunnerScore || liveQuote.fastRunnerScore || 0),
      quickInstitutionalScore,
      tapeSpeedScore: Number(merged.tapeSpeedScore || merged.tapeSpeed || liveQuote.tapeSpeed || 0),
      liquidityPressureScore: Number(
        merged.liquidityPressureScore || merged.liquidityPressure || liveQuote.liquidityPressure || 0
      ),
      qualifiedToBuy: merged.qualifiedToBuy === true,
      backendApproved:
        merged.backendApproved === true ||
        merged.approved === true ||
        merged.qualifiedToBuy === true ||
        merged.autoTradeApproved === true,
      approved:
        merged.approved === true ||
        merged.backendApproved === true ||
        merged.qualifiedToBuy === true ||
        merged.autoTradeApproved === true,
      autoTradeApproved: merged.autoTradeApproved === true,
      recommendedTradeAmount,
      aiAllocationPercentOfBotBudget: Number(
        merged.aiAllocationPercentOfBotBudget ||
        merged.positionSizing?.aiAllocationPercentOfBotBudget ||
        merged.portfolioManager?.aiAllocationPercentOfBotBudget ||
        0
      ),
      aiPortfolioAction:
        merged.aiPortfolioAction ||
        merged.portfolioAction ||
        merged.portfolioManager?.aiPortfolioAction ||
        (merged.autoTradeApproved ? "AUTO-TRADE APPROVED" : "Watch Only"),
      portfolioManagerReason:
        merged.portfolioManagerReason ||
        merged.reason ||
        merged.pattern ||
        merged.tradeQuality ||
        "Live mover price update",
    };
    const current = moversBySymbol.get(symbol);
    if (!current || Math.abs(next.changePercent) > Math.abs(current.changePercent)) {
      moversBySymbol.set(symbol, next);
    }
  }

  return Array.from(moversBySymbol.values())
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, Math.min(100, Math.max(10, Number(limit || 50))));
}
