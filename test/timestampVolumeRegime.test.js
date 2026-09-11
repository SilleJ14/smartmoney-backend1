import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { recentBarVolumeEvidence } from '../market-data/volumeEvidence.js';
import { independentMarketRegime } from '../market-data/independentMarketRegime.js';
import { calculateInstitutionalBlend } from '../scoring/institutionalBlend.js';
import { evaluateStockCandidateQuoteQuality } from '../market-data/stockCandidateQuality.js';
import { calculateCryptoLiquidityFromBars } from '../scoring/cryptoScoring.js';
import { installCentralDecision } from '../scoring/installCentralDecision.js';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const functionCode = name => { const node = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); return source.slice(node.start, node.end); };
const now = Date.parse('2026-09-11T15:00:00Z');
const benchmark = (symbol, changePercent = 1, trendPercent = 0.3) => ({ symbol, changePercent, trendPercent, quoteAt: now, barAt: now - 300000 });

test('actual movers filter evaluates quote timestamps AFTER delayed I/O', () => {
  const code = functionCode('loadPolygonMoverSymbols');
  const call = code.match(/filterAndRankStockCandidatesByExecutionQuality\(\{[\s\S]*?\}\)/)?.[0];
  assert.ok(call);
  let captured;
  vm.runInNewContext(call, { Date: { now: () => now + 12000 }, now,
    quoteReviewCandidates: [], executionQuotes: [], normalizeSymbol: s => s, quotePolicy: {},
    filterAndRankStockCandidatesByExecutionQuality: options => { captured = options; } });
  assert.equal(captured.now, now + 12000);
  const candidate = { symbol: 'TEST', current: 10, volume: 100000 };
  const quote = { bid: 9.99, ask: 10.01, liveQuoteUpdatedAt: new Date(now + 12000).toISOString(), spreadUpdatedAt: new Date(now + 12000).toISOString() };
  assert.equal(evaluateStockCandidateQuoteQuality(candidate, quote, { now: captured.now }).accepted, true);
  assert.ok(evaluateStockCandidateQuoteQuality(candidate, quote, { now }).reasons.includes('QUOTE_TIMESTAMP_IN_FUTURE'));
  quote.liveQuoteUpdatedAt = new Date(now + 25000).toISOString();
  assert.ok(evaluateStockCandidateQuoteQuality(candidate, quote, { now: captured.now }).reasons.includes('QUOTE_TIMESTAMP_IN_FUTURE'));
});

test('actual regime ignores low candidate scores and uses independent fresh benchmarks', () => {
  const context = vm.createContext({ independentMarketRegime, CONFIG: { enableMarketRegimeEngine: true },
    engineState: { benchmarkRegimeEvidence: [benchmark('SPY'), benchmark('QQQ')] }, Date: { now: () => now } });
  vm.runInContext(functionCode('detectMarketRegime'), context);
  assert.equal(context.detectMarketRegime([{ score: 0, riskScore: 0 }]).state, 'aggressive bullish');
  assert.deepEqual(context.detectMarketRegime([]), context.detectMarketRegime([{ score: 99 }]));
});

test('missing, future, stale or duplicate benchmarks are unavailable, not fabricated bearish evidence', () => {
  for (const rows of [[], [benchmark('SPY')], [benchmark('SPY'), benchmark('SPY')],
    [benchmark('SPY'), { ...benchmark('QQQ'), quoteAt: now - 60001 }],
    [benchmark('SPY'), { ...benchmark('QQQ'), quoteAt: now + 5001 }],
    [benchmark('SPY'), { ...benchmark('QQQ'), barAt: now - 900001 }]]) {
    const result = independentMarketRegime(rows, { now });
    assert.equal(result.state, 'unavailable'); assert.equal(result.available, false);
    assert.ok(result.exposureMultiplier <= 0.5);
  }
  assert.equal(independentMarketRegime([benchmark('SPY', -3), benchmark('QQQ', -3)], { now }).state, 'panic/high volatility');
});

test('unavailable macro is excluded from score weights rather than scored zero', () => {
  const blend = calculateInstitutionalBlend({ momentum: 2, macroScore: null }, { clampScore: x => Math.max(0, Math.min(100, Number(x) || 0)) });
  assert.equal(blend.contextScore, null);
  assert.equal(blend.componentTelemetry.find(c => c.name === 'marketContext').available, false);
});

test('volume compares latest completed bar against prior bars only and keeps measured zero', () => {
  const bars = [...Array.from({ length: 20 }, () => ({ v: 1000 })), { v: 5000 }];
  assert.equal(recentBarVolumeEvidence(bars).ratio, 5);
  assert.equal(recentBarVolumeEvidence([...bars.slice(0, -1), { v: 0 }]).ratio, 0);
  assert.equal(recentBarVolumeEvidence([...bars.slice(0, -1), {}]).available, false);
  assert.equal(recentBarVolumeEvidence([{ v: 5 }]).ratio, null);
  assert.equal(recentBarVolumeEvidence(Array.from({ length: 10 }, () => ({ v: 0 }))).ratio, null);
});

test('actual stock bar stats preserve missing volume and attach its named basis', () => {
  const context = vm.createContext({ recentBarVolumeEvidence, CONFIG: {} });
  vm.runInContext(functionCode('computeBarStats'), context);
  const bars = Array.from({ length: 10 }, (_, i) => ({ o: 10, h: 11, l: 9, c: 10, v: i === 9 ? 290 : 1000 }));
  assert.equal(context.computeBarStats(bars).volumeSpikeRatio, 0.29);
  assert.equal(context.computeBarStats([]).volumeSpikeRatio, null);
  delete bars[9].v;
  assert.equal(context.computeBarStats(bars).recentVolume.available, false);
});

test('crypto zero-volume bar is zero, never fabricated 1x participation', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ c: 100, v: i === 19 ? 0 : 10, t: now - (20 - i) * 300000 }));
  assert.equal(calculateCryptoLiquidityFromBars(bars, 100).volumeSpikeRatio, 0);
  delete bars[19].v;
  assert.equal(calculateCryptoLiquidityFromBars(bars, 100).volumeSpikeRatio, null);
});

test('volume baseline does not bridge overnight gaps or mixed sources', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ v: 100, t: now - (20 - i) * 300000, source: 'alpaca' }));
  bars[19].t += 86400000;
  assert.equal(recentBarVolumeEvidence(bars).available, false);
  bars[19].t -= 86400000; bars[19].source = 'other';
  assert.equal(recentBarVolumeEvidence(bars).available, false);
});

test('actual fast score review refreshes evidence and never grants stale approval or sizing', async () => {
  let refreshed = false;
  const context = vm.createContext({
    refreshCryptoExecutionQuotes: async rows => { refreshed = true; return rows; },
    normalizeSymbol: s => s, installCentralDecision, normalizeSignalScoreCompleteness: s => s,
    calculateCentralAutonomousDecisionCore: (_stocks, crypto) => {
      assert.equal(refreshed, true);
      return { rankedDecisions: crypto.map(row => ({ symbol: row.symbol, cryptoDecisionScore: 80,
        cryptoDecisionEvidence: { analysisEvidencePass: true }, action: 'BUY' })) };
    },
  });
  vm.runInContext(functionCode('reviewCandidateScores'), context);
  const [row] = await context.reviewCandidateScores([{ symbol: 'BTC/USD', price: 100, approved: true, autoTradeApproved: true,
    finalApprovedTradeAmount: 100 }], true);
  assert.equal(row.cryptoDecisionScore, 80);
  assert.equal(row.approved, false); assert.equal(row.autoTradeApproved, false);
  assert.equal(row.finalApprovedTradeAmount, 0);
  assert.equal(row.executionEligibility.reasons[0], 'CENTRAL_RISK_AND_SIZING_REVIEW_REQUIRED');
});

test('actual benchmark refresh retains provider quote time, never receipt time', async () => {
  const state = {};
  const context = vm.createContext({ engineState: state, normalizeSymbol: s => s,
    canRefreshStockQuotes: () => true, getMarketSession: () => 'regular', Date: { now: () => now },
    getRecentBars: async () => Array.from({ length: 20 }, (_, i) => ({ c: 100, t: now - (20 - i) * 300000 })),
    getLatestStockMarketQuotes: async symbols => symbols.map(symbol => ({ symbol, price: 101, liveQuoteUpdatedAt: new Date(now).toISOString() })),
    getQuoteTimestampMs: quote => Date.parse(quote.liveQuoteUpdatedAt), detectMarketRegime: () => ({}) });
  vm.runInContext(functionCode('loadIndependentMarketRegime'), context);
  await context.loadIndependentMarketRegime();
  assert.equal(state.benchmarkRegimeEvidence[0].quoteAt, now);
  assert.ok(state.benchmarkRegimeEvidence[0].changePercent > 0);
});
