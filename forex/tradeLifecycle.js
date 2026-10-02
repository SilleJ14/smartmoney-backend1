function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, places = 6) {
  return Number(Number(value).toFixed(places));
}

function tradeSide(units) {
  return Number(units) > 0 ? "buy" : Number(units) < 0 ? "sell" : null;
}

function favorableMove(side, entry, mark) {
  return side === "buy" ? mark - entry : entry - mark;
}

function tighterStop(side, current, proposed) {
  if (proposed === null) return current;
  if (current === null) return proposed;
  return side === "buy" ? Math.max(current, proposed) : Math.min(current, proposed);
}

export const FOREX_LIFECYCLE_POLICY = Object.freeze({
  breakEvenAtR: 1,
  partialAtR: 1.25,
  trailAtR: 1.5,
  partialFraction: 0.5,
  trailAtrMultiple: 1.25,
  minimumStopImprovementAtr: 0.1,
});

export function evaluateForexTradeLifecycle({
  trade = {},
  quote = {},
  atr = null,
  structure = {},
  eventGate = {},
  session = {},
  now = Date.now(),
  policy = FOREX_LIFECYCLE_POLICY,
  managementState = {},
} = {}) {
  const units = finite(trade.currentUnits);
  const side = tradeSide(units);
  const entry = finite(trade.price ?? trade.averagePrice);
  const bid = finite(quote.bid);
  const ask = finite(quote.ask);
  const mark = side === "buy" ? bid : ask;
  const currentStop = finite(
    trade.stopLossOrder?.price ??
    trade.guaranteedStopLossOrder?.price ??
    managementState.stop
  );
  const initialStop = finite(managementState.initialStop ?? currentStop);
  const volatility = finite(atr);

  const unavailable = [];
  if (!side || !units) unavailable.push("POSITION_UNAVAILABLE");
  if (!(entry > 0)) unavailable.push("ENTRY_PRICE_UNAVAILABLE");
  if (!(mark > 0)) unavailable.push("EXECUTABLE_QUOTE_UNAVAILABLE");
  if (!(initialStop > 0)) unavailable.push("INITIAL_STOP_UNAVAILABLE");
  if (unavailable.length) {
    return { action: "WAIT", available: false, reasons: unavailable, rMultiple: null };
  }

  const initialRisk = Math.abs(entry - initialStop);
  if (!(initialRisk > 0)) {
    return { action: "WAIT", available: false, reasons: ["INITIAL_RISK_INVALID"], rMultiple: null };
  }
  const rMultiple = favorableMove(side, entry, mark) / initialRisk;
  const fullCloseReason = eventGate.reason === "EVENT_WINDOW"
    ? "EVENT_WINDOW"
    : session.tooCloseToWeeklyClose === true
      ? "WEEKLY_CLOSE"
      : managementState.holdExpired === true
        ? "MAX_HOLD_EXCEEDED"
        : structure.invalidated === true
          ? "STRUCTURE_INVALIDATED"
          : null;
  if (fullCloseReason) {
    return {
      action: "CLOSE_FULL",
      available: true,
      reason: fullCloseReason,
      units: -units,
      rMultiple: round(rMultiple, 4),
    };
  }

  if (managementState.partialTaken !== true && rMultiple >= policy.partialAtR) {
    const closeUnits = Math.max(1, Math.floor(Math.abs(units) * policy.partialFraction));
    if (closeUnits < Math.abs(units)) {
      return {
        action: "CLOSE_PARTIAL",
        available: true,
        reason: "PARTIAL_TARGET",
        units: side === "buy" ? -closeUnits : closeUnits,
        fraction: closeUnits / Math.abs(units),
        rMultiple: round(rMultiple, 4),
      };
    }
  }

  let proposedStop = currentStop;
  let reason = null;
  if (rMultiple >= policy.breakEvenAtR) {
    proposedStop = tighterStop(side, proposedStop, entry);
    reason = "BREAK_EVEN";
  }
  if (rMultiple >= policy.trailAtR && volatility !== null && volatility > 0) {
    const volatilityStop = side === "buy"
      ? mark - policy.trailAtrMultiple * volatility
      : mark + policy.trailAtrMultiple * volatility;
    const structureStop = finite(side === "buy" ? structure.support : structure.resistance);
    proposedStop = tighterStop(
      side,
      proposedStop,
      structureStop === null
        ? volatilityStop
        : side === "buy"
          ? Math.min(mark, Math.max(volatilityStop, structureStop))
          : Math.max(mark, Math.min(volatilityStop, structureStop))
    );
    reason = "STRUCTURE_VOLATILITY_TRAIL";
  }

  const improvement = currentStop === null
    ? Infinity
    : side === "buy"
      ? proposedStop - currentStop
      : currentStop - proposedStop;
  const minimumImprovement = volatility !== null && volatility > 0
    ? volatility * policy.minimumStopImprovementAtr
    : initialRisk * 0.05;
  const validSide = side === "buy" ? proposedStop < bid : proposedStop > ask;
  if (reason && proposedStop !== null && validSide && improvement >= minimumImprovement) {
    return {
      action: "UPDATE_PROTECTION",
      available: true,
      reason,
      stop: round(proposedStop),
      takeProfit: finite(trade.takeProfitOrder?.price),
      rMultiple: round(rMultiple, 4),
    };
  }

  return {
    action: "HOLD",
    available: true,
    reason: "NO_MANAGEMENT_CHANGE",
    rMultiple: round(rMultiple, 4),
    evaluatedAt: new Date(now).toISOString(),
  };
}
