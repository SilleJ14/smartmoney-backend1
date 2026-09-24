# Forex Buyable investigation

Local corrections, not proof of the current live rejection cause:

- Preserve all strategy/direction evaluations in authenticated status under
  `forexEngine.decisionDiagnostics`, including reasons, pending checks, permission,
  per-pair reason counts, unscanned pairs and the latest order outcome.
- Prefer a triggered blocked setup over an unrelated discovered direction for the
  representative signal, without displacing an executable candidate.
- Propagate final account/risk blocks and late quote failures to candidates.
  A failed cycle cannot publish old ready signals.
- Report a submitted order as `ordered`, not a fresh watch/ready opportunity.
- Home Watching retains blocked forex rows; review uses actual backend reasons.

No thresholds, risk limits, or strategy permissions changed. Continuation still
uses explicit operator Autopilot permission; breakout/retest still requires its
separate strategy approval. No live broker orders were sent during verification.

Verification: forex regression suite and TypeScript. Live pair causes still need
authenticated observation; public health and unauthenticated HTTP 401 do not
establish whether a strategy qualifies. Local browser was opened for user login.
