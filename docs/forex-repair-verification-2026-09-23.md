# Forex repair and control isolation

Local implementation following `forex-trace-audit-2026-09-23.md`. No deployment, real orders, account changes, credential changes or Render dashboard access were performed.

Subsequent operator-requested permission change: see `forex-autopilot-entry-policy.md`. Continuation practice entries can now be operator-authorized by Forex Autopilot ON without promoting the research registry; breakout/retest still requires separate approval. Other safety gates remain.

## Control boundaries

- Stock/crypto Autopilot and `/emergency-stop` affect only Alpaca stock/crypto entry controls. Existing stock/crypto OFF/release policy is unchanged.
- Forex Autopilot and `/forex-emergency-stop` affect only OANDA forex entry controls. Releasing the forex stop leaves Forex Autopilot off until separately enabled.
- Home routes ON/OFF to the selected desk. Settings has separate forex stop/release controls. Backend status publishes both independent states.
- Stopping new entries does not disable risk-reducing position protection or exits in that desk. A stop is not an instruction to liquidate every position.
- Forex scans have a separate single-flight 15-second schedule; position protection has an independent 5-second schedule. These are scheduling intervals, not guaranteed provider latency. A stock/crypto scan does not gate either lane. Both still share a server process and its availability.

## Repairs

1. Enforce current Forex Autopilot, forex entry pause and forex stop at candidate authorization, durable intent creation and immediately before order submission.
2. Refresh selected execution evidence after historical work; independently validate provider quote times, account age, broker positions, pending orders, margin, currency conversion, trigger expiry and protection precision. Missing conversion or invalid risk evidence blocks entry rather than defaulting to positive evidence.
3. Validate candle arrays, OHLC, completeness, age and open-session gaps. Scheduled weekend closure is not treated as missing trading bars.
4. Preserve setup anchors across scans. Correct breakout/retest windows and chase reference, continuation pullback expiry and trigger handling. Merely watching opposite directions no longer invalidates a confirmed setup.
5. Use setup-specific request identities. Persist order intent and reservation together. Unknown outcomes retain reservations and must reconcile before another entry.
6. Check forex positions independently of discovery and Autopilot. Missing broker protection triggers a verified reduce-only close; known managed positions also have maximum-hold, event-window and weekly-close handling. Existing broker-attached stops and targets remain.
7. Save candidate dispositions/blockers and bounded transitions, link filled entry/exit records to candidate and strategy, retain explicit UNKNOWN for outcomes not established by broker evidence. This is not a completed profitability study.
8. Bound active ledger collections, archive eligible historical records before trimming, retain unresolved orders/open-position records, fsync durable writes, and serialize cross-process commits. No Render memory setting was changed. Disk archive growth still requires operational retention/capacity management.
9. Read OANDA positions, NAV and risk fields in the app instead of Alpaca positions or nonexistent fields. Keep forex exposure separate from stock/crypto calculations. Missing risk evidence displays unavailable. Prefer the current forex snapshot and preserve status access if Alpaca account refresh fails.

## Verification

- Final Node v24.14.1 backend regression run, including the Home/status changes: **1,006 tests passed, 0 failed, 0 skipped**, exit code 0, approximately 99 seconds.
- New `test/forexRepair.test.js`: 20 passing tests, including a complete eligible mocked order, the same setup with Autopilot off, stop races, stale evidence, malformed bars, margin/precision, missing conversion, setup identity, restart reconciliation, candidate-to-exit linkage and archival failure/preservation.
- Focused forex, OANDA, operational-control and status suites: 64 passed.
- Frontend static contract tests check Home desk routing and separate settings controls. No physical iPhone visual/interaction verification was performed.
- Frontend `tsc --noEmit` remains blocked by a pre-existing unrelated `Signal.currentDecision` type error at `app/(tabs)/index.tsx:1229`; no additional TypeScript errors were reported after these changes.

## Not established or changed

- OANDA real-money forex execution remains disabled. Automatic practice execution still requires an approved strategy registry, current economic-calendar coverage and durable storage. Defaults must not be mistaken for production approval.
- Render persistence, actual account/provider permissions, current deployed versions and device installation were not verified.
- The fixed nine-pair universe, strategy thresholds, 10% forex risk ceiling, stock/crypto scoring and thresholds were not changed. The existing 10% risk ceiling is substantial; correctness tests do not validate its suitability or profitability.
- No historical out-of-sample comparison, sustained memory soak or performance claims are established by these tests. In particular, the earlier attempted 13-hour memory validation stopped with a health-request timeout; it did not complete.
