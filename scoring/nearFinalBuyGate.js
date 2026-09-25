// Near-line is only the open band below the canonical final-score buy gate.
// It is not strongScore, the phone display floor, or the strategy hard floor.

export const STOCK_NEAR_LINE_MARGIN = 5;
export const CRYPTO_NEAR_LINE_MARGIN = 5;

export function isNearFinalBuyGate(finalScore, buyGate, margin = 5) {
  return (
    Number.isFinite(finalScore) &&
    Number.isFinite(buyGate) &&
    finalScore >= buyGate - margin &&
    finalScore < buyGate
  );
}
