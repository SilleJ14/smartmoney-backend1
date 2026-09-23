# Forex safety configuration

The scanner is **practice analysis only**. It does not submit automatic orders;
live OANDA orders remain blocked. A saved Auto preference does not authorize execution.
Do not remove this boundary until the full practice order/reconciliation lifecycle is validated.

## Persistent ledger

Configure both variables against a genuinely persistent mounted disk:

```
FOREX_PERSISTENT_ROOT=/var/data
FOREX_LEDGER_PATH=/var/data/forex/ledger.json
```

The root is an operator declaration of the disk's persistence, not proof that an
arbitrary directory survives deployment. Verify the hosting mount and restart
survival before use. The ledger must resolve inside that root, including symlinks.
Without this configuration, file storage is analysis-only and never authorizes orders.

Run a single process/instance against this file. Commits are serialized within one
process; this is not a distributed database. Multiple workers require a transactional
database and execution-owner leases before enabling order submission. Existing files
are retained; no migration or clearing of safety locks occurs automatically.

## Economic-calendar adapter

Set `FOREX_CALENDAR_PATH` to a JSON snapshot maintained by a trusted calendar adapter.
No external provider subscription or credentials have been configured by this change.
The adapter must atomically replace the file, refresh within 15 minutes, and provide
complete relevant event coverage (including the strategy's eight-hour holding horizon).
Do not claim complete coverage for an empty, failed, truncated, or partial response.

Normalized schema (timestamps below are illustrative, not a working current feed):

```json
{
  "source": "your-provider",
  "refreshedAt": "2026-09-22T18:00:00Z",
  "coverageComplete": true,
  "events": [
    {
      "currency": "USD",
      "type": "FOMC central bank decision",
      "start": "2026-09-22T18:30:00Z",
      "end": "2026-09-22T19:00:00Z"
    }
  ]
}
```

Use uppercase ISO currencies or `ALL`. Supply relevant high-impact events; the
checker conservatively blocks every supplied relevant event in its configured window.
Missing, malformed, future-dated, or stale coverage blocks new automatic entries.

## Accounting and recovery

- The daily session rolls at 00:00 UTC. Initial/next-session baseline is the first
  observed NAV, not reconstructed midnight NAV; gaps across midnight need historical
  NAV reconstruction before relying on the daily limit for automated execution.
- Fund transfers covered by the account snapshot adjust daily/peak baselines once.
- Existing incident locks remain latched for review; midnight does not clear them.
- Open risk estimates additional loss from executable prices to attached stops,
  converted with OANDA's account-loss factor. It is separate from margin usage.
  Future fees, gaps and slippage are not included; missing inputs return unknown,
  not zero. Current NAV already incorporates booked costs and unrealized P/L.
- Pending entry orders block recovery until reconciled. Attached protective orders
  do not count as new entry orders. Missing pending-order data also blocks readiness.
- Exits during a pause/incident require a fresh broker position, matching instrument,
  and reducing units. Full closes use the trade endpoint; partial reductions use
  broker-enforced REDUCE_ONLY. Durable intent logging and live-host blocks still apply.

## Verification

Run from the backend directory:

```
node --test test/forexEngine.test.js test/forexArchitecture.test.js test/forexSafetyRegression.test.js
```

These tests use mock brokers only. Deployment, provider connectivity, persistent
mount configuration, and real practice-account recovery require separate verification.

## OANDA lifecycle corrections

- The pause/resume preference is persisted in runtime config and passed to recovery.
  Submission checks both the ledger pause and the latest runtime preference.
- Order fills, reductions, and closes are replayed idempotently by account and
  transaction. Known client-order/order IDs link records to local intents. External
  positions remain blocked for review rather than being silently adopted.
- Existing ledgers replay history once to populate missing fill records. Legacy
  intents lacking broker/client IDs may still need manual reconciliation.
- Only a confirmed `ORDER_FILL` response returns success. Cancellations/rejections
  release reserved risk; malformed responses and network failures retain it and
  block new entries until the outcome is reconciled. Filled reservations become
  consumed and the position is tracked from the broker snapshot.
- Run `node --test test/oandaIntegrationSafety.test.js test/operationalControlRoutes.test.js`
  for the additional integration regressions. They do not contact OANDA.
