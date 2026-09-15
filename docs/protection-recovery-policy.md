# Protection failure policy

This documents the existing managed-execution policy; it does not authorize a new liquidation strategy.

- A failed or uncertain protective order sets protection status to not ready and flags attention. New purchases remain blocked.
- Preserve the durable client order ID, actual fills, remaining exposure and all existing locks. A timeout is not proof that the broker rejected an order.
- Reconciliation queries existing orders before another protective submission. Unknown outcomes remain unresolved rather than being blindly resubmitted.
- Continue processing other managed positions and available exit handling. A failure on one position must not be treated as a fill or clear the position.
- Do not automatically liquidate solely because data or protection placement failed. Such a policy would need separate authorization and tests covering broker availability, slippage and duplicate exits.
- Readiness returns only after successful reconciliation. Broker-side stop orders may remain active during an application outage; a stop-limit order does not guarantee execution.

The application exposes the attention state in `positionProtection`. Remote notification delivery and recovery across Render server replacement still require live verification.
