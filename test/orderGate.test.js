import test from "node:test";
import assert from "node:assert/strict";

import {
  assertOrderAllowed,
  EMERGENCY_BUY_BLOCK_MESSAGE,
} from "../execution/orderGate.js";

test("blocks a new buy while the emergency stop is active", () => {
  assert.throws(
    () => assertOrderAllowed({
      path: "/v2/orders",
      options: { method: "POST", body: JSON.stringify({ side: "buy" }) },
      emergencyStopActive: true,
    }),
    new RegExp(EMERGENCY_BUY_BLOCK_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("allows a sell while the emergency stop is active", () => {
  assert.doesNotThrow(() => assertOrderAllowed({
    path: "/v2/orders",
    options: { method: "POST", body: JSON.stringify({ side: "sell" }) },
    emergencyStopActive: true,
  }));
});

test("fails closed on malformed order payloads during an emergency", () => {
  assert.throws(() => assertOrderAllowed({
    path: "/v2/orders",
    options: { method: "POST", body: "{" },
    emergencyStopActive: true,
  }), /Malformed order payload was blocked/);
});

test("does not block account reads or order cancellation", () => {
  assert.doesNotThrow(() => assertOrderAllowed({
    path: "/v2/account",
    options: { method: "GET" },
    emergencyStopActive: true,
  }));
  assert.doesNotThrow(() => assertOrderAllowed({
    path: "/v2/orders/order-id",
    options: { method: "DELETE" },
    emergencyStopActive: true,
  }));
});

test("does not apply the emergency gate when the stop is released", () => {
  assert.doesNotThrow(() => assertOrderAllowed({
    path: "/v2/orders",
    options: { method: "POST", body: JSON.stringify({ side: "buy" }) },
    emergencyStopActive: false,
  }));
});
