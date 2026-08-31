import test from "node:test";
import assert from "node:assert/strict";
import { buildRotatingScanUniverse } from "../discovery/scanUniverse.js";

test("60-symbol universe reserves rotating exploration slots", () => {
  const symbols = Array.from({ length: 120 }, (_, index) => `S${String(index).padStart(3, "0")}`);
  const getWeight = (symbol) => ({ symbol, scanWeight: 200 - Number(symbol.slice(1)) });
  const first = buildRotatingScanUniverse({
    symbols,
    guaranteedSymbols: symbols.slice(0, 6),
    getWeight,
    maxSymbols: 60,
    cursor: 0,
    explorationRatio: 0.2,
  });
  const second = buildRotatingScanUniverse({
    symbols,
    guaranteedSymbols: symbols.slice(0, 6),
    getWeight,
    maxSymbols: 60,
    cursor: first.nextCursor,
    explorationRatio: 0.2,
  });
  assert.equal(first.symbols.length, 60);
  assert.equal(first.explorationSymbols.length, 12);
  assert.notDeepEqual(second.explorationSymbols, first.explorationSymbols);
  assert.deepEqual(first.symbols.slice(0, 6), symbols.slice(0, 6));
});
