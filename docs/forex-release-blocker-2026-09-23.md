# Forex calendar release preflight

Update: the reproduced short-load timeout was subsequently repaired and passed a
six-minute maximum-feed test covering two full scans. See
`candidate-feed-timeout-repair-2026-09-23.md`. The failed run below is retained as
the original evidence, not the latest test result. Long-duration memory validation
and actual publication remain separate.

Deployment requested for backend and frontend. Neither was published.

The previously recorded 1,034 passing functional/regression tests remain valid for
the backend working tree. They are not a sustained-load pass.

A fresh isolated 120-second full-load attempt (60 stocks, 73 crypto, 2 GB simulated
container, 1 GB V8 heap) failed after 98.6 seconds. `/frontend/signals` exceeded its
unchanged 3-second deadline. No provider order writes occurred. At the earlier
progress sample peak RSS was 348 MB; at failure reported RSS was about 281 MiB.
No OOM was reproduced. The earlier long-duration validation also remains failed.

Backend release is held pending correction and repeat validation of response
latency. The matching frontend release is held to avoid publishing controls ahead
of their backend routes. No Git push, Render changes, EAS publish or real trades
were performed.

Frontend preflight: corrected the missing optional `Signal.currentDecision` type
declaration without runtime behavior changes. TypeScript now passes; all eight
candidate-feed policy tests pass. EAS account authentication was verified.

Finnhub economic-calendar entitlement and unzoned event-time semantics still need
live verification after a safe release; neither is established by local mocks.
