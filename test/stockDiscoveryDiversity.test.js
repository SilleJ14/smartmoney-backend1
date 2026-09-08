import test from "node:test";
import assert from "node:assert/strict";
import { createStockMarketStrategy } from "../strategies/stockMarketStrategy.js";

function createFilter() {
  return createStockMarketStrategy({
    CONFIG: {
      minStockPrice: 1,
      maxStockPrice: 1_000,
      minScanVolume: 300_000,
      minRunnerRelativeVolume: 5,
      maxRunnerFloatShares: 20_000_000,
      maxRunnerMarketCap: 1_000_000_000,
      maxPercentChange: 300,
      maxRunnerSpreadPercent: 3,
      maxRunnerPullbackFromHighPercent: 18,
      enableAdvancedFilters: true,
    },
    engineState: { marketOpen: true, preMoverDiscoveryMemory: {} },
    normalizeSymbol: (symbol) => String(symbol || "").toUpperCase(),
    isPremarketMomentumWindow: () => false,
    isMorningStrikeWindow: () => false,
  }).passesFilters;
}

test("valid-priced stock candidates remain visible across diverse incomplete evidence", () => {
  const passesFilters = createFilter();
  const candidates = Array.from({ length: 15 }, (_, index) => ({
    symbol: `WATCH${index}`,
    current: 5 + index,
    volume: index % 3 === 0 ? 50_000 : 350_000,
    relativeVolume: index % 4 === 0 ? 0.5 : 1,
    percentChange: index % 5 === 0 ? 0 : 0.2,
    spreadPercent: index % 6 === 0 ? 4 : 0.5,
    confirmations: {
      aboveVwap: index % 2 === 0,
      fakeBreakout: index % 7 === 0,
      newsRisk: index % 11 === 0,
      newsRiskReason: "measured risk",
    },
  }));

  const results = candidates.map((candidate) => passesFilters(candidate));
  assert.equal(results.filter((result) => result.ok).length, 15);
  assert.ok(results.filter((result) => result.discoveryOnly).length >= 12);
  assert.ok(candidates.every((candidate) => candidate.displayOnly === true));
  assert.ok(candidates.every((candidate) => candidate.blockBuying === true));
});

test("invalid zero-priced candidates are still removed from discovery", () => {
  const result = createFilter()({ symbol: "BROKEN", current: 0 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /No valid price/);
});
