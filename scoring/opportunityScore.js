export function clampScore(score) {
  return Math.max(0, Math.min(100, Number(score) || 0));
}

export function classifyOpportunity(score) {
  if (score >= 90) return "ELITE";
  if (score >= 80) return "STRONG";
  if (score >= 70) return "WATCH";
  return "IGNORE";
}