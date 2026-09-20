# Backend memory budget

`npm start` runs Node with `--max-old-space-size=192 --max-semi-space-size=16`.
These bound old-space and young-generation allocation space, not total process
RSS. Buffers, native allocations, code and other heap
regions still need headroom. A custom deployment command of `node server.js`
bypasses this setting; its equivalence must be checked before deployment.

Related allocation repairs preserve candidate counts and evidence:

- Coalesce construction of large state snapshots, keeping safety-journal calls immediate.
- Signal polling reads the orchestration state without building an unused full dashboard.
- Signal JSON is serialized one array item at a time with client backpressure and event-loop yielding.
- State-file writes preserve the synchronous JSON snapshot, but encode/write it
  in 64-Ki-character chunks instead of making a second full-size UTF-8 buffer.
- Quote revalidation reuses an existing same-version score basis instead of
  calculating a previous score that would immediately be discarded.
- Immutable crypto history shares its verified identity through a WeakMap;
  mutable history is never cached. The entry evaluator reuses its already
  calculated setup instead of calculating it twice.
- Final score normalization yields between four-candidate batches. Signal
  responses support streamed gzip with backpressure, without dropping fields.
- Incremental research waits while a full scan, scan lock, or enrichment batch
  is active. The next scheduler tick retries current candidates. Streaming,
  broker reconciliation and position protection are not paused by this change.

The guard detects cgroup v1/v2 and Node's constrained-memory limit once at
startup, taking the smallest available limit (including an explicit
`RENDER_MEMORY_LIMIT_MB`). If no limit is available, it assumes **512 MB**, not
2 GB. At 512 MB, elevated pressure starts at 368.64 MB and critical pressure at
435.2 MB. `/health` exposes `server.memory.limitSource` and `heapLimitMb` so the
live budget and effective heap limit can be verified without dashboard access.

Before this repair, public live health reported RSS **517.88 MB** at
2026-09-20T03:39:01Z while incorrectly reporting a 2048 MB budget and normal
pressure. The owner confirmed the service tier is 512 MB.

## Earlier verification (before this repair)

On Node 24.14.1, the isolated six-minute full-population regression completed two
scheduled scans with 60 stocks, 73 crypto, 320 request loops and zero broker writes.
Peak observed RSS was 406 MB against a 420 MB ceiling; maximum request time was
2,683 ms against the unchanged three-second deadline. Outcome storage had no
failed or rejected writes. See `memory-chunked-soak.log`.

Earlier failures remain in `memory-route-soak.log` and `memory-192-soak.log`.
The latter met the memory limit but failed a request deadline; it is not a pass.

## September 20 repair verification

`repair-cooperative-soak.log`: Node 24.14.1, 192 MB old space, 16 MB
semi-space, 512 MB guard, 400 MB RSS test ceiling. The six-minute workload
completed two scheduled scans with 60 stocks and 73 crypto candidates and 244
health/feed polling loops. Peak observed RSS: **311 MB**. Maximum request:
**2,806 ms** against the unchanged three-second deadline. Peak measured event
loop delay: **1,677 ms** (there is still latency headroom to improve).
Outcome storage: 160 writes completed, none failed/rejected; zero provider
order writes. This is bounded offline evidence, not production endurance proof.

Earlier repair attempts in `repair-memory-soak.log` and
`repair-memory-streaming.log` failed responsiveness. They remain failures;
the successful run includes cooperative work admission/normalization.

This is a bounded synthetic-load result, not a guarantee for all production
traffic, provider payloads, client counts, or operating systems. Render memory
usage must be verified again after deployment. No dashboard settings are changed
by this code; a custom start command may bypass the npm start flags.
