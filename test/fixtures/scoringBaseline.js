// Synthetic, fixed-input regression corpus. These are NOT captured provider
// payloads and do not establish real-world strategy performance.
export const scoringBaselineInputs = {
  complete: { symbol: 'BASE', historyDays: 30,
    multiHorizonExtension: { coverage: 1, alreadyExtended: false, extensionPenalty: 0 },
    preMoveScore: 88, percentChange: 2, catalystScore: 80,
    technicalBarsFound: 30, technicals: { ema9: 102, ema20: 100, macd: 2, macdSignal: 1, rsi: 60 },
    confirmations: { closeNearHighPercent: 95, aboveVwap: true, fakeBreakout: false, newsRisk: false, newsRiskAvailable: true },
    phase5SignalQuality: { liquidityStabilityScore: 90, breakoutRetestConfirmation: true, antiChaseRisk: 10 },
    spreadAvailable: true, bid: 99.9, ask: 100.1,
    contextScore: 80, riskPortfolioScore: 85, fundamentalScore: 75, fundamentalDataValid: true,
  },
};
scoringBaselineInputs.missingFundamentals = { ...scoringBaselineInputs.complete, fundamentalDataValid: false };
scoringBaselineInputs.lateMover = { ...scoringBaselineInputs.complete, percentChange: 12 };
scoringBaselineInputs.missingNews = { ...scoringBaselineInputs.complete, requireNewsRiskForEntry: true,
  confirmations: { ...scoringBaselineInputs.complete.confirmations, newsRiskAvailable: false } };
scoringBaselineInputs.sparse = { symbol: 'SPARSE', percentChange: 4 };
