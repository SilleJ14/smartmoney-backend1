function numericTimestampToMilliseconds(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  // Provider feeds use seconds, milliseconds, microseconds, or nanoseconds.
  if (timestamp < 1e11) return timestamp * 1000;
  if (timestamp < 1e14) return timestamp;
  if (timestamp < 1e17) return timestamp / 1000;
  return timestamp / 1e6;
}

export function parseProviderTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const milliseconds = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))
    ? numericTimestampToMilliseconds(value)
    : Date.parse(String(value));
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function getPolygonProviderTimestamp(message = {}) {
  const eventType = String(message.ev || "").toUpperCase();
  if (eventType === "A" || eventType === "AM" || eventType === "XA") {
    return parseProviderTimestamp(message.e ?? message.end ?? message.s ?? message.start);
  }
  return parseProviderTimestamp(message.t ?? message.timestamp ?? message.time);
}

export function isUsableProviderTimestamp(value, {
  now = Date.now(),
  maxFutureSeconds = 5,
} = {}) {
  const iso = parseProviderTimestamp(value);
  if (!iso) return false;
  return Date.parse(iso) <= Number(now) + Number(maxFutureSeconds) * 1000;
}
