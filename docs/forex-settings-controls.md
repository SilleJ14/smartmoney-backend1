# Forex settings controls

The settings row shows the saved forex Autotrade ON/OFF value. Opening it shows
emergency-stop ACTIVE/READY, daily-loss reset, an editable Autotrade toggle and
Save. Pair listings and execution/operating diagnostic rows are removed from
this settings panel only; trading gates remain unchanged.

`POST /forex-settings` is admin-authenticated. Toggle and confirmed release/reset
changes apply on Save. Emergency-stop engagement remains immediate. Failed
saves retain the draft and show an error, not a success message.

Runtime config stores forex controls. Daily-loss lock disables and persists
Autotrade OFF; restart/environment defaults cannot re-enable it. Reset rebases
only forex daily equity from a fresh OANDA account response and keeps unrelated
incident locks, peak-equity/drawdown protections, intents and exposure intact.
It first persists OFF; ledger/config partial failure cannot enable entries.
Concurrent forex control changes abort re-enabling after a reset.

No actual trading controls were changed during implementation. Tests use mocks
and temporary local storage. Local reload persistence is verified, not Render
disk survival across instance replacements. The existing deployment must use
persistent storage for configuration and the forex ledger.
