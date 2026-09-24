import { FOREX_SPEC, FOREX_SPEC_VERSION, toDisplayPair } from "./forexSpec.js";
import { performance } from "node:perf_hooks";
import { forexDailyChange } from "./dailyChange.js";
import { FOREX_RISK_LIMITS, permittedUnits, sizingReference } from "./riskManager.js";
import { canonicalAccountId, resolveAssetClass } from "./identity.js";
import { createApprovalRegistry, automaticEntryPermission } from "./approvalRegistry.js";
import { createCandidate, transitionCandidate } from "./candidateManager.js";
import { createExecutionCoordinator } from "./executionCoordinator.js";
import { createSafetySupervisor } from "./safetySupervisor.js";
import { evaluateBreakoutRetest } from "./strategies/breakoutRetest.js";
import { evaluateTrendContinuation } from "./strategies/trendContinuation.js";
import { stampEvidence, validateQuote, forexEvidencePolicy } from "./evidenceValidator.js";
import { createForexStore } from "./durableStore.js";
import { inspectCandles } from "./candleIntegrity.js";
import { forexMarketState, mustCloseBeforeEventOrWeekend } from "./sessionHours.js";
import { spreadChecks } from "./spreadCost.js";
import { clockHealth } from "./clockSync.js";
import { mapInstrument, quoteConversionFactor, lossConversion } from "./instrumentSpecs.js";
import { resolveStrategyConflict, oneOpenPerPair } from "./conflictPolicy.js";
import { chasedAway, entryExpired, plannedTarget, stopDistanceOk } from "./strategyExits.js";
import { defaultCalendarSnapshot, calendarForDecision } from "./calendarFeed.js";
import { dailyLossState, drawdownLock, remainingDailyRiskPercent, updateEquityBaselines, openStopRisk } from "./accountRisk.js";
import { operatingStatus } from "./monitoring.js";
import { capitalSummaryContract, autoTradeLimitsContract, positionContract } from "./reportingService.js";

const STAGE_RANK = {
  EXECUTION_ELIGIBLE: 5,
  TRIGGER_CONFIRMED: 4,
  WATCHING: 3,
  DISCOVERED: 2,
  BLOCKED: 1,
  INVALIDATED: 0,
  EXPIRED: 0,
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapCandles(payload, source) {
  if (!Array.isArray(payload?.candles)) return null;
  return payload.candles.map((candle) => candle && ({
    t: candle.time,
    o: Number(candle.mid?.o ?? candle.bid?.o),
    h: Number(candle.mid?.h ?? candle.bid?.h),
    l: Number(candle.mid?.l ?? candle.bid?.l),
    c: Number(candle.mid?.c ?? candle.bid?.c),
    bidH: num(candle.bid?.h),
    bidL: num(candle.bid?.l),
    askH: num(candle.ask?.h),
    askL: num(candle.ask?.l),
    complete: candle.complete,
    source,
    providerTimestamp: candle.time,
  }));
}

function mapPrice(price) {
  const bid = num(price?.bids?.[0]?.price);
  const ask = num(price?.asks?.[0]?.price);
  return {
    instrument: price?.instrument,
    bid,
    ask,
    mid: bid && ask ? (bid + ask) / 2 : num(price?.closeoutBid),
    time: price?.time,
    tradeable: price?.tradeable !== false,
    conversionBuy: quoteConversionFactor(price, "buy"),
    conversionSell: quoteConversionFactor(price, "sell"),
  };
}

function frontendState(stage) {
  if (stage === "TRIGGER_CONFIRMED") return "trigger";
  if (stage === "EXECUTION_ELIGIBLE") return "ready";
  if (stage === "INVALIDATED" || stage === "EXPIRED" || stage === "BLOCKED") return "blocked";
  if (stage === "WATCHING") return "retest";
  return "watch";
}

function toSignal(instrument, identity, quote, row, result, recovered) {
  return {
    symbol: toDisplayPair(instrument),
    instrument,
    assetClass: "forex",
    identity,
    forexState: frontendState(row.state),
    forexSide: row.side,
    reason: row.lastReason,
    blockers: row.blockers || [],
    firstDetectedAt: row.firstSeenAt || null,
    confirmedAt: row.confirmedAt || null,
    system: result.strategyId,
    price: quote.mid,
    livePrice: quote.mid,
    displayPrice: quote.mid,
    bid: quote.bid,
    ask: quote.ask,
    liveQuoteUpdatedAt: quote.time,
    ...quote.dailyChange,
    specVersion: FOREX_SPEC.version,
    raw: {
      forexState: frontendState(row.state),
      forexSide: row.side,
      forexGates: {
        trend: (result.passed || []).length > 0,
        setup: ["WATCHING", "TRIGGER_CONFIRMED", "EXECUTION_ELIGIBLE"].includes(row.state),
        entry: row.state === "EXECUTION_ELIGIBLE",
        risk: row.state === "EXECUTION_ELIGIBLE" && recovered.autoTradingAuthorized === true,
      },
    },
  };
}

export function selectForexSignals(sources, fallbacks, recovered) {
  const selected = new Map(fallbacks);
  const grouped = new Map();
  for (const source of sources) {
    const previous = grouped.get(source.instrument);
    if (!previous || (STAGE_RANK[source.row.state] || 0) > (STAGE_RANK[previous.row.state] || 0)) grouped.set(source.instrument, source);
  }
  for (const [instrument, source] of grouped) {
    selected.set(instrument, toSignal(instrument, source.identity, source.quote, source.row, source.result, recovered));
  }
  return [...selected.values()].map(({ rowState, ...signal }) => signal);
}

export async function runForexEngineCycle({
  client,
  spec = FOREX_SPEC,
  state = {},
  forexAutoEnabled = false,
  now = Date.now(),
  clockNow,
  getEntryPause,
  getAutoEnabled,
  getCalendar,
  forexEmergencyStopActive = false,
  registry: providedRegistry,
  durableStorageAvailable = false,
  store,
  calendar = defaultCalendarSnapshot(),
  instanceId = "local",
} = {}) {
  const started = performance.now();
  const currentTime = clockNow || (() => now + performance.now() - started);
  const orderSubmissionEnabled = spec.practiceOrdersEnabled === true && client?.liveHost !== true;
  const registry = providedRegistry || state.registry || createApprovalRegistry();
  const autoRequested = () => (getAutoEnabled ? getAutoEnabled() === true : forexAutoEnabled === true);
  const ledgerStore = store || createForexStore({
    memory: !durableStorageAvailable,
    treatAsDurable: durableStorageAvailable === true,
  });
  const supervisor = createSafetySupervisor({ store: ledgerStore, instanceId });
  const coordinator = client ? createExecutionCoordinator({
    adapter: client,
    getEntryPause,
    getAutoEnabled: autoRequested,
    getCalendar,
    nowFn: currentTime,
    registry,
    store: ledgerStore,
    instanceId,
  }) : null;

  const snapshot = {
    specVersion: FOREX_SPEC_VERSION,
    forexAutoEnabled: forexAutoEnabled === true,
    forexEmergencyStopActive,
    halt: "CLEAR",
    haltState: "CLEAR",
    session: "OANDA_PRACTICE",
    quoteAgeSeconds: null,
    openRiskPercent: null,
    openRiskKnown: false,
    dailyLossRoomPercent: FOREX_RISK_LIMITS.dailyLossTriggerPercent,
    signals: [],
    candidates: [],
    account: null,
    ledger: state.ledger || { specVersion: FOREX_SPEC_VERSION, tradeCount: 0, systems: {} },
    analysisReady: false,
    executionReady: false,
    autoTradingAuthorized: false,
    incidentLockActive: state.incidentLockActive === true,
    lastCycleAt: new Date(now).toISOString(),
    lastError: null,
    coordinatorBound: Boolean(coordinator),
    executionMode: orderSubmissionEnabled ? "PRACTICE_ORDERS" : "ANALYSIS_ONLY",
    executionNote: orderSubmissionEnabled
      ? "Forex Autopilot authorizes continuation practice entries subject to all safety gates. Breakout/retest requires separate approval. Live orders stay off."
      : "Practice analysis only — automatic order submission is disabled.",
    practiceRiskCapPercent: FOREX_RISK_LIMITS.plannedRiskPerTradePercent,
    calendarNote: calendarForDecision(calendar, { now }).ok ? "Calendar coverage current." : "Calendar unavailable or restricted — new forex entries blocked.",
  };

  if (!client?.token) {
    const recovered = await supervisor.recover({ credentialsOk: false, forexAutoEnabled });
    Object.assign(snapshot, recovered, { halt: "MISSING_CREDENTIALS", haltState: "MISSING_CREDENTIALS" });
    snapshot.operating = recovered.operating;
    return snapshot;
  }
  if (typeof client.resolveAccountId === "function" && !client.accountId) {
    try {
      await client.resolveAccountId();
    } catch (error) {
      snapshot.halt = error.halt || "MISSING_CREDENTIALS";
      snapshot.haltState = snapshot.halt;
      snapshot.lastError = String(error.message || error);
      snapshot.operating = operatingStatus({ connected: false, forexAutoEnabled, halt: snapshot.halt });
      return snapshot;
    }
  }
  if (client.liveHost) {
    snapshot.halt = "LIVE_BLOCKED";
    snapshot.haltState = "LIVE_BLOCKED";
    snapshot.operating = operatingStatus({ connected: true, forexAutoEnabled, halt: "LIVE_BLOCKED" });
    return snapshot;
  }

  try {
    const accountPayload = await client.getAccount();
    const account = accountPayload?.account || {};
    snapshot.account = {
      id: account.id,
      environment: "practice",
      broker: "oanda",
      currency: account.currency,
      balance: num(account.balance),
      NAV: num(account.NAV),
      unrealizedPL: num(account.unrealizedPL),
      marginUsed: num(account.marginUsed),
      marginAvailable: num(account.marginAvailable),
      openTradeCount: num(account.openTradeCount),
      lastTransactionID: account.lastTransactionID,
    };
    const tradesPayload = typeof client.getOpenTrades === "function" ? await client.getOpenTrades() : null;
    const tradesVerified = Array.isArray(tradesPayload?.trades);
    const openTrades = tradesPayload?.trades || [];
    const savedLedger = await ledgerStore.load();
    if (!providedRegistry && savedLedger.strategyRegistry) Object.assign(registry, savedLedger.strategyRegistry);
    const lastCursor = String(savedLedger.lastTransactionId?.[snapshot.account.id] || 0);
    const baselineCursor = String(savedLedger.dayStart?.[snapshot.account.id]?.cursor || 0);
    const cursor = savedLedger.fillSchemaVersion === 1 ? (BigInt(lastCursor) < BigInt(baselineCursor) ? lastCursor : baselineCursor) : "0";
    const txPayload = typeof client.getTransactionsSince === "function"
      ? await client.getTransactionsSince(cursor)
      : { transactions: [] };
    const pendingPayload = typeof client.getPendingOrders === "function" ? await client.getPendingOrders() : null;
    // Only reconcile transactions covered by this NAV snapshot. Later transactions are replayed next cycle.
    const transactions = (txPayload?.transactions || []).filter((row) => /^\d+$/.test(String(row.id))
      && /^\d+$/.test(String(account.lastTransactionID)) && BigInt(row.id) <= BigInt(account.lastTransactionID));
    snapshot.lastTransactionId = account.lastTransactionID;
    const instrumentPayload = typeof client.getInstruments === "function" ? await client.getInstruments() : { instruments: [] };
    const specs = new Map((instrumentPayload?.instruments || []).map((row) => [row.name, mapInstrument(row)]));
    const pricesPayload = await client.getPrices([...new Set([...spec.scanInstruments, ...openTrades.map(t => t.instrument)])]);
    const prices = (pricesPayload?.prices || []).map(mapPrice);
    const clock = clockHealth({ now: currentTime(), providerTimestamp: prices[0]?.time });
    const session = forexMarketState(now);
    const recovered = await supervisor.recover({
      credentialsOk: true,
      accountSnapshot: snapshot.account,
      lastTransactionId: snapshot.account.lastTransactionID,
      transactions,
      openTrades,
      pendingOrders: Array.isArray(pendingPayload?.orders) ? pendingPayload.orders : null,
      historyLoaded: tradesVerified && typeof client.getTransactionsSince === "function" && Array.isArray(txPayload?.transactions),
      forexAutoEnabled,
      clockOk: clock.ok,
      entryPauseRequested: getEntryPause?.(),
    });
    if (ledgerStore.isDurable?.()) {
      await ledgerStore.commit((ledger) => {
        const key = snapshot.account.id;
        Object.assign(snapshot, updateEquityBaselines(ledger, snapshot.account, transactions, now));
        snapshot.incidentLockActive = Boolean(ledger.incidentLocks[key]);
      });
    }
    const stopRisk = tradesVerified ? openStopRisk({ trades: openTrades, prices, homeConversions: pricesPayload.homeConversions,
      accountCurrency: snapshot.account.currency, equity: snapshot.account.NAV }) : { amount: null, percent: null, known: false };
    const daily = dailyLossState({
      accountId: snapshot.account.id,
      equity: snapshot.account.NAV,
      dayStartEquity: snapshot.dayStartEquity || snapshot.account.NAV,
      cashFlowAdjustedDayStart: snapshot.cashFlowAdjustedDayStart ?? snapshot.account.NAV,
      extraStopLossIfHit: stopRisk.amount ?? 0,
    });
    const dd = drawdownLock({ peakEquity: snapshot.peakEquity ?? snapshot.account.NAV, equity: snapshot.account.NAV });
    if ((daily.locked || dd.locked) && ledgerStore.isDurable?.()) {
      await ledgerStore.commit((ledger) => {
        ledger.incidentLocks[snapshot.account.id] = { reason: daily.reason || dd.reason, at: new Date(now).toISOString() };
      });
      recovered.incidentLockActive = true;
      recovered.executionReady = false;
      recovered.autoTradingAuthorized = false;
    }

    const quotePolicy = forexEvidencePolicy("forex", "order", "automatic");
    const candidates = [];
    const signalSources = [];
    const bestByInstrument = new Map();

    // Fetch bounded history first, then one current quote batch. Earlier pairs no longer
    // age while later history is downloaded. A failed pair doesn't erase other evidence.
    const histories = new Map();
    for (const instrument of spec.scanInstruments) {
      try {
        const rows = await Promise.all([
          client.getCandles(instrument, { granularity: "H4", count: spec.h4Count, price: "MBA" }),
          client.getCandles(instrument, { granularity: "H1", count: spec.h1Count, price: "MBA" }),
          client.getCandles(instrument, { granularity: "M15", count: spec.m15Count, price: "MBA" }),
          // Optional display evidence: failure must not discard strategy history.
          Promise.resolve().then(() => client.getCandles(instrument, { granularity: "D", count: 5, price: "M" })).catch(() => null),
        ]);
        histories.set(instrument, rows);
      } catch (error) { histories.set(instrument, { error: String(error.message || error) }); }
    }
    const refreshed = await client.getPrices(spec.scanInstruments);
    const currentPrices = (refreshed?.prices || []).map(mapPrice);
    for (const instrument of spec.scanInstruments) {
      const assetClass = resolveAssetClass({ assetClass: "forex", broker: "oanda", instrumentId: instrument });
      const identity = canonicalAccountId({
        environment: "practice",
        broker: "oanda",
        accountId: snapshot.account.id || client.accountId,
        assetClass,
        instrumentId: instrument,
      });
      const history = histories.get(instrument);
      const [h4, h1, m15, daily] = Array.isArray(history) ? history : [];
      const quote = currentPrices.find((row) => row.instrument === instrument) || {};
      quote.dailyChange = forexDailyChange(daily, quote);
      const decisionNow = currentTime();
      const quoteEvidence = stampEvidence({ source: "oanda_pricing", instrument, account: snapshot.account.id,
        providerTimestamp: quote.time, payload: quote, now: decisionNow });
      const quoteIssues = validateQuote(quoteEvidence, { now: decisionNow, policy: quotePolicy });
      const calendarGate = calendarForDecision(getCalendar?.() || calendar, { now: decisionNow, instrument });
      const currentSession = forexMarketState(decisionNow);
      const snapshotBars = {
        h4: mapCandles(h4, "oanda_candles_h4"),
        h1: mapCandles(h1, "oanda_candles_h1"),
        m15: mapCandles(m15, "oanda_candles_m15"),
      };
      const candleIssues = [
        ...inspectCandles(snapshotBars.h4, "H4", { now: decisionNow }).issues,
        ...inspectCandles(snapshotBars.h1, "H1", { now: decisionNow }).issues,
        ...inspectCandles(snapshotBars.m15, "M15", { now: decisionNow }).issues,
      ];
      const holdOk = mustCloseBeforeEventOrWeekend({ now: decisionNow, maxHoldHours: spec.maxHoldHours });
      for (const side of ["buy", "sell"]) {
        const results = [ ["FOREX_BREAKOUT_RETEST_V1", evaluateBreakoutRetest], ["FOREX_TREND_CONTINUATION_V1", evaluateTrendContinuation] ].map(([strategyId, evaluate]) => {
          const previous = savedLedger.candidates.find(c => c.identity === identity && c.strategyId === strategyId && c.side === side);
          if (candleIssues.length) return { strategyId, status: "NONE", stage: "BLOCKED", reason: candleIssues[0], previous };
          return { ...evaluate({ ...snapshotBars, side, previous: previous ? { ...previous, state: previous.strategyState || previous.state } : null }), previous };
        });
        for (const result of results) {
          const row = createCandidate({ identity, strategyId: result.strategyId, side, frozen: result.frozen });
          row.firstSeenAt = new Date(decisionNow).toISOString();
          const anchor = result.frozen?.rangeEnd || result.frozen?.pullbackStart || result.confirmedAt || result.previous?.setupAnchor;
          row.setupAnchor = anchor;
          row.strategyState = result.stage;
          if (candleIssues.length && result.previous) {
            row.frozen = result.previous.frozen;
            row.setupAnchor = result.previous.setupAnchor;
            row.firstSeenAt = result.previous.firstSeenAt;
            row.strategyState = result.previous.strategyState;
          }
          row.confirmedAt = result.confirmedAt;
          row.confirmationPrice = result.confirmationPrice;
          if (anchor && anchor === result.previous?.setupAnchor) {
            row.firstSeenAt = result.previous.firstSeenAt;
            row.transitions = (result.previous.transitions || []).slice(-15);
          }
          const entryQuote = side === "buy" ? quote.ask : quote.bid;
          const stop = result.stop;
          const target = stop ? plannedTarget({ side, entry: entryQuote, stop }) : null;
          const specRow = specs.get(instrument) || {};
          const spread = stop ? spreadChecks({
            bid: quote.bid,
            ask: quote.ask,
            stopDistance: Math.abs(entryQuote - stop),
            absoluteLimit: specRow.absoluteSpreadLimit,
            targetDistance: target ? Math.abs(target - entryQuote) : 0,
          }) : { ok: false, reason: "STOP_DISTANCE" };
          const chased = result.frozen && chasedAway({
            side,
            confirmationPrice: result.confirmationPrice,
            currentPrice: entryQuote,
            A: result.frozen.A,
          });
          const calendarOk = calendarGate.ok;
          const dataOk = quoteIssues.length === 0 && candleIssues.length === 0 && currentSession.open && !currentSession.tooCloseToWeeklyClose && holdOk.ok && calendarOk;
          const practiceOrder = orderSubmissionEnabled && client.liveHost !== true;
          const entryPermission = automaticEntryPermission(registry, result.strategyId, { autopilotEnabled: autoRequested() });
          const approved = entryPermission.allowed;
          const triggered = result.reason === "RENEWED_MOVEMENT" || result.reason === "ENTRY_TRIGGER";
          const expired = triggered && (!result.confirmedAt || entryExpired({ confirmedAt: result.confirmedAt, now: decisionNow }));
          const executable = (result.reason === "RENEWED_MOVEMENT" || result.reason === "ENTRY_TRIGGER")
            && practiceOrder
            && approved
            && recovered.executionReady
            && autoRequested() && !forexEmergencyStopActive && getEntryPause?.() !== true
            && dataOk
            && spread.ok
            && stopDistanceOk({ entry: entryQuote, stop, A: result.frozen?.A })
            && !chased
            && !expired
            && !oneOpenPerPair(openTrades, instrument);
          let stage = executable ? "EXECUTION_ELIGIBLE" : result.stage;
          let reason = result.reason;
          if (!currentSession.open) reason = currentSession.reason || "WEEKEND";
          else if (quoteIssues.length) reason = quoteIssues[0];
          else if (candleIssues.length) reason = candleIssues[0];
          else if (!calendarGate.ok && (result.reason === "RENEWED_MOVEMENT" || result.reason === "ENTRY_TRIGGER")) {
            reason = calendarGate.reason;
          }
          if (!dataOk) stage = "BLOCKED";
          const blockers = [
            ...quoteIssues, ...candleIssues,
            ...(!currentSession.open ? [currentSession.reason] : []),
            ...(!holdOk.ok ? [holdOk.reason] : []),
            ...(!calendarOk ? [calendarGate.reason] : []),
            ...(forexEmergencyStopActive ? ["FOREX_EMERGENCY_STOP"] : []),
            ...(getEntryPause?.() === true ? ["ENTRIES_PAUSED"] : []),
            ...(!autoRequested() ? ["FOREX_AUTOPILOT_OFF"] : []),
            ...(!approved ? [entryPermission.reason] : []),
            ...(!recovered.executionReady ? [recovered.halt || "EXECUTION_NOT_READY"] : []),
            ...(triggered && !spread.ok ? [spread.reason] : []),
            ...(triggered && !stopDistanceOk({ entry: entryQuote, stop, A: result.frozen?.A }) ? ["STOP_DISTANCE"] : []),
            ...(triggered && chased ? ["CHASED_PRICE"] : []), ...(expired ? ["ENTRY_EXPIRED"] : []),
            ...(oneOpenPerPair(openTrades, instrument) ? ["SCALE_IN_DISABLED"] : []),
          ];
          if (triggered && blockers.length) { stage = "BLOCKED"; reason = blockers[0]; }
          transitionCandidate(row, stage, reason, {
            entryPermission,
            blockers: [...new Set(blockers)],
            passed: result.passed,
            pending: executable ? [] : (result.pending || ["Strategy approval"]),
            executionAuthorization: executable ? "PRACTICE" : "None",
            stop,
            instrument,
            bid: quote.bid,
            ask: quote.ask,
            entryQuote,
            target,
            specRow,
            conversionFactor: lossConversion(instrument, snapshot.account.currency, refreshed.homeConversions),
          });
          candidates.push(row);
          signalSources.push({ instrument, identity, quote, row, result, quoteEvidence });
          const signal = toSignal(instrument, identity, quote, row, result, recovered);
          const current = bestByInstrument.get(instrument);
          if (!current || (STAGE_RANK[row.state] || 0) > (STAGE_RANK[current.rowState] || 0)) {
            bestByInstrument.set(instrument, { ...signal, rowState: row.state });
          }
        }
      }
      if (!bestByInstrument.has(instrument)) {
        bestByInstrument.set(instrument, toSignal(
          instrument,
          identity,
          quote,
          { state: "DISCOVERED", side: "buy", lastReason: "NO_SETUP" },
          { strategyId: "FOREX_BREAKOUT_RETEST_V1", passed: [] },
          recovered
        ));
      }
    }

    resolveStrategyConflict(candidates);
    const finishedAt = currentTime();
    for (const source of signalSources) {
      const issues = validateQuote(source.quoteEvidence, { now: finishedAt, policy: quotePolicy });
      if (issues.length) {
        source.row.state = "BLOCKED";
        source.row.lastReason = issues[0];
        source.row.executionAuthorization = "None";
      }
    }
    // Re-select only after conflict and freshness checks mutate candidate states.
    snapshot.candidates = candidates;
    snapshot.signals = selectForexSignals(signalSources, bestByInstrument, recovered);
    const quoteAges = snapshot.signals.map((signal) => (finishedAt - Date.parse(signal.liveQuoteUpdatedAt)) / 1000);
    snapshot.quoteAgeSeconds = quoteAges.length && quoteAges.every(Number.isFinite) ? Math.max(...quoteAges) : null;
    snapshot.analysisReady = recovered.analysisReady;
    snapshot.recoveryReady = recovered.executionReady;
    snapshot.incidentLockActive = recovered.incidentLockActive || daily.locked || dd.locked;
    snapshot.pauseEntries = getEntryPause ? getEntryPause() === true : recovered.pauseEntries === true;
    const anyFreshQuote = snapshot.signals.some(s => {
      const age = (finishedAt - Date.parse(s.liveQuoteUpdatedAt)) / 1000;
      return Number.isFinite(age) && age >= 0 && age <= spec.quoteProviderMaxAgeSeconds;
    });
    snapshot.halt = !anyFreshQuote
      ? "STALE_PRICE"
      : recovered.halt;
    snapshot.haltState = snapshot.halt;
    snapshot.executionReady = orderSubmissionEnabled
      && recovered.executionReady
      && stopRisk.known
      && !daily.locked
      && !dd.locked
      && !snapshot.incidentLockActive
      && !snapshot.pauseEntries
      && snapshot.halt !== "STALE_PRICE";
    snapshot.autoTradingAuthorized = snapshot.executionReady && autoRequested() && !forexEmergencyStopActive;
    snapshot.dailyLossRoomPercent = stopRisk.known && recovered.executionReady ? remainingDailyRiskPercent(daily) : 0;
    snapshot.openRiskPercent = stopRisk.percent;
    snapshot.openRiskKnown = stopRisk.known;
    snapshot.openRiskNote = "Estimated additional loss to current stops; excludes future fees, slippage and gaps.";
    snapshot.marginUsagePercent = snapshot.account.NAV > 0 ? snapshot.account.marginUsed / snapshot.account.NAV * 100 : null;
    const practiceCandidate = snapshot.autoTradingAuthorized
      ? candidates.filter(row => row.state === "EXECUTION_ELIGIBLE" && row.executionAuthorization === "PRACTICE" && row.stop)
        .sort((a,b) => (a.ask-a.bid)/Math.abs(a.entryQuote-a.stop) - (b.ask-b.bid)/Math.abs(b.entryQuote-b.stop))[0]
      : null;
    if (practiceCandidate && coordinator) {
      const equity = sizingReference({
        equity: snapshot.account.NAV,
        dayStartEquity: snapshot.dayStartEquity,
        cashFlowAdjustedDayStart: snapshot.cashFlowAdjustedDayStart,
      });
      const allowedRisk = equity * (FOREX_RISK_LIMITS.plannedRiskPerTradePercent / 100);
      const unitsAbs = permittedUnits({
        allowedRisk,
        worstEntry: practiceCandidate.entryQuote,
        stop: practiceCandidate.stop,
        conversionFactor: practiceCandidate.conversionFactor,
        instrument: practiceCandidate.specRow || {},
      });
      const units = practiceCandidate.side === "sell" ? -unitsAbs : unitsAbs;
      snapshot.lastPracticeOrder = unitsAbs > 0 ? await coordinator.submit({
        intent: "automatic",
        practiceOrdersEnabled: true,
        environment: "FORWARD_PRACTICE",
        executionReady: true,
        autoTradingAuthorized: true,
        strategyId: practiceCandidate.strategyId,
        candidateId: `${practiceCandidate.identity}:${practiceCandidate.strategyId}:${practiceCandidate.side}:${practiceCandidate.setupAnchor}`,
        accountId: snapshot.account.id,
        instrumentId: practiceCandidate.instrument,
        instrument: practiceCandidate.specRow || {},
        units,
        currentUnits: 0,
        openOnInstrument: oneOpenPerPair(openTrades, practiceCandidate.instrument),
        priceBound: String(practiceCandidate.side === "sell" ? practiceCandidate.bid : practiceCandidate.ask),
        stopLossOnFill: String(practiceCandidate.stop),
        takeProfitOnFill: practiceCandidate.target ? String(practiceCandidate.target) : undefined,
        worstEntryPrice: practiceCandidate.entryQuote,
        stop: practiceCandidate.stop,
        bid: practiceCandidate.bid,
        ask: practiceCandidate.ask,
        A: practiceCandidate.frozen?.A,
        confirmedAt: practiceCandidate.confirmedAt,
        confirmationPrice: practiceCandidate.confirmationPrice,
        allowedRisk,
        remainingDailyRisk: snapshot.dailyLossRoomPercent,
        plannedRiskPercent: FOREX_RISK_LIMITS.plannedRiskPerTradePercent,
        openPlusPendingPercent: Number(snapshot.openRiskPercent || 0),
        sameDirectionPercent: 0,
        quoteOk: true,
        calendar,
        now: finishedAt,
        marginAvailable: snapshot.account.marginAvailable,
        requiredMargin: 0,
        conversionFactor: practiceCandidate.conversionFactor,
        clientRequestId: `${snapshot.account.id}:${practiceCandidate.instrument}:${practiceCandidate.strategyId}:${practiceCandidate.side}:${practiceCandidate.setupAnchor}`,
      }) : { ok: false, reason: "INSUFFICIENT_MARGIN" };
      practiceCandidate.state = snapshot.lastPracticeOrder.ok ? "ORDER_INTENT_CREATED" : "BLOCKED";
      if (snapshot.lastPracticeOrder.ok) practiceCandidate.strategyState = "ORDER_INTENT_CREATED";
      practiceCandidate.lastReason = snapshot.lastPracticeOrder.state || snapshot.lastPracticeOrder.reason;
      practiceCandidate.blockers = snapshot.lastPracticeOrder.ok ? [] : [snapshot.lastPracticeOrder.reason];
      practiceCandidate.executionAuthorization = "None";
    }
    snapshot.signals = selectForexSignals(signalSources, bestByInstrument, recovered);
    if (ledgerStore.isDurable?.()) {
      await ledgerStore.commit(ledger => {
        ledger.candidates = candidates.map(({ specRow, ...row }) => ({ ...row, transitions: row.transitions.slice(-16) }));
        ledger.audits.push({ at: new Date(finishedAt).toISOString(), type: "CANDIDATE_CYCLE", candidates: candidates.map(c => ({ instrument: c.instrument, side: c.side, strategyId: c.strategyId, firstSeenAt: c.firstSeenAt, state: c.state, reason: c.lastReason, blockers: c.blockers, outcome: "UNKNOWN" })) });
      });
      const ledger = await ledgerStore.load();
      snapshot.ledger = { specVersion: spec.version, tradeCount: (ledger.archivedFillCount || 0) + ledger.fills.filter(f => f.action === "CLOSED").length,
        recordedFills: ledger.fills.length, outcomeStatus: "BROKER_RECONCILED", systems: {} };
    }
    snapshot.positions = openTrades.map((trade) => {
      const quote = currentPrices.find(row => row.instrument === trade.instrument);
      return positionContract({ ...trade, accountId: snapshot.account.id,
        currentPrice: quote ? (Number(trade.currentUnits) > 0 ? quote.bid : quote.ask) : null });
    });
    snapshot.capitalSummary = capitalSummaryContract(snapshot.account, { quoteAgeSeconds: snapshot.quoteAgeSeconds });
    snapshot.autoTradeLimits = autoTradeLimitsContract({
      configured: FOREX_RISK_LIMITS,
      consumed: snapshot.openRiskPercent,
      remaining: snapshot.dailyLossRoomPercent,
      locks: snapshot.incidentLockActive ? ["INCIDENT_LOCK"] : [],
    });
    snapshot.operating = operatingStatus({
      connected: true,
      analysisReady: snapshot.analysisReady,
      executionReady: snapshot.executionReady,
      autoTradingAuthorized: snapshot.autoTradingAuthorized,
      forexAutoEnabled,
      incidentLockActive: snapshot.incidentLockActive,
      halt: snapshot.halt,
    });
    snapshot.sessionState = session;
    snapshot.coordinatorBound = Boolean(coordinator);
  } catch (error) {
    snapshot.executionReady = false;
    snapshot.autoTradingAuthorized = false;
    snapshot.halt = error.halt || error.reason || "UNCERTAIN_ORDER";
    snapshot.haltState = snapshot.halt;
    snapshot.lastError = String(error.message || error);
    if (ledgerStore.isDurable?.()) {
      await ledgerStore.commit(ledger => ledger.audits.push({ at: new Date(currentTime()).toISOString(), type: "SCAN_FAILED",
        instruments: spec.scanInstruments, reason: snapshot.lastError, outcome: "UNKNOWN" })).catch(recordError => {
        snapshot.recordingError = String(recordError.message || recordError);
      });
    }
    snapshot.operating = operatingStatus({ connected: Boolean(snapshot.account), forexAutoEnabled, halt: snapshot.halt });
  }
  return snapshot;
}
