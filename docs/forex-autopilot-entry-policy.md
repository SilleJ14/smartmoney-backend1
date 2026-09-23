# Forex operator-authorized continuation entries

## Scope of this change

Requested: keep the existing 10% limits and authorize automatic entry when Forex Autopilot is on. This changes execution permission, not evidence of strategy profitability. It does not implement a new H1-pullback strategy, change the pair universe, enable a trailing exit, enable the real-money OANDA host, deploy, or toggle the running account.

`FOREX_OPERATOR_CONTINUATION_V1` permits `FOREX_TREND_CONTINUATION_V1` in `FORWARD_PRACTICE` when Forex Autopilot is explicitly ON. All setup/data/account checks still apply. OFF, forex emergency stop, entry pause and explicit strategy disablement block entry. Stock/crypto controls are not inputs to forex permission.

Breakout/retest remains a separate strategy-registry approval track. Unknown strategies and manual-strategy IDs cannot acquire automatic-entry permission. Operator permission never promotes the research registry or fabricates a validation report. Candidates and saved order intents carry the permission source and policy version.

## Existing limits and rules retained

- Planned per-trade risk ceiling: 10%; combined open/pending risk ceiling: 10%; same-direction ceiling: 10%; daily-loss trigger: 10%; drawdown pause: 10%. Actual units can be smaller because of margin, stop distance and remaining risk. These are risk ceilings, not guaranteed maximum realized losses during gaps or slippage.
- Continuation remains the existing H4 trend / H1 structure / M15 pullback-and-confirmation implementation. A genuine H1 pullback alternative needs a separate strategy version and evaluation.
- Only provider-completed, validated H4/H1/M15 candles enter analysis.
- Stop: frozen pullback stop anchor and observed pullback extremes, plus a 0.10 H1 ATR buffer; permitted entry-to-stop distance 0.25–1.5 ATR.
- Fixed target: 2.2 times initial stop distance. Maximum hold: eight hours. Entry expires 60 seconds after confirmation; adverse movement over 0.10 ATR cancels entry.
- Economic calendar must have complete coverage refreshed within 15 minutes. Relevant major-event window: 30 minutes before through 15 minutes after; central-bank window: 60 minutes before/after. Existing weekly-close and maximum-hold restrictions remain.
- Fresh execution evidence, broker-verified margin/exposure, loss locks, durable storage, unresolved-order controls and attached protection remain mandatory.

## Evaluation work not claimed complete

The existing spread/net-reward filter is unchanged in this permission-only patch. A future fixed-versus-trailing comparison must freeze an explicit bid/ask/commission/slippage/financing convention, audit spread double-counting, include a worse-cost scenario, and simulate whole-account capital availability. No passing drawdown/return criteria or unseen-data performance have been established by this patch.

## Verification

Focused forex/OANDA suites: 76 passed, zero failures. New cases cover operator permission without registry promotion, separate breakout approval, rejection of unknown/manual/live permissions, disabled strategy, 10% invariants, scanner permission metadata, and broker-mocked continuation submission with ON versus blocking under OFF/STOP/stale data/missing calendar/loss lock.

Final full backend regression: Node v24.14.1, **1,014 passed, 0 failed, 0 skipped**, exit code 0, approximately 92 seconds. No real broker orders were used for testing.
