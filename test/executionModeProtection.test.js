import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("selected entry mode never disables stock or crypto protective exits", () => {
  const source = fs.readFileSync(
    new URL("../engine/createEngineCycle.js", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("const tradingStoppedForDay =");
  const end = source.indexOf("let stockSignals = []", start);
  const exitBoundary = source.slice(start, end);

  assert.match(exitBoundary, /await autoExitPositions\(marketOpen\);/);
  assert.match(exitBoundary, /await autoExitCryptoPositions\(\);/);
  assert.doesNotMatch(
    exitBoundary,
    /if\s*\([^)]*(?:stockModeEnabled|cryptoModeEnabled)[^)]*\)\s*\{[^}]*autoExit/s
  );
  assert.ok(
    exitBoundary.indexOf("await autoExitPositions(marketOpen);") <
      exitBoundary.indexOf("getEnabledStrategyModes(effectiveMode)")
  );
  assert.ok(
    exitBoundary.indexOf("await autoExitCryptoPositions();") >
      exitBoundary.indexOf("getEnabledStrategyModes(effectiveMode)")
  );
});
