import { cryptoSetupEvidence } from './cryptoSetupFixture.js';

// Synthetic evidence for authorization tests only; never loaded by production.
export function eligibleDecisionFixture(symbol, now = Date.now()) {
  const stamp = new Date(now).toISOString(), crypto = symbol.includes('/');
  return {
    ...(crypto ? cryptoSetupEvidence(100, now) : {}), symbol, current: 100, price: 100,
    masterFinalScore: 90, entryQualityScore: 90,
    entryQualityScorecard: { approved: true, coverage: 1 }, discoveryScorecard: { coverage: 1 },
    decisionScoreCoverage: 1, centralAutonomousAction: 'ALLOW', riskScore: 70,
    qualifiedToBuy: true, autoTradeApproved: true, approved: true, backendApproved: true,
    liveQuoteUpdatedAt: stamp, spreadUpdatedAt: stamp, decisionUpdatedAt: stamp,
    sizingDecisionUpdatedAt: stamp, finalApprovedTradeAmount: 25,
    liveQuoteSource: crypto ? 'alpaca_crypto_latest' : 'alpaca_latest_stock_quote',
    spreadSource: crypto ? 'alpaca_crypto_latest' : 'alpaca_latest_stock_quote',
    priceIsLive: true, bid: 99.95, ask: 100.05, spreadPercent: .1, spreadAvailable: true,
    ...(crypto ? { barsFound: 220, windowDollarVolume: 1000000,
      newsCatalyst: { dataAvailable: true, riskDetected: false },
      cryptoDiscoveryScorecard: { score: 90, coverage: 1, calculatedAt: stamp, extension: { alreadyExtended: false } },
      centralAutonomousDecisionCore: { updatedAt: stamp, action: 'ALLOW', cryptoDecisionEvidence: { coreEvidencePass: true } },
    } : {}),
  };
}
