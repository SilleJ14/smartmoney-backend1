# Forex discovery, Autopilot and trading trace

Date: 2026-09-23. Scope: current local backend and Expo frontend source; isolated mocks only. No provider orders, configuration changes, deployment or Render dashboard access. Deployed configuration, account connectivity and actual fills were not verified.

## Actual path

Main stock/crypto engine cycle (default scheduled interval 300 seconds) -> forex cycle -> OANDA account, trades, pending orders, transactions, instruments and prices -> nine fixed currency pairs -> H4/H1/M15 candles -> breakout/retest and trend-continuation evaluation in both directions -> quote/calendar/session/spread/stop/conflict checks -> first executable candidate -> risk-based units -> durable intent and reservation -> OANDA practice FOK market order with attached stop and target -> fill reconciliation on later cycles -> frontend status/signals.

Pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, NZD/USD, USD/CAD, EUR/JPY, GBP/JPY.

This is not exchange arbitrage or stock D/E/F scoring. Opportunity detection is rule-based: H4 trend context, H1 structure/ATR, M15 breakout/retest or continuation trigger. It supports long and short candidates. The target is 2.2 times stop distance, with a minimum net reward/risk check of 2. Those ratios are plans, not measured probabilities or proof of profitability.

Current spec enables practice submission and prohibits the OANDA live host. This audit does not recommend or authorize enabling live orders.

## Confirmed findings

### 1. Critical: Forex Autopilot OFF is not enforced by the final order path

`forex/safetySupervisor.js` computes `autoTradingAuthorized` using `forexAutoEnabled`. However, `forex/forexEngine.js:423` rebuilds readiness from `recovered.executionReady`, and line 431 overwrites authorization with that readiness without checking Autopilot. Candidate eligibility also uses execution readiness rather than authorization. The coordinator bypasses the authorization check for practice orders.

Mock engine result with Autopilot false: `executionReady:true`, `autoTradingAuthorized:true`, `halt:CLEAR`. A separate fully mocked coordinator submitted and recorded a fill with `autoTradingAuthorized:false`. No real order was submitted.

`/forex-auto/off` only clears that flag; it does not set `forexPauseEntries`. The separate entry-pause control is checked at durable intent creation. The main emergency-stop flag is not passed into forex's entry-pause callback (`server.js:24254`), so it must not be presented as a global forex stop.

### 2. High: Normal market-closure gaps block historical candle evidence

`forex/candleIntegrity.js` labels every interval over 1.5 times the bar period as `CANDLE_GAP`, without excluding scheduled closures. An ordinary Friday-to-Sunday transition fails the probe. H4 history of 220 bars normally spans weekends, so this can systematically block otherwise usable setups. Actual provider history has not been retrieved in this audit.

The same validator accepts invalid OHLC and old timestamps as long as timestamp ordering/gaps pass. An old single candle with impossible high/low and NaN close passed the isolated validation probe. The mapping layer also converts invalid numeric values to zero and assumes an array of non-null candle objects. Freshness, OHLC validity, completion provenance and market-calendar-aware continuity need independent checks.

### 3. High: The scan makes its own quotes stale and applies a global block

`forex/forexEngine.js:285` processes pairs sequentially, fetching three candle sets then a quote for each. Only after all nine pairs does it recheck earlier quotes. It then uses the oldest pair's quote age to block the entire engine (`:414`).

Simulated 27-second scan with a current quote returned at every individual quote request: first pair age 24 seconds, final pair age zero, global halt `STALE_PRICE`. This is a scheduling problem, not proof of a provider outage. Revalidation remains necessary, but should refresh the selected candidate and avoid unrelated pairs disabling it.

### 4. High: Forex scheduling depends on unrelated stock/crypto work

Forex runs at the end of `engine/createEngineCycle.js:2961`. Missing Alpaca/stock-provider keys, earlier exceptions, heavy scan time and the memory-pressure early return can prevent that call. It does not have an independently scheduled forex protection/entry loop in the inspected server wiring. The default main cycle interval is five minutes (`server.js:924`). OANDA requests have no explicit timeout in `forex/oandaClient.js`.

### 5. High: Several execution checks are placeholders or not repeated at submission

The engine supplies `requiredMargin:0`, `sameDirectionPercent:0`, and conversion factors that fall back to 1. Position sizing does not consume the top-level `homeConversions` loss factors used by open-position risk. Non-account-currency pairs can therefore be sized incorrectly when conversion evidence is absent.

The coordinator trusts `quoteOk:true` and caller readiness; it does not refresh quotes/account state itself. The engine omits `confirmedAt` and `confirmationPrice`, making the coordinator's optional entry-age/chase checks inoperative for this path. Declared account/conversion age policies are not fully enforced. Price/stop/target strings are not rounded to instrument display precision before submission.

### 6. High: Exit and missing-protection handling is incomplete

Orders request broker-side stop loss and take profit. That is a real protective mechanism, subject to broker acceptance/fill. However, `holdExpired()` has no runtime caller, and `missingProtectionResponse()` only returns repair/emergency-close flags. The engine does not execute those repair/close actions. There is no wired continuous forex trailing/reversal/time-exit loop in the inspected paths.

The coordinator supports verified reduce-only closes in isolation, but availability of a helper is not proof that the engine invokes it. Protection verification also primarily checks presence of a stop price, not its full broker state/side/quantity correctness.

### 7. High: Duplicate identity prevents later legitimate setups

The engine's client request identity is permanently `pair:strategy:side` (`forex/forexEngine.js:487`). The coordinator blocks matching historical intents unless their state is REJECTED. Consequently a completed or cancelled earlier setup can block a new independent setup indefinitely. Probe: first mocked submission FILLED; subsequent flat-position plan with the same identity returned `DUPLICATE_INTENT`.

A stable identity should deduplicate retries of one setup, not all future setups in the same direction.

### 8. High: Setup lifecycle is not actually maintained across scans

Each scan creates new candidates and recalculates the supposedly frozen windows. Prior candidates, first-seen times, trigger times and expiry anchors are not restored from the ledger. `ledger.candidates` is defined but not populated by this engine.

In `strategies/trendContinuation.js`, `after = minutes.slice(-4)` always has four elements after the earlier minimum-length check. Thus a qualifying pullback without a trigger goes directly to EXPIRED; its PULLBACK waiting branch cannot run.

Breakout range and M15 search windows are selected by array positions without aligning the breakout window after the frozen range's end. The chase check uses `frozen.H` for both directions instead of the actual trigger/confirmation price; this can reject normal confirmed breakouts and uses the wrong boundary for shorts. These strategy paths need time-ordered fixtures before changing strategy thresholds.

### 9. Medium: The scanner does not rank potential profitability

It scans a fixed nine-pair list and selects the first eligible candidate, not the strongest cost-adjusted opportunity. It does not implement broad pair discovery, cross-pair relative strength or measured expected-return ranking. Do not describe these as implemented features.

The current 10% per-trade planned loss budget equals the total open-risk and daily-loss limits. A full-sized trade consumes the configured risk budget; even a small day loss can make the next fixed 10% proposal exceed remaining room. This is a policy choice requiring explicit review, not a reason to silently lower safety checks.

### 10. High: Calendar and strategy approval can be bypassed in practice mode

Practice mode permits unavailable calendar evidence in the engine and bypasses strategy registry approval. The coordinator similarly allows a missing calendar in practice mode. The mocked unauthorized fill also had no calendar. Meanwhile status text claims unavailable calendar blocks new entries. The policy, implementation and message disagree.

### 11. High: Frontend and backend disagree about execution and positions

`app/(tabs)/index.tsx:11913` hardcodes ANALYSIS ONLY and says automatic orders are disabled; the backend has practice submission enabled. AI also hardcodes AUTO OFF for forex. Manual forex Buy/Review is an alert, not an OANDA order request.

The shared positions state is filled from `/alpaca/broker-positions` (`:5935`), then filtered for forex. It does not merge the OANDA positions published under `forexEngine.positions`, so forex counts/list can be empty despite broker exposure. Backend position contracts also need proper instrument/status fields for a frontend merge.

Home equity reads `nav` rather than backend `NAV`; portfolio risk cards read `openRiskLimit/riskLeft/dailyLossRoom`, while the backend publishes `autoTradeLimits` and `dailyLossRoomPercent`. Missing values are converted to zero. The frontend can therefore show misleading account/risk values. Ready rows are based on candidate state, which can precede account sizing/order rejection; the exact final blocker is not always reflected back onto the row.

### 12. Medium: Decision history, outcome evidence and memory bounds are incomplete

Strategy results with status NONE are discarded and become a generic NO_SETUP signal. Some spread, stop, chase, duplicate and sizing failures do not become explicit candidate blockers. First detection and every failed gate are not durably recorded.

The UI learning summary reuses `state.ledger` or a zero-trade default, rather than rebuilding its summary from the durable fills. Replay/evaluation helpers exist but do not demonstrate profitable performance. `replay.js` filters by candle timestamp, without adding the bar duration; if supplied normal provider bar-start timestamps and final completed OHLC, this risks look-ahead in historical evaluation.

The forex JSON ledger has no retention bounds for seen transaction IDs, intents, fills or repeated unexplained/protection records. Commits synchronously load/serialize the whole file. This is a growth/allocation risk, not an established cause of the previously reported production OOM. File rename gives atomic replacement, but no explicit fsync or cross-process transaction lock is present; default execution owner is the same `local` identifier across instances.

## Verification performed

- Node v24.14.1, existing forexEngine/forexArchitecture/forexSafetyRegression suites: 38 passed, 0 failed.
- Independent, network-free probes reproduced: Autopilot-off authorization; mocked submission despite false authorization and absent calendar; repeat setup blocked after a filled intent; scheduled weekend classified as missing candles; malformed OHLC accepted by candle validator; freshly fetched quotes aging into a global stale halt during sequential scanning.
- Passing existing tests does not invalidate these probes. Existing scan tests use missing setups, stale evidence or non-durable storage and therefore do not prove that an eligible setup respects Autopilot OFF.
- Live OANDA account, deployed revision, persistent disk, provider responses and actual forex trade history remain unverified.

## Recommended repair order (not implemented in this audit)

1. Enforce Forex Autopilot and entry pause at decision and submission; explicitly define emergency-stop scope. Align UI with actual practice-only capability.
2. Make candle validation session-aware and strict on OHLC/freshness; fix elapsed-quote scheduling and pre-submit evidence checks.
3. Isolate forex scheduling and always run position protection independently of candidate scans.
4. Correct conversion/margin/exposure sizing and durable setup-specific order identity.
5. Implement persistent setup lifecycle, real exit/repair actions and complete candidate reasons/history.
6. Bind OANDA positions, capital, risk and learning results to the frontend contract.
7. Add positive/negative end-to-end mock tests, restart/race tests, realistic replay and a bounded-ledger soak. Assess opportunity quality only after those correctness tests pass.

No live trading enablement or strategy threshold change should be inferred from this audit.
