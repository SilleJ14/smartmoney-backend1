# Candidate-feed timeout repair

## Reproduced failure and cause

The full-population isolated server (60 stocks, 73 crypto) failed the unchanged
3-second `/frontend/signals` request deadline after roughly 98 seconds. This was
a response timeout, not an out-of-memory crash. The previous 1,034 passing regular
tests did not exercise that sustained request sequence.

Payload measurement found approximately 9.8–10.1 MB of JSON for the default feed,
including the contract's repeated signal/watch lists and detailed evidence.
Streaming gzip introduced repeated thread-pool/drain/event-loop handoffs while
scan and durable-history work were active. An initial 8-MiB optimization was
insufficient: the default payload exceeded it and returned to the slow path.
That failed attempt is not counted as release validation.

## Change

- The signals route opts into a bounded, per-response gzip path of up to 32 MiB.
  This covers the measured default response and the tested 100-candidate window.
  Serialization/compression complete in one pass without asynchronous compression
  drain round trips. The compressed response is handed to the existing HTTP stream.
- Larger responses retain the streaming/backpressure fallback. The same iterator
  resumes at the boundary: no lost fields, repeated serialization or revalidation.
- No cached decisions between requests. Every request still applies live evidence,
  canonical ranking, approval and visibility rules. No fields or candidates removed.
- Slow-response diagnostics now include delivery-mode/size metadata when available.
- No scoring, thresholds, trading policy, provider credentials, memory-plan/heap
  settings or request deadline changed. No real broker writes used in verification.

## Tradeoff and scope

This deliberately spends a bounded transient buffer to reduce delivery latency.
32 MiB bounds the uncompressed fast-path text, not total V8 heap: strings, the join,
compression buffers and one overflow row also allocate memory. Very large responses
still stream. This is not a universal latency guarantee or proof of a 13-hour leak fix.

Tests cover exact decoded JSON equivalence, unicode, missing/null fields, oversized
fallback, slow-client backpressure, disconnect cancellation, current evidence on
successive reads, and frozen stock/crypto scores and policy weights.

## Final sustained-load verification

Node 24.14.1, 2-GB simulated container, unchanged 1-GB V8 heap and 3-second request
deadline. Six minutes of polling the maximum `limit=100` feed, 60 stocks and 73
crypto candidates, spanning two successful full scans:

- 233 request cycles, zero response timeouts; maximum measured request 2,676 ms.
- Peak RSS 464 MB; maximum event-loop delay 823 ms.
- 156 completed outcome-storage jobs, zero failed/rejected jobs; peak queue 3/64.
- Zero broker/provider order writes.
- Final complete backend suite: **1,039 passed, 0 failed, 0 skipped**, 115.95 seconds.
  Frozen stock/crypto baselines, authorization, forex calendar, restart, memory
  protections, response contract and isolated-server scenarios are included.

The prior 13-hour test failed; it has **not** been rerun for this code. Production
latency, memory over the old 12.5-hour failure window, deployment and phone adoption
remain separate verification. No hosting or publishing changes were performed here.
