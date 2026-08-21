import test from "node:test";
import assert from "node:assert/strict";
import { createDuplicateOrderGuard } from "../execution/duplicateOrderGuard.js";

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase();

test("blocks an order matching an existing broker order", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => [{ id: "open-1", symbol: "AAPL", side: "buy", status: "new" }],
    normalizeSymbol,
  });
  await assert.rejects(
    guard.reserve({ symbol: "aapl", side: "buy" }),
    /broker order open-1 is still open/
  );
});

test("allows the opposite side for the same symbol", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => [{ id: "open-1", symbol: "AAPL", side: "buy", status: "new" }],
    normalizeSymbol,
  });
  const release = await guard.reserve({ symbol: "AAPL", side: "sell" });
  release({ success: true });
});

test("blocks overlapping local submissions before broker state catches up", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => [],
    normalizeSymbol,
  });
  const release = await guard.reserve({ symbol: "AAPL", side: "buy" });
  release({ success: true });
  await assert.rejects(
    guard.reserve({ symbol: "AAPL", side: "buy" }),
    /submission already reserved/
  );
});

test("releases a reservation after a failed broker submission", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => [],
    normalizeSymbol,
  });
  const release = await guard.reserve({ symbol: "AAPL", side: "buy" });
  release({ success: false });
  await guard.reserve({ symbol: "AAPL", side: "buy" });
});

test("fails closed when open orders cannot be retrieved", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => { throw new Error("broker unavailable"); },
    normalizeSymbol,
  });
  await assert.rejects(
    guard.reserve({ symbol: "AAPL", side: "buy" }),
    /broker unavailable/
  );
});

test("permits explicitly authorized adaptive slices", async () => {
  const guard = createDuplicateOrderGuard({
    getOpenOrders: async () => { throw new Error("should not be called"); },
    normalizeSymbol,
  });
  const release = await guard.reserve(
    { symbol: "AAPL", side: "buy" },
    { allowExistingOpenOrder: true }
  );
  release({ success: true });
});
