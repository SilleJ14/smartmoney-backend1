# Historical entry-policy evaluation

`analytics/entryPolicyReplay.js` exports `compareEntryPolicies(candidates, specification)`.
It is an offline evaluator, not an order engine. It does not alter live thresholds or entry triggers.

Supply independently recorded, chronological observations for each symbol:

```js
{ symbol: 'SYMBOL', assetClass: 'stock', observations: [
  { at: 'ISO timestamp', bid: 10, ask: 10.01,
    setupDetected: true, triggerConfirmed: false }
] }
```

`assetClass` is `stock` or `crypto`. Setup and trigger flags must have been available
at the observation time; retrospectively assigning them using later prices invalidates the evaluation.

The specification requires trainingEnd, evaluationStart, evaluationEnd, horizonMs,
targetPercent, stopPercent, minimumSample, maximumEarlyMovePercent,
feePercentPerSide and slippagePercentPerSide. Select these before examining holdout
results. The evaluation start must be more than one horizon after training ends.

Entries use the ask plus costs, exits use subsequent bids less costs. Results keep
no-entry and incomplete-horizon cases separate and summarize stocks and crypto
separately. Include failed setups and delisted/rejected candidates in source data;
selecting only today's winners introduces survivorship bias.

This model cannot reconstruct unseen intrabar movement, actual queue position,
partial fills, or available size. Portfolio overlap and capital constraints require
separate evaluation. A synthetic test passing does not establish trading performance.

No historical performance conclusion has been established by this implementation.
An agreed period and suitable historical observations are still required.
