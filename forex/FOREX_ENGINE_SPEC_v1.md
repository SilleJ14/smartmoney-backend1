# Forex engine spec fx-v1

Frozen 2026-09-22. Change this file and `FOREX_SPEC` together. Do not share Autopilot, F/E, or Alpaca cash.

## Arming

- **Forex Autopilot** is the only start flag: Settings toggle → `POST /forex-auto/on|off` → `forexAutoEnabled`.
- Stock/crypto **Autopilot** (`autoTradingEnabled`) never starts or stops this engine.
- OANDA practice only (`api-fxpractice.oanda.com`). Live host is halt `LIVE_BLOCKED`.
- `liveOrdersAuthorized = false`. Practice orders only when Forex Autopilot is ON, halt is CLEAR, quote age ≤ 5s, and `priceBound` + `stopLossOnFill` are on the order and present after read-back.

## Early breakout (M15)

| Rule | Frozen definition |
| --- | --- |
| Tight range | Last 20 **completed** M15 candles; high−low ≤ 0.80 × ATR(20). Geometry uses OANDA mid. |
| Breakout | Next completed candle **closes** beyond that locked high/low by ≥ 0.15 × ATR. Wicks do not count. |
| Successful retest | Within 8 candles; retrace ≤ 50% of the breakout distance; no close back through the bound; confirm as a close 0.05 × ATR beyond the bound. |
| Entry expires | 12 candles after breakout, or mid more than 0.25 × ATR from the planned entry (the bound). |
| Setup fails | A completed close back through the breakout bound into the range. |

## Continuation (M15)

| Rule | Frozen definition |
| --- | --- |
| Impulse | Last 20 completed M15 candles; swing high−low > 0. |
| Pullback | Retrace 38.2%–61.8% of that impulse. |
| Resume | Close resumes in the impulse direction by 0.10 × ATR without exceeding 61.8%. |
| Entry expires | 10 candles after the pullback qualifies. |
| Setup fails | Retrace ≥ 78.6% of the impulse. |

## After-cost evidence

Each system is approved separately. Combined P&amp;L cannot hide a losing system.

- Minimum 200 trades per system on locked samples.
- Mean R after spread × 1.5, commission, 0.2 pip extra slippage, and financing if held past 17:00 New York.
- Floor: after-cost mean R ≥ 0.15. Below that the system stays in testing.
- Record every version tested in `ledger.versions`. Live authorization stays false until both systems clear this gate.

## Ops halt (block new entries)

Uncertain order status, missing stop after fill, quote age > 5s, missing credentials, or unexplained NAV vs last account snapshot → halt and reconcile. The app must read back the OANDA order and trade, not assume the request succeeded.

Risk per practice trade: 0.25% of NAV. Stop = 1.0 × ATR from entry.
