// HTTP success alone does not prove a FOK market order filled.
export function orderOutcome(response) {
  const fill = response?.orderFillTransaction;
  const cancel = response?.orderCancelTransaction;
  const reject = response?.orderRejectTransaction;
  const count = [fill, cancel, reject].filter(Boolean).length;
  if (count !== 1) return { state: "OUTCOME_UNKNOWN", reason: "ORDER_OUTCOME_UNKNOWN" };
  if (cancel?.id && cancel.type === "ORDER_CANCEL") return { state: "CANCELLED", reason: cancel.reason || "ORDER_CANCELLED", transaction: cancel };
  if (reject?.id && reject.type === "MARKET_ORDER_REJECT") return { state: "REJECTED", reason: reject.rejectReason || "ORDER_REJECTED", transaction: reject };
  const legs = [fill?.tradeOpened, fill?.tradeReduced, ...(fill?.tradesClosed || [])].filter(Boolean);
  if (fill?.id && fill.type === "ORDER_FILL" && Number.isFinite(Number(fill.units)) && Number(fill.units) !== 0
    && legs.length && legs.every((leg) => leg.tradeID && Number.isFinite(Number(leg.units)) && Number(leg.units) !== 0)) {
    return { state: "FILLED", transaction: fill };
  }
  return { state: "OUTCOME_UNKNOWN", reason: "ORDER_OUTCOME_UNKNOWN" };
}
