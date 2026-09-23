# Heap exhaustion follow-up

The supplied V8 log proves heap exhaustion near 1 GB after about 12.5 hours.
It does not identify the retaining objects. The Render container has 2 GB;
the running command was `node server.js`, so package.json's heap flags cannot
be assumed to apply. No hosting plan or start-command change is made here.

## Implemented

- Outcome-store ingest now queues detached projections of only fields consumed
  by the outcome tracker, rather than retaining entire live candidate graphs.
  This also prevents later mutation of a candidate from changing queued history.
- Ingest queue admission has an 8 MiB serialized-payload budget in addition to
  its existing 64-job limit. This is a payload bound, not an exact V8 heap bound.
  Excess work rejects with the existing explicit retry/backpressure error.
- Queue diagnostics expose pending/peak payload bytes. Completion or failure
  releases the corresponding budget.
- Process heartbeats now include the actual runtime heap limit, heap-use
  percentage, and external memory. No credentials or provider payloads logged.
- Existing commit ca3bf12's heap-pressure and mid-stock-scan safeguards remain.
- Failed learning writes now emit an allowlisted gap record to bounded disk
  audit files and service logs. Records explicitly say NOT_REPLAYED; disk failure
  is reported as durable=false. A later success does not erase this record.
- Full signal responses use bounded gzip batching and time-budgeted yields,
  rather than a compression operation for every tiny JSON fragment. Disconnected
  readers stop candidate processing. No response fields or score rules removed.
- New executable cycle tests prove stock/crypto exits still run before the
  heavy-work guard, in open and closed sessions, with the daily lock preserved.

## Evidence and limits

Regression tests compare full candidates and projected candidates for identical
outcome calculations, verify detachment, exercise 5,000 projection generations,
check byte-budget rejection/recovery, and validate heartbeat heap measurements.

This is a confirmed retention-risk repair, not attribution of the production
crash to this queue. A production heap profile and observation beyond the prior
12.5-hour failure window are still needed to establish long-running stability.
No real orders are used for verification. Trading rules remain unchanged.

## Validation results

- Focused memory/restart/outcome tests: 49 passed.
- Final queue/backpressure/projection tests: 7 passed.
- Full suite: 978 tests, initially 976 passed. One failure was the expected
  diagnostic shape changing; its assertion was updated and the focused rerun
  passed. The other is an unrelated pre-existing forex expectation of
  ANALYSIS_ONLY versus the PRACTICE_ORDERS behavior introduced in 681c472.
- All 12 server scenarios passed in that suite, including 60 stocks and 73
  crypto candidates (167 MB peak RSS; no broker writes).
- A requested 120-second continuous full-load test did NOT complete: the
  frontend/signals request exceeded its 3-second deadline after about 54 seconds.
  Last recorded RSS was 231,862,272 bytes (~221 MiB), with zero provider writes.
  No OOM was reproduced. This failure remains a release-validation blocker;
  neither sustained stability nor elimination of the original leak is claimed.
- Changes remain local; no deployment or memory-limit change was performed.

## Continued validation

- Focused memory, restart, history, response and protection tests: 43 passed.
- Additional response/decision-contract tests: 28 passed; response tests with
  unicode, oversized rows and disconnect handling: 13 passed.
- The pre-existing forex test mode-label expectation was aligned with current
  practice-host configuration. Stale-data authorization and zero-order assertions
  remain intact; all 10 tests in that file pass. No forex runtime change.
- Earlier short stress attempts continued to exceed the 3-second request
  deadline, even with a 2 GB simulated container. These failures are retained
  in timeout-*-audit.log; larger memory alone was not a fix.
- scripts/memory-release-validation.mjs runs the full suite followed by a
  13-hour opt-in simulated-provider test with a 2 GB budget and 1 GB V8 heap.
  It checks retained-heap floors as well as peak RSS, queue errors, scan progress,
  requests and zero provider writes. A source fingerprint guards against edits
  invalidating the result. It never deploys or contacts live trading providers.
- Passing simulated-provider tests will not prove production is leak-free;
  deployed memory telemetry and sustained live observation remain necessary.
- Immutable crypto history normalization is cached weakly; mutable bars and
  all time-dependent completion/freshness checks are still re-evaluated. Frozen
  baseline tests pass. Opening-bell heavy work now also obeys pressure guards;
  exit handling continues, tested across the closed-to-open transition.
- Short stress tests still reproduce frontend response timeouts. The opt-in
  13-hour run records these and continues collecting memory evidence, then
  FAILS its release result if any occurred. This is not a timeout exemption.
  No deployment is authorized by a memory-only pass.
