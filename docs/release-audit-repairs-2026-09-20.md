# September 20 audit repairs

This release repairs the confirmed code findings in the September 19 audit.
It does not establish that all production candidates are Buyable or that the
strategy is profitable. No real orders were used in verification.

## Repairs

1. **Current risk budget:** both initial and immediately-before-submission
   stock/crypto guards choose loss-budget sizing from explicit purchase policy.
   AI-sized button orders require it despite being user-triggered. Discretionary
   manual purchases retain their agreed AI-policy exemptions, not safety bypasses.
2. **Manual conversion:** fractionable multi-day dollar orders now obtain verified
   prices before whole-share conversion. All eight dollar/share, fractional/whole,
   intraday/multi-day combinations are covered by actual route/service tests.
3. **Crypto request admission:** identical in-flight batches share work;
   provider concurrency/pending work is bounded; 429 status and Retry-After
   survive wrapping; cooldown prevents immediate retry storms. Successful quote
   data is not cached or retimestamped by this coordinator. Order writes do not
   use this research queue. Execution quote/orderbook requests have priority.
4. **Provenance:** decisions reference hashes of all first-party runtime JavaScript
   (including central server and risk/order code), a release commit when supplied,
   and allowlisted configuration. Sources/hashes contain no environment secrets.
   The bounded archive retains eight bundles, not unlimited reconstruction data.
5. **Evidence timing:** versioned per-type age/skew checks cover fast quotes,
   spread, news review/publication, slow fundamentals and independent context.
   Existing completed-bar rules and submission-time account checks remain.
   New timing rules affect execution authorization, not the frozen F formula.
   Legacy decisions retain existing gates until replaced by a new assessment.
6. **Retained outcomes:** candidate trace responses join confirmed realized trades
   for the requested symbol, deduplicate fills and preserve explicit UNKNOWN
   when no retained trade is available. This is not a claim that each scanned
   candidate was entered, or that a missing trade represents a loss.
7. **Memory/responsiveness:** detect the smallest configured/container budget;
   default to 512 MB if unknown; expose limit source and effective heap budget.
   Reuse immutable bar identities, already-calculated crypto setups and pinned
   quote-revalidation bases. Bound UTF-8 persistence allocation, stream/compress
   feed JSON with backpressure, yield during batched normalization and avoid
   overlapping full/incremental research. Candidate counts are not reduced.

## Verification

- Node 24.14.1 full backend suite: **853 passed, zero failed**;
  `repair-release-tests.log`.
- Frontend network/decision/percentage suites: **49 passed, zero failed**;
  root `repair-final-frontend.log`.
- TypeScript `--noEmit`: passed; root `repair-final-typescript.log`.
- Frozen stock and crypto fixtures preserve scores, contribution weights,
  coverage and blockers. Stock F 78 / Entry 75 / coverage .80 and crypto F 65
  plus existing gates remain unchanged.
- Six-minute isolated full-population workload: two scheduled scans, 60 stocks,
  73 crypto, 244 health/feed request loops, peak RSS **311 MB**, maximum request
  **2,806 ms**, zero broker writes. Outcome storage: 160 completed, zero failed
  or rejected writes. Test ceiling 400 MB with guard configured for 512 MB.
  `repair-cooperative-soak.log`. Final metadata hardening was subsequently
  covered by the complete release suite.
- Final full-population streaming run: 60-second polling soak, 1,600 simulated
  trade ticks, 48 polling loops, peak RSS **291 MB**, maximum request **2,234 ms**,
  zero broker writes; `repair-stream-release.log`.
- Earlier responsiveness failures remain recorded; they are not counted as
  successes. These synthetic-load results are bounded evidence, not a promise
  of indefinite production operation below a fixed RSS.

## Remaining external verification

- Live health-check access was requested and declined for this release. Do not
  claim the deployed revision, live memory, provider entitlements or current
  stock/crypto decisions were independently verified after publication.
- Render dashboard access remains off. Actual persistent-disk survival across
  service replacement still requires owner confirmation; local restart tests
  cannot prove it.
- Physical iPhone adoption remains unverified. This repair changes backend
  behavior without requiring a new phone binary or changing the JSON contract.
- Historical early-versus-confirmed-entry comparison still needs suitable
  point-in-time historical evidence. No made-up performance results or hidden
  strategy changes are part of this release.
- Preserve all existing trading locks and settings. Deployment is not authority
  to turn on trading, clear emergency stops, or place a real test purchase.
