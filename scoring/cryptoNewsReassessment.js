function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

export function cryptoNewsMaterialVersion(result = {}) {
  const evidence = result?.newsEvidence || {};
  return JSON.stringify({
    providerState: evidence.providerState || null,
    coverageState: evidence.coverageState || null,
    catalystState: evidence.catalystState || null,
    adverseState: evidence.adverseState || null,
    newestCheckedAt: evidence.newestCheckedAt || null,
    relevantArticles: Number(evidence.relevantArticles || 0),
  });
}

export function evaluateCryptoNewsReassessment(symbol, result, previous = null) {
  const cleanSymbol = normalizeSymbol(symbol);
  const evidence = result?.newsEvidence || {};
  const materialVersion = cryptoNewsMaterialVersion(result);
  const symbolCovered = evidence.coverageState === "COVERED"
    || evidence.coverageState === "PARTIAL";
  const changed = materialVersion !== previous?.materialVersion;
  return {
    current: {
      ...evidence,
      materialVersion,
    },
    event: cleanSymbol && symbolCovered && changed
      ? {
        symbol: cleanSymbol,
        assetClass: "crypto",
        reassessmentPriority: 3,
        reassessmentEvent: `crypto-news:${evidence.checkedAt || new Date().toISOString()}`,
      }
      : null,
  };
}
