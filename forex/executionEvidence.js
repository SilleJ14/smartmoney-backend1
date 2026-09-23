import { lossConversion, mapInstrument, priceText } from "./instrumentSpecs.js";
import { stampEvidence, validateQuote, forexEvidencePolicy } from "./evidenceValidator.js";
import { forexMarketState } from "./sessionHours.js";
import { FOREX_RISK_LIMITS, permittedUnits, sizingReference } from "./riskManager.js";
import { dailyLossState, drawdownLock, openStopRisk } from "./accountRisk.js";

// Independent of Alpaca/stock controls. Rebuild execution facts at the last responsible moment.
export async function refreshExecutionPlan(adapter, store, plan, nowFn = Date.now) {
  const accountAt = nowFn();
  const [accountData, tradesData, pendingData, instrumentsData] = await Promise.all([
    adapter.getAccount(), adapter.getOpenTrades(), adapter.getPendingOrders(), adapter.getInstruments(),
  ]);
  const account = accountData?.account;
  const trades = tradesData?.trades;
  const pending = pendingData?.orders;
  if (!account || account.id !== plan.accountId || !Array.isArray(trades) || !Array.isArray(pending)) throw new Error("ACCOUNT_UNVERIFIED");
  if (!Number.isFinite(Number(account.NAV)) || !(Number(account.NAV) > 0)
    || account.marginAvailable == null || !Number.isFinite(Number(account.marginAvailable))) throw new Error("ACCOUNT_UNVERIFIED");
  if (pending.some((o) => !["STOP_LOSS", "GUARANTEED_STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP_LOSS"].includes(o.type))) throw new Error("PENDING_ENTRY_ORDERS");
  if (trades.some((t) => t.instrument === plan.instrumentId && Number(t.currentUnits))) throw new Error("SCALE_IN_DISABLED");
  const instrument = (instrumentsData?.instruments || []).find((i) => i.name === plan.instrumentId);
  if (!instrument || instrument.tradeable === false) throw new Error("INSTRUMENT_UNAVAILABLE");
  const spec = mapInstrument(instrument);
  if (!Number.isInteger(spec.tradeUnitsPrecision) || spec.tradeUnitsPrecision < 0 || spec.tradeUnitsPrecision > 8
    || !Number.isFinite(spec.marginRate) || spec.marginRate <= 0) throw new Error("INSTRUMENT_UNAVAILABLE");
  const payload = await adapter.getPrices([...new Set([plan.instrumentId, ...trades.map(t => t.instrument)])]);
  const now = nowFn();
  if (now - accountAt > 5000) throw new Error("ACCOUNT_STALE");
  if (!forexMarketState(now).open) throw new Error("MARKET_CLOSED");
  if (!plan.confirmedAt || !Number.isFinite(Date.parse(plan.confirmedAt)) || Date.parse(plan.confirmedAt) > now || !(Number(plan.confirmationPrice) > 0)) throw new Error("TRIGGER_EVIDENCE_UNAVAILABLE");
  const prices = (payload?.prices || []).map(p => ({ ...p, bid: Number(p.bids?.[0]?.price), ask: Number(p.asks?.[0]?.price) }));
  const quote = prices.find(p => p.instrument === plan.instrumentId);
  const policy = forexEvidencePolicy("forex", "order", "automatic");
  for (const price of prices) {
    const issues = validateQuote(stampEvidence({ providerTimestamp: price.time, payload: price, now }), { now, policy });
    if (issues.length) throw new Error(issues[0]);
  }
  if (!quote) throw new Error("QUOTE_UNAVAILABLE");
  const conversionFactor = lossConversion(plan.instrumentId, account.currency, payload.homeConversions);
  if (!(conversionFactor > 0)) throw new Error("CONVERSION_UNAVAILABLE");
  const ledger = await store.load();
  if (ledger.incidentLocks[account.id]) throw new Error("INCIDENT_LOCK");
  if (ledger.intents.some(i => i.accountId === account.id && ["INTENT_SAVED", "OUTCOME_UNKNOWN", "ACKNOWLEDGED"].includes(i.state))) throw new Error("UNCERTAIN_ORDER");
  const openRisk = openStopRisk({ trades, prices, homeConversions: payload.homeConversions, accountCurrency: account.currency, equity: account.NAV });
  if (!openRisk.known) throw new Error("OPEN_RISK_UNKNOWN");
  const start = ledger.dayStart[account.id]?.adjustedEquity;
  const pendingRisk = ledger.reservations.filter(r => r.state === "RESERVED").reduce((sum, r) => sum + Number(r.risk || 0), 0);
  const daily = dailyLossState({ equity: account.NAV, dayStartEquity: start, extraStopLossIfHit: openRisk.amount, pendingRisk: pendingRisk * Number(start) / 100 });
  if (daily.locked || drawdownLock({ peakEquity: ledger.peakEquity[account.id], equity: account.NAV }).locked) throw new Error("RISK_BUDGET_EXHAUSTED");
  const entry = Number(plan.units) < 0 ? quote.bid : quote.ask;
  const stopText = priceText(plan.stop, spec);
  const targetText = priceText(plan.takeProfitOnFill, spec);
  if (!stopText || !targetText) throw new Error("PRICE_PRECISION_UNAVAILABLE");
  const equity = sizingReference({ equity: account.NAV, cashFlowAdjustedDayStart: start });
  const allowedRisk = equity * FOREX_RISK_LIMITS.plannedRiskPerTradePercent / 100;
  const stop = Number(stopText);
  if (Number(plan.units) > 0 ? stop >= entry || Number(targetText) <= entry : stop <= entry || Number(targetText) >= entry) throw new Error("PROTECTION_DIRECTION_INVALID");
  const size = permittedUnits({ allowedRisk, worstEntry: entry, stop, conversionFactor, instrument: spec });
  // Margin uses a conservative loss conversion; never substitute 1 for cross-currency rates.
  const marginPerUnit = entry * conversionFactor * spec.marginRate;
  if (!(marginPerUnit > 0) || !(Number(account.marginAvailable) >= 0)) throw new Error("MARGIN_UNAVAILABLE");
  const increment = 10 ** -spec.tradeUnitsPrecision;
  const marginUnits = Math.floor(Number(account.marginAvailable) * .8 / marginPerUnit / increment) * increment;
  const unitsAbs = Math.min(Math.abs(Number(plan.units)), size, marginUnits);
  if (!(unitsAbs >= spec.minimumTradeSize)) throw new Error("INSUFFICIENT_MARGIN");
  const riskPercent = unitsAbs * Math.abs(entry - stop) * conversionFactor / equity * 100;
  return { ...plan, now, accountObservedAt: accountAt, quoteTimestamp: quote.time, quoteOk: true,
    units: Math.sign(Number(plan.units)) * unitsAbs, instrument: spec, conversionFactor,
    worstEntryPrice: entry, bid: quote.bid, ask: quote.ask, priceBound: priceText(entry, spec),
    stop, stopLossOnFill: stopText, takeProfitOnFill: targetText, allowedRisk,
    remainingDailyRisk: daily.remainingPercent, plannedRiskPercent: riskPercent,
    openPlusPendingPercent: openRisk.percent + pendingRisk,
    // Conservative: total open risk is an upper bound on any same-direction currency group.
    sameDirectionPercent: openRisk.percent + pendingRisk,
    marginAvailable: Number(account.marginAvailable), requiredMargin: unitsAbs * marginPerUnit };
}
