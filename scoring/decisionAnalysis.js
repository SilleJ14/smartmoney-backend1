// A measured weak/risky score is still a score. This never grants execution.
// Legacy records remain fail-closed unless their full core evidence passed.
export function hasDecisionAnalysis(evidence) {
  return typeof evidence?.analysisEvidencePass === 'boolean'
    ? evidence.analysisEvidencePass : evidence?.coreEvidencePass === true;
}
