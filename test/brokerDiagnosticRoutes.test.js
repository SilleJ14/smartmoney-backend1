import test from "node:test";
import assert from "node:assert/strict";
import { classifyBotOrders } from "../routes/brokerDiagnosticRoutes.js";

test("classifies only bot orders into active and closed diagnostics", () => {
  const orders = [{ id: 1, bot: true, status: "new" }, { id: 2, bot: true, status: "filled" }, { id: 3, bot: false, status: "new" }];
  const result = classifyBotOrders(orders, (order) => order.bot);
  assert.deepEqual(result.activeOrders.map((order) => order.id), [1]);
  assert.deepEqual(result.closedOrders.map((order) => order.id), [2]);
  assert.equal(result.aiOrders.length, 2);
});
