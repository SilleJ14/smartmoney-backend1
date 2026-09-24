# Balanced entry policy

Policy `fx-v1.1-balanced-entry` extends the completed-candle entry window from
60 seconds to 180 seconds. This is a small, explicit policy change for the OANDA
practice account, not a claim of improved returns or current eligible pairs.

Both scanning and order preflight use `entryExpired` with the same policy.
Malformed, missing, and future confirmation timestamps expire closed.
The existing 0.10 ATR chase limit still applies during the entire window.

Unchanged: H4/H1/M15 setup, completed candles, fresh executable quotes, spread
and reward/risk checks, calendar and session restrictions, stop protection,
margin, daily-loss and emergency locks, duplicate-order handling and 10% cap.
Stock/crypto policy and Autopilot state are not changed. No deployment or
Autopilot activation is implied by this local implementation.
