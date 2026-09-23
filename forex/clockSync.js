export function clockHealth({ now = Date.now(), providerTimestamp, maxSkewSeconds = 5 } = {}) {
  const providerAt = Date.parse(providerTimestamp || "");
  if (!Number.isFinite(providerAt)) {
    return { ok: false, reason: "QUOTE_STALE", skewSeconds: null };
  }
  const skewSeconds = (now - providerAt) / 1000;
  if (Math.abs(skewSeconds) > maxSkewSeconds && skewSeconds < 0) {
    return { ok: false, reason: "CLOCK_SKEW", skewSeconds };
  }
  return { ok: true, skewSeconds };
}
