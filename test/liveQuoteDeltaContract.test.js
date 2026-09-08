import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("per-tick live signal push is a compact single-symbol delta", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = source.indexOf("function updateQuoteCache");
  const end = source.indexOf("function getSymbolsForPolygonLiveStream", start);
  const block = source.slice(start, end);
  const pushStart = block.indexOf("pushLiveSignalUpdate({");
  const pushEnd = block.indexOf("pushBackendStreamEvent", pushStart);
  const push = block.slice(pushStart, pushEnd);

  assert.match(push, /type:\s*"LIVE_QUOTE_DELTA"/);
  assert.match(push, /stateVersion:\s*nextQuoteVersion/);
  assert.match(push, /symbol:\s*cleanSymbol/);
  assert.match(push, /quote:\s*compactQuote/);
  assert.doesNotMatch(push, /buildLiveSignalPushPayload/);
  assert.doesNotMatch(push, /stockSignals|cryptoSignals|liveSignals/);
  assert.doesNotMatch(block, /pushBackendStreamEvent\("PRICE_EVENT"/);
});
