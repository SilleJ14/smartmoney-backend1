import test from "node:test";
import assert from "node:assert/strict";
import {
  getPolygonProviderTimestamp,
  isUsableProviderTimestamp,
  parseProviderTimestamp,
} from "../market-data/providerTimestamp.js";

test("provider timestamps normalize seconds milliseconds microseconds and nanoseconds", () => {
  const expected = "2026-08-31T14:30:00.000Z";
  const milliseconds = Date.parse(expected);
  assert.equal(parseProviderTimestamp(milliseconds / 1000), expected);
  assert.equal(parseProviderTimestamp(milliseconds), expected);
  assert.equal(parseProviderTimestamp(milliseconds * 1000), expected);
  assert.equal(parseProviderTimestamp(milliseconds * 1e6), expected);
});

test("Polygon handlers select event time and reject missing or future timestamps", () => {
  const now = Date.parse("2026-08-31T14:30:00.000Z");
  assert.equal(getPolygonProviderTimestamp({ ev: "T", t: now }), new Date(now).toISOString());
  assert.equal(getPolygonProviderTimestamp({ ev: "A", e: now }), new Date(now).toISOString());
  assert.equal(getPolygonProviderTimestamp({ ev: "Q" }), null);
  assert.equal(isUsableProviderTimestamp(now + 6000, { now }), false);
  assert.equal(isUsableProviderTimestamp(now, { now }), true);
});
