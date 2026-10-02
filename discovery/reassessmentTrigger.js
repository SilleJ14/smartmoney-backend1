import { evaluateSetupDrift } from "../scoring/setupDrift.js";
import { STOCK_EXECUTION_THRESHOLDS } from "../scoring/decisionScores.js";
import {
  STOCK_NEAR_LINE_MARGIN,
  isNearFinalBuyGate,
} from "../scoring/nearFinalBuyGate.js";

// Classify urgency only. Never calculate a score or confer trading permission.
// Setup movement comes only from evaluateSetupDrift. This file must not keep
// a second price-distance rule.
// Near-line is [canonical buy gate - margin, canonical buy gate). A score that
// has reached the gate is no longer near; the score update requests central
// reauthorization instead of leaving this priority raised.
export function reassessmentTrigger(row, now = Date.now()) {
  if (!row || typeof row !== "object") return row;
  const drift = evaluateSetupDrift(row, { now });
  const merged = { ...row, ...drift };
  const crypto = String(merged.symbol || "").includes("/");
  const final = crypto ? merged.cryptoDecisionScore : merged.stockDecisionScore;
  const near = crypto
    ? false
    : isNearFinalBuyGate(final, STOCK_EXECUTION_THRESHOLDS.finalScore, STOCK_NEAR_LINE_MARGIN);
  const held = merged.isHeldPosition === true;
  const quoteReady = merged.liveQuoteFresh === true && merged.liveSpreadFresh === true;
  const missingEntry = crypto ? merged.cryptoEntryScoreAvailable === false : merged.entryQualityScoreAvailable === false;
  const evidenceEvent = quoteReady && missingEntry ? `evidence:${merged.decisionUpdatedAt || "new"}` : null;
  const priority = Math.max(
    Number(drift.reassessmentPriority) || 0,
    held ? 3 : near ? 2 : 0
  );
  return {
    ...merged,
    reassessmentPriority: priority,
    ...(evidenceEvent && !merged.reassessmentEvent ? { reassessmentEvent: evidenceEvent } : {}),
  };
}
