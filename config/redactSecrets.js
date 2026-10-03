// Broker credentials saved through the app live in runtimeConfig and are
// spread into CONFIG. Responses must never echo them: a leaked session, log or
// cached response would otherwise expose keys that keep working outside the app.
const SECRET_KEYS = new Set(["alpacalivekey", "alpacalivesecret", "oandaaccountid", "oandapracticetoken"]);
const SECRET_PATTERN = /(secret|token|password|apikey|api_key|privatekey)/i;

export function isSecretConfigKey(key) {
  const name = String(key || "");
  return SECRET_KEYS.has(name.toLowerCase()) || SECRET_PATTERN.test(name);
}

// Shallow copy with secret values replaced by a presence marker, so clients can
// still show "configured" without receiving the value.
export function redactSecrets(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const redacted = {};
  for (const [key, value] of Object.entries(config)) {
    redacted[key] = isSecretConfigKey(key) ? (value ? "[redacted]" : value) : value;
  }
  return redacted;
}
