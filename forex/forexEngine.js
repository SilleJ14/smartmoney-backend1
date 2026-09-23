import { FOREX_SPEC, FOREX_SPEC_VERSION, toDisplayPair } from "./forexSpec.js";
import { FOREX_RISK_LIMITS } from "./riskManager.js";
import { canonicalAccountId, resolveAssetClass } from "./identity.js";
import { createApprovalRegistry, mayAutoExecute } from "./approvalRegistry.js";
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
import { mapInstrument, quoteConversionFactor } from "./instrumentSpecs.js";
import { resolveStrategyConflict, oneOpenPerPair } from "./conflictPolicy.js";
import { chasedAway, plannedTarget, stopDistanceOk } from "./strategyExits.js";
import { defaultCalendarSnapshot, calendarForDecision } from "./calendarFeed.js";
import { dailyLossState, drawdownLock, remainingDailyRiskPercent } from "./accountRisk.js";
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
  return (payload?.candles || []).map((candle) => ({
    t: candle.time,
    o: num(candle.mid?.o ?? candle.bid?.o),
    h: num(candle.mid?.h ?? candle.bid?.h),
    l: num(candle.mid?.l ?? candle.bid?.l),
    c: num(candle.mid?.c ?? candle.bid?.c),
    bidH: num(candle.bid?.h),
    bidL: num(candle.bid?.l),
    askH: num(candle.ask?.h),
    askL: num(candle.ask?.l),
    complete: candle.complete !== false,
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
    system: result.strategyId,
    price: quote.mid,
    livePrice: quote.mid,
    displayPrice: quote.mid,
    bid: quote.bid,
    ask: quote.ask,
    liveQuoteUpdatedAt: quote.time,
    specVersion: FOREX_SPEC.version,
    raw: {
      forexState: frontendState(row.state),
      forexSide: row.side,
      forexGates: {
        trend: (result.passed || []).length > 0,
        setup: row.state !== "INVALIDATED",
        entry: row.state === "EXECUTION_ELIGIBLE",
        risk: recovered.executionReady === true,
      },
    },
  };
}

export async function runForexEngineCycle({
  client,
  spec = FOREX_SPEC,
  state = {},
  forexAutoEnabled = false,
  now = Date.now(),
  durableStorageAvailable = false,
  store,
  calendar = defaultCalendarSnapshot(),
  instanceId = "local",
} = {}) {
  const registry = state.registry || createApprovalRegistry();
  const ledgerStore = store || createForexStore({
    memory: !durableStorageAvailable,
    treatAsDurable: durableStorageAvailable === true,
  });
  const supervisor = createSafetySupervisor({ store: ledgerStore, instanceId });
  const coordinator = client ? createExecutionCoordinator({
    adapter: client,
    registry,
    store: ledgerStore,
    instanceId,
  }) : null;

  const snapshot = {
    specVersion: FOREX_SPEC_VERSION,
    forexAutoEnabled: forexAutoEnabled === true,
    halt: "CLEAR",
    haltState: "CLEAR",
    session: "OANDA_PRACTICE",
    quoteAgeSeconds: null,
    openRiskPercent: 0,
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
    calendarNote: calendar.coverageComplete ? "Calendar coverage current." : "Calendar missing — new forex entries blocked.",
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
    const tradesPayload = typeof client.getOpenTrades === "function" ? await client.getOpenTrades() : { trades: [] };
    const openTrades = tradesPayload?.trades || [];
    const txPayload = typeof client.getTransactionsSince === "function"
      ? await client.getTransactionsSince(state.lastTransactionId || 0)
      : { transactions: [] };
    const instrumentPayload = typeof client.getInstruments === "function" ? await client.getInstruments() : { instruments: [] };
    const specs = new Map((instrumentPayload?.instruments || []).map((row) => [row.name, mapInstrument(row)]));
    const pricesPayload = await client.getPrices(spec.scanInstruments);
    const prices = (pricesPayload?.prices || []).map(mapPrice);
    const clock = clockHealth({ now, providerTimestamp: prices[0]?.time });
    const session = forexMarketState(now);
    const recovered = await supervisor.recover({
      credentialsOk: true,
      accountSnapshot: snapshot.account,
      lastTransactionId: snapshot.account.lastTransactionID,
      transactions: txPayload?.transactions || [],
      openTrades,
      pendingOrders: [],
      historyLoaded: true,
      forexAutoEnabled,
      clockOk: clock.ok,
    });
    if (ledgerStore.isDurable?.()) {
      await ledgerStore.commit((ledger) => {
        const key = snapshot.account.id;
        if (!ledger.dayStart[key]) {
          ledger.dayStart[key] = { equity: snapshot.account.NAV, at: new Date(now).toISOString() };
        }
        const peak = Number(ledger.peakEquity[key] || 0);
        if (snapshot.account.NAV > peak) ledger.peakEquity[key] = snapshot.account.NAV;
        snapshot.dayStartEquity = ledger.dayStart[key].equity;
        snapshot.peakEquity = ledger.peakEquity[key];
        snapshot.incidentLockActive = Boolean(ledger.incidentLocks[key]);
      });
    }
    const daily = dailyLossState({
      accountId: snapshot.account.id,
      equity: snapshot.account.NAV,
      dayStartEquity: snapshot.dayStartEquity || snapshot.account.NAV,
      cashFlowAdjustedDayStart: snapshot.dayStartEquity || snapshot.account.NAV,
    });
    const dd = drawdownLock({ peakEquity: snapshot.peakEquity, equity: snapshot.account.NAV });
    if ((daily.locked || dd.locked) && ledgerStore.isDurable?.()) {
      await ledgerStore.commit((ledger) => {
        ledger.incidentLocks[snapshot.account.id] = { reason: daily.reason || dd.reason, at: new Date(now).toISOString() };
      });
      recovered.incidentLockActive = true;
      recovered.executionReady = false;
      recovered.autoTradingAuthorized = false;
    }

    const quotePolicy = forexEvidencePolicy("forex", "order", "automatic");
    const quoteAges = [];
    const candidates = [];
    const bestByInstrument = new Map();
    const calendarGate = calendarForDecision(calendar, { now });

    for (const instrument of spec.scanInstruments) {
      const assetClass = resolveAssetClass({ assetClass: "forex", broker: "oanda", instrumentId: instrument });
      const identity = canonicalAccountId({
        environment: "practice",
        broker: "oanda",
        accountId: snapshot.account.id || client.accountId,
        assetClass,
        instrumentId: instrument,
      });
      const quote = prices.find((row) => row.instrument === instrument) || {};
      const quoteEvidence = stampEvidence({
        source: "oanda_pricing",
        instrument,
        account: snapshot.account.id,
        providerTimestamp: quote.time,
        payload: quote,
        now,
      });
      const quoteIssues = validateQuote(quoteEvidence, { now, policy: quotePolicy });
      const quoteAge = Number.isFinite(Date.parse(quote.time)) ? (now - Date.parse(quote.time)) / 1000 : null;
      if (quoteAge != null) quoteAges.push(quoteAge);

      const [h4, h1, m15] = await Promise.all([
        client.getCandles(instrument, { granularity: "H4", count: spec.h4Count, price: "MBA" }),
        client.getCandles(instrument, { granularity: "H1", count: spec.h1Count, price: "MBA" }),
        client.getCandles(instrument, { granularity: "M15", count: spec.m15Count, price: "MBA" }),
      ]);
      const snapshotBars = {
        h4: mapCandles(h4, "oanda_candles_h4"),
        h1: mapCandles(h1, "oanda_candles_h1"),
        m15: mapCandles(m15, "oanda_candles_m15"),
      };
      const candleIssues = [
        ...inspectCandles(snapshotBars.h4, "H4").issues,
        ...inspectCandles(snapshotBars.h1, "H1").issues,
        ...inspectCandles(snapshotBars.m15, "M15").issues,
      ];
      const holdOk = mustCloseBeforeEventOrWeekend({ now, maxHoldHours: spec.maxHoldHours });
      for (const side of ["buy", "sell"]) {
        const results = [
          evaluateBreakoutRetest({ ...snapshotBars, side }),
          evaluateTrendContinuation({ ...snapshotBars, side }),
        ];
        for (const result of results) {
          if (result.status === "NONE") continue;
          const row = createCandidate({ identity, strategyId: result.strategyId, side, frozen: result.frozen });
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
            confirmationPrice: result.frozen.H || result.frozen.reference,
            currentPrice: entryQuote,
            A: result.frozen.A,
          });
          const dataOk = quoteIssues.length === 0 && candleIssues.length === 0 && session.open && !session.tooCloseToWeeklyClose && holdOk.ok && calendarGate.ok;
          const executable = (result.reason === "RENEWED_MOVEMENT" || result.reason === "ENTRY_TRIGGER")
            && mayAutoExecute(registry, result.strategyId, "FORWARD_PRACTICE")
            && recovered.executionReady
            && recovered.autoTradingAuthorized
            && dataOk
            && spread.ok
            && stopDistanceOk({ entry: entryQuote, stop, A: result.frozen?.A })
            && !chased
            && !oneOpenPerPair(openTrades, instrument);
          let stage = executable ? "EXECUTION_ELIGIBLE" : result.stage;
          let reason = result.reason;
          if (!session.open) reason = session.reason || "WEEKEND";
          else if (quoteIssues.length) reason = quoteIssues[0];
          else if (candleIssues.length) reason = candleIssues[0];
          else if (!calendarGate.ok && (result.reason === "RENEWED_MOVEMENT" || result.reason === "ENTRY_TRIGGER")) {
            reason = calendarGate.reason;
            if (stage === "EXECUTION_ELIGIBLE") stage = "BLOCKED";
          }
          transitionCandidate(row, stage, reason, {
            passed: result.passed,
            pending: executable ? [] : (result.pending || ["Strategy approval"]),
            executionAuthorization: executable ? "PRACTICE" : "None",
            stop,
            instrument,
          });
          candidates.push(row);
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
    snapshot.candidates = candidates;
    snapshot.signals = [...bestByInstrument.values()].map(({ rowState, ...signal }) => signal);
    snapshot.quoteAgeSeconds = quoteAges.length ? Math.max(...quoteAges) : null;
    snapshot.analysisReady = recovered.analysisReady;
    snapshot.executionReady = recovered.executionReady && !daily.locked && !dd.locked;
    snapshot.autoTradingAuthorized = recovered.autoTradingAuthorized && snapshot.executionReady;
    snapshot.incidentLockActive = recovered.incidentLockActive || daily.locked || dd.locked;
    snapshot.pauseEntries = recovered.pauseEntries === true;
    snapshot.halt = snapshot.quoteAgeSeconds != null && snapshot.quoteAgeSeconds > spec.quoteProviderMaxAgeSeconds
      ? "STALE_PRICE"
      : recovered.halt;
    snapshot.haltState = snapshot.halt;
    snapshot.dailyLossRoomPercent = remainingDailyRiskPercent(daily);
    snapshot.openRiskPercent = snapshot.account.NAV ? (num(snapshot.account.marginUsed) / snapshot.account.NAV) * 100 : 0;
    snapshot.positions = openTrades.map((trade) => positionContract({ ...trade, accountId: snapshot.account.id }));
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
    snapshot.halt = error.halt || error.reason || "UNCERTAIN_ORDER";
    snapshot.haltState = snapshot.halt;
    snapshot.lastError = String(error.message || error);
    snapshot.operating = operatingStatus({ connected: Boolean(snapshot.account), forexAutoEnabled, halt: snapshot.halt });
  }
  return snapshot;
}
