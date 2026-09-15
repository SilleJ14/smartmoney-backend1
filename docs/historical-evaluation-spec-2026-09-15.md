# Predeclared evaluation specification — not a trading-rule change

Declared September 15, 2026, before inspecting holdout outcomes.

- Training cutoff: August 14, 2026 00:00 UTC.
- Holdout: August 15 through September 14, 2026 (end September 15 00:00 UTC).
- Universe: contemporaneously Alpaca-tradable instruments; stock price floor $0.50.
- Stocks: one-hour horizon, 5% target, 2% invalidation.
- Crypto: four-hour horizon, 5% target, 2% invalidation.
- Early policy: contemporaneous setup flag before confirmed trigger, at most 3% above first observed price.
- Confirmed policy: existing contemporaneous trigger flag, including crypto breakout/retest.
- Minimum completed observations: 100 per asset/policy; smaller samples are insufficient.
- Baseline modeled fee and slippage: 0.10% each per side, with additional 0.25% and 0.50% slippage sensitivity runs. These are declared assumptions, not verified broker fee schedules.
- Entry at observed ask, exit at subsequent observed bid; no entry and exit using the same observation.
- Include rejected/failed setups, missing horizons and adverse outcomes, not just winners.

Required input is timestamped bid/ask plus setup/trigger evidence known at that
time. OHLC alone does not reconstruct these facts. No suitable dataset is present
locally, and this report does not claim the historical study has run. Obtaining
licensed historical data may require separate access or cost approval.

The current release does not alter strategy thresholds or entry requirements.
Any recommendation must report sample counts, data gaps and cost sensitivity;
this study cannot establish live profitability.
