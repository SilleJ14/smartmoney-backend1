# Approved release policy

The user requested removal of the overnight memory test and deployment of backend
and frontend. The release runner now uses the full regression suite plus a
six-minute, maximum-100-candidate feed test. The unchanged 3-second request deadline,
zero-order-write checks, learning-storage checks and memory bounds remain enforced.
No runtime heap limit, hosting plan, Autopilot preference or safety lock is changed.

Pre-publication evidence for the application source: 1,039 tests passed, zero
failed/skipped; six-minute full-population test completed 233 request cycles and
two scans, zero timeouts, 2,676-ms maximum request and 464-MB peak RSS.
See `candidate-feed-timeout-repair-2026-09-23.md`.

Overnight testing is no longer a release prerequisite. Historical failures are
retained as evidence, not represented as passing. Long-running production stability,
calendar entitlement/timezone and phone adoption are separate operational checks.
