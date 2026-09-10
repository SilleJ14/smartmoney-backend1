# Email-based owner recovery

Use the existing app's **Forgot password → Send recovery code** action. A successfully accepted email contains an eight-digit, one-use code valid for ten minutes. Enter it in the app with a new password of at least twelve characters. Neither a Render Shell command nor an administrator token is needed for this flow.

## One-time operator configuration in Render Environment

- `RESEND_API_KEY`: the server-only Resend credential. Never put it in the app or Git.
- `RECOVERY_OWNER_EMAIL`: the operator's trusted recovery email. This is mandatory for restoring ownership when the account file is missing. It is not inferred from an unauthenticated request.
- `RECOVERY_EMAIL_FROM`: optional verified sender, such as `SmartMoney <security@your-verified-domain>`. The default `SmartMoney <onboarding@resend.dev>` is only suitable for the recipient permitted by the Resend testing sender.

Save the environment and deploy. Public `/health` includes only `recovery.emailConfigured` and `recovery.ownerRecoveryConfigured` booleans, never the address or secrets. These flags confirm configuration presence, not successful email delivery.

When an existing account is present, only that account can recover. When no account is present, only the configured recovery address can receive an owner-restoration code. No account is created until the emailed code is verified. Restoring login does not enable trading, clear safety locks, or restore lost trading history/settings.

## Persistent storage is still required

Attach a persistent disk and point `DATA_DIR` at its mount path (for example `/var/data`). Migrate surviving account and runtime/safety data before changing the path. Setting an environment variable alone does not create a disk. Keep `ADMIN_API_TOKEN` stable unless intentionally rotating sessions.

Email recovery is a fallback for account loss, not a substitute for durable storage. Without durable storage, replacement deployments can still lose the account and require recovery again. Pending recovery codes are held in memory and expire on server restart; request a new code after a restart.

## Failure behavior

- Missing mail configuration or owner-restoration configuration returns an actionable error.
- Provider failure or an invalid/oversized acknowledgment does not activate a new code and returns an error. An existing code remains valid until expiry or successful use.
- Delivery acceptance is not inbox delivery confirmation: check spam and the provider's delivery status if no message arrives.
- Three recovery requests per hour per email/IP; a rate-limit response includes the retry delay. Five invalid code attempts disable that code.
- Password persistence must succeed before the new credentials are activated or the code is consumed.

Do not log codes, password hashes, tokens, or mail-provider credentials.
