# Stock/crypto baseline (do not change in this forex release)

Captured 2026-09-22.

| Item | Value |
| --- | --- |
| App commit | `8694aad` |
| Backend commit | `1510d64` |
| Stock F floor (app `MIN_SCORE_TO_BUY_FLOOR`) | **78** |
| Stock F sanitize floor (`runtimePolicy` / `CONFIG.minScoreToBuy`) | **70** (unchanged this release) |
| Stock E | **75** (`entryQualityScore`) |
| Crypto F | **65** (`CRYPTO_MIN_FINAL_SCORE_TO_BUY`) |
| Auto quote/spread | **5s**, stock spread **1%**, crypto spread **0.85%** |
| Authorization | Scores do not authorize. `schemaVersion: 1` canonical decision + 5s quote/spread + sizing. |
| Autopilot | Alpaca `autoTradingEnabled` only. Forex Autopilot is a separate flag. |

Fixed-input regression: `test/requestedCandidatePipelineRegression.test.js` plus existing crypto/stock suites. This release must not change stock/crypto decision outputs.

Forex display filters and Portfolio desk toggles must not change Autopilot, F/E, or Alpaca cash.
