function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// A swing is known only after the two later candles have closed. Never backdate.
export function confirmedSwings(candles = []) {
  const rows = candles.filter((candle) => candle && candle.complete !== false);
  const highs = [];
  const lows = [];
  for (let index = 2; index <= rows.length - 3; index += 1) {
    const high = num(rows[index].h);
    const low = num(rows[index].l);
    const knownAfter = rows[index + 2];
    if (!knownAfter) continue;
    const leftH = num(rows[index - 1].h);
    const leftH2 = num(rows[index - 2].h);
    const rightH = num(rows[index + 1].h);
    const rightH2 = num(rows[index + 2].h);
    if (high > leftH && high > leftH2 && high > rightH && high > rightH2) {
      highs.push({ index, price: high, knownAtIndex: index + 2, time: rows[index].t });
    }
    const leftL = num(rows[index - 1].l);
    const leftL2 = num(rows[index - 2].l);
    const rightL = num(rows[index + 1].l);
    const rightL2 = num(rows[index + 2].l);
    if (low < leftL && low < leftL2 && low < rightL && low < rightL2) {
      lows.push({ index, price: low, knownAtIndex: index + 2, time: rows[index].t });
    }
  }
  return { highs, lows };
}

export function latestConfirmedSwings(candles, atIndex) {
  const { highs, lows } = confirmedSwings(candles);
  const visibleHighs = highs.filter((swing) => swing.knownAtIndex <= atIndex);
  const visibleLows = lows.filter((swing) => swing.knownAtIndex <= atIndex);
  return {
    highs: visibleHighs,
    lows: visibleLows,
    lastHigh: visibleHighs[visibleHighs.length - 1] || null,
    lastLow: visibleLows[visibleLows.length - 1] || null,
  };
}

export function risingStructure(swings) {
  if (!swings || swings.length < 2) return false;
  const last = swings[swings.length - 1];
  const prior = swings[swings.length - 2];
  return last.price > prior.price;
}
