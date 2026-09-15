# Backend memory budget

`npm start` now runs Node with `--max-old-space-size=192`. This limits JavaScript
old-space, not total process RSS. Buffers, native allocations, code and other heap
regions still need headroom. A custom deployment command of `node server.js`
bypasses this setting; its equivalence must be checked before deployment.

Related allocation repairs preserve candidate counts and evidence:

- Coalesce construction of large state snapshots, keeping safety-journal calls immediate.
- Signal polling reads the orchestration state without building an unused full dashboard.
- Signal JSON is serialized one array item at a time with client backpressure and event-loop yielding.

On Node 24.14.1, the isolated six-minute full-population regression completed two
scheduled scans with 60 stocks, 73 crypto, 320 request loops and zero broker writes.
Peak observed RSS was 406 MB against a 420 MB ceiling; maximum request time was
2,683 ms against the unchanged three-second deadline. Outcome storage had no
failed or rejected writes. See `memory-chunked-soak.log`.

Earlier failures remain in `memory-route-soak.log` and `memory-192-soak.log`.
The latter met the memory limit but failed a request deadline; it is not a pass.

This is a bounded synthetic-load result, not a guarantee for all production
traffic, provider payloads, client counts, or operating systems. Render memory
usage and the actual startup command have not been inspected or changed.
