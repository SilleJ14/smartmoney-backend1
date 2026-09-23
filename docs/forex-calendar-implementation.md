# Automatic forex economic calendar

## Implemented

- Backend Finnhub economic-calendar adapter with server-side header authentication.
- Startup refresh, five-minute polling, single-flight requests, timeout, response-size
  limits, sanitized diagnostics and retry backoff.
- Currency mapping, central-bank windows, timestamp validation and holding-horizon
  coverage checks. Unknown importance/geography is handled conservatively.
- Latest calendar rechecked after broker evidence refresh and immediately before
  automatic order submission, including changes during durable reservation creation.
- Failed refresh invalidates entry authorization without falsifying cached timestamps.
- Position protection continues independently of calendar availability and Autopilot.
- `/status.forexCalendar` exposes health and the app no longer substitutes a false
  "no restriction" message when calendar data is unavailable.
- Existing 10% limits, independent control domains and practice-only execution boundary
  are unchanged. No orders, deployment or credential changes performed.

## Verification and remaining operational checks

Full backend regression run: **1,034 passed, 0 failed, 0 skipped** using Node 24
with test concurrency 1. `node --check server.js` passed.

Provider tests use mocked HTTP responses, not authenticated Finnhub access. Execution
tests use mocked OANDA orders. See `test/forexCalendarProvider.test.js`,
`test/forexRepair.test.js` and `test/statusRoutes.test.js`.

Before operational use, verify Finnhub calendar entitlement and actual timestamp
format. A timezone-less response blocks until its timezone contract is verified;
only then configure the matching supported timezone. Current adapter supports UTC
for unzoned times and explicit ISO offsets. See `forex/DEPLOYMENT.md`.

This is scheduled macro-event coverage, not a complete breaking-news service.
Provider-reported date-range coverage cannot prove the provider omitted nothing.
Empty responses deliberately remain unverified, even on quiet days.

Frontend type-check still reports the pre-existing `Signal.currentDecision` issue
at `app/(tabs)/index.tsx:1229`; no additional type errors were reported.

## Provider contracts

- https://finnhub.io/docs/api/economic-calendar
- https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/docs/EconomicEvent.md
- https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/README.md
