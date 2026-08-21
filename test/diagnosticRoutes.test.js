import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetry } from "../routes/diagnosticRoutes.js";

test("telemetry bounds histories and exposes confidence mode", () => {
  const history = Array(30).fill(1), result = buildTelemetry({ averageSignalScore: 91,
    analyticsSnapshots: history, statisticalEdgeHistory: history, signalHistory: history,
    marketRegimeHistory: history, symbolCooldowns: { AAPL: "now" } }, { stale: false });
  assert.equal(result.confidenceWeightedMode, true);
  assert.equal(result.analyticsSnapshots.length, 20);
  assert.deepEqual(result.activeCooldowns, ["AAPL"]);
});
