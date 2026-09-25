import test from 'node:test';
import assert from 'node:assert/strict';
import { reassessmentTrigger } from '../discovery/reassessmentTrigger.js';
import { CRYPTO_MIN_FINAL_SCORE_TO_BUY } from '../scoring/componentScore.js';
import { STOCK_EXECUTION_THRESHOLDS } from '../scoring/decisionScores.js';
import {
  CRYPTO_NEAR_LINE_MARGIN,
  STOCK_NEAR_LINE_MARGIN,
  isNearFinalBuyGate,
} from '../scoring/nearFinalBuyGate.js';

test('near-line is the open band below the canonical final buy gate', () => {
  assert.equal(STOCK_EXECUTION_THRESHOLDS.finalScore, 70);
  assert.equal(STOCK_EXECUTION_THRESHOLDS.strongScore, 78);
  assert.equal(CRYPTO_MIN_FINAL_SCORE_TO_BUY, 65);
  assert.equal(STOCK_NEAR_LINE_MARGIN, 5);
  assert.equal(CRYPTO_NEAR_LINE_MARGIN, 5);

  const stockGate = STOCK_EXECUTION_THRESHOLDS.finalScore;
  assert.equal(isNearFinalBuyGate(64, stockGate, STOCK_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(65, stockGate, STOCK_NEAR_LINE_MARGIN), true);
  assert.equal(isNearFinalBuyGate(69, stockGate, STOCK_NEAR_LINE_MARGIN), true);
  assert.equal(isNearFinalBuyGate(70, stockGate, STOCK_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(77, stockGate, STOCK_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(78, stockGate, STOCK_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(Number.NaN, stockGate, STOCK_NEAR_LINE_MARGIN), false);

  const cryptoGate = CRYPTO_MIN_FINAL_SCORE_TO_BUY;
  assert.equal(isNearFinalBuyGate(59, cryptoGate, CRYPTO_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(60, cryptoGate, CRYPTO_NEAR_LINE_MARGIN), true);
  assert.equal(isNearFinalBuyGate(64, cryptoGate, CRYPTO_NEAR_LINE_MARGIN), true);
  assert.equal(isNearFinalBuyGate(65, cryptoGate, CRYPTO_NEAR_LINE_MARGIN), false);
  assert.equal(isNearFinalBuyGate(85, cryptoGate, CRYPTO_NEAR_LINE_MARGIN), false);
});

test('reassessment priority 2 is only the near band and does not grant permission', () => {
  const stock = (score, extra = {}) => reassessmentTrigger({
    symbol: 'AAPL',
    stockDecisionScore: score,
    approved: false,
    ...extra,
  });
  assert.equal(stock(64).reassessmentPriority, 0);
  assert.equal(stock(65).reassessmentPriority, 2);
  assert.equal(stock(69).reassessmentPriority, 2);
  assert.equal(stock(70).reassessmentPriority, 0);
  assert.equal(stock(72).reassessmentPriority, 0);
  assert.equal(stock(78).reassessmentPriority, 0);
  assert.equal(stock(78).approved, false);
  assert.equal(stock(78, { reassessmentPriority: 2 }).reassessmentPriority, 0);

  const crypto = (score) => reassessmentTrigger({
    symbol: 'BTC/USD',
    cryptoDecisionScore: score,
    approved: false,
  });
  assert.equal(crypto(59).reassessmentPriority, 0);
  assert.equal(crypto(60).reassessmentPriority, 2);
  assert.equal(crypto(64).reassessmentPriority, 2);
  assert.equal(crypto(65).reassessmentPriority, 0);
  assert.equal(crypto(65).approved, false);

  assert.equal(reassessmentTrigger('AAPL'), 'AAPL');
  assert.equal(stock(80, { isHeldPosition: true }).reassessmentPriority, 3);
});
