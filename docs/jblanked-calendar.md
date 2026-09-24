# JBlanked calendar adapter

Set `JBLANKED_API_KEY` in the backend Render environment only. Never use an
`EXPO_PUBLIC_` variable. When no explicit calendar provider or file is configured,
the key selects JBlanked. An existing `FOREX_CALENDAR_PROVIDER=finnhub` overrides
this; set it to `jblanked` to explicitly select the new adapter.

The unfiltered Forex Factory weekly endpoint is used for all eight supported
currencies. Event times are interpreted as GMT+3 per the provider FAQ. Tentative,
malformed, empty and oversized responses are rejected. Coverage is limited to the
current trading week, using conservative EST/EDT boundary intersections.

The free allowance is treated as one request per rolling 24 hours. Failed requests
also consume that allowance. The existing durable forex ledger must be available;
the request reservation is committed before network access. A restart reuses the
cache and quota. This assumes the existing single-writer deployment; independent
replicas must not use separate ledgers for the same key. Other consumers of the
same API key can still exhaust the account allowance.

IMPORTANT: the existing 15-minute calendar freshness rule is UNCHANGED. A daily
snapshot therefore cannot provide continuous execution readiness under that rule.
Reading cached data never refreshes its timestamp. The app decision details show
this limitation, last fetch, next request and sanitized failure codes. Using a
daily schedule for longer requires a separately approved news-safety policy, not
quietly relabeling stale data as live.

No order controls, strategy thresholds, autopilot switches or account risk limits
are changed by this adapter. Live authentication and Render disk persistence still
require deployment verification. Tests use mocked responses and no real orders.

References:
- https://www.jblanked.com/news/api/docs/calendar/
- https://www.jblanked.com/news/api/docs/faqs/
- https://www.jblanked.com/news/api/docs/changelog/
