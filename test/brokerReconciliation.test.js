import test from "node:test";
import assert from "node:assert/strict";
import { buildPendingExits, reconcileBrokerState } from "../execution/brokerReconciliation.js";

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase();

test("classifies partially filled sell orders by remaining quantity", () => {
  const exits = buildPendingExits({
    openOrders: [{
      id: "order-1",
      symbol: "aapl",
      side: "sell",
      status: "partially_filled",
      type: "trailing_stop",
      qty: "5",
      filled_qty: "2",
    }],
    normalizeSymbol,
  });
  assert.equal(exits[0].symbol, "AAPL");
  assert.equal(exits[0].qty, 3);
  assert.equal(exits[0].reason, "TRAILING_STOP_EXIT");
});

test("reports unmanaged, missing, and duplicate broker exposure", () => {
  const result = reconcileBrokerState({
    positions: [
      { symbol: "AAPL", qty: "1" },
      { symbol: "TSLA", qty: "2" },
    ],
    managedSymbols: ["AAPL", "MSFT"],
    openOrders: [
      { symbol: "NVDA", side: "buy", status: "new" },
      { symbol: "NVDA", side: "buy", status: "accepted" },
    ],
    normalizeSymbol,
  });
  assert.deepEqual(result.unmanagedBrokerPositions, ["TSLA"]);
  assert.deepEqual(result.missingManagedPositions, ["MSFT"]);
  assert.deepEqual(result.duplicateOpenBuySymbols, [{ symbol: "NVDA", count: 2 }]);
});
