import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSignalPushQueue } from "../live/liveSignalPushQueue.js";

test("quote bursts keep every symbol and the latest update per symbol alongside decisions", () => {
  const queue = createLiveSignalPushQueue();
  queue.enqueue({ type: "LIVE_QUOTE_DELTA", symbol: "BTC/USD", stateVersion: 1 });
  queue.enqueue({ type: "LIVE_SIGNAL_UPDATE", items: [{ symbol: "AAPL", approved: false }] });
  queue.enqueue({ type: "LIVE_QUOTE_DELTA", symbol: "AAPL", stateVersion: 2 });
  queue.enqueue({ type: "LIVE_QUOTE_DELTA", symbol: "X:BTCUSD", stateVersion: 3 });
  queue.enqueue({ type: "LIVE_QUOTE_DELTA", symbol: "BTC-USD", stateVersion: 1 });
  const events = queue.drain();
  assert.equal(events.length, 3);
  assert.deepEqual(events.filter((x) => x.type === "LIVE_QUOTE_DELTA").map((x) => x.stateVersion), [2, 3]);
  assert.equal(events[0].items[0].approved, false);
  assert.deepEqual(queue.drain(), []);
});

test("quote backlog stays bounded", () => {
  const queue = createLiveSignalPushQueue(3);
  for (let i = 0; i < 100; i++) queue.enqueue({ type: "LIVE_QUOTE_DELTA", symbol: `S${i}`, stateVersion: i });
  assert.deepEqual(queue.drain().map((x) => x.stateVersion), [97, 98, 99]);
});
