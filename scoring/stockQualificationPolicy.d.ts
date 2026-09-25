export const STOCK_EXECUTION_THRESHOLDS: {
  watchScore: number;
  watchlistScore: number;
  qualifiedScore: number;
  finalScore: number;
  entryScore: number;
  entryCoverage: number;
  strongScore: number;
  exceptionalScore: number;
  acceleratedFinalScore: number;
  acceleratedEntryScore: number;
  maxSpreadPercent: number;
  maxQuoteAgeSeconds: number;
  maxDecisionAgeSeconds: number;
  riskQualityScore: number;
};

export function classifyStockScoreBand(finalScore: number | null | undefined): string | null;

export function analyticalStockPass(input?: {
  finalScore?: number | null;
  entryScore?: number | null;
  entryCoverage?: number | null;
}): boolean;

export function classifyStockMarketStress(input?: {
  marketStress?: number | null;
  crashBlock?: boolean;
  macroBlock?: boolean;
}): {
  requiredF: number;
  movesRequiredF: boolean;
  band: string;
  R: { state: string; reason: string | null; affectsF: boolean };
  S: { multiplier: number; multiplierStatus: string; affectsF: boolean };
};
