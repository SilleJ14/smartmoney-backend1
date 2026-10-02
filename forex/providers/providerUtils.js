export const PROVIDER_STATE = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  MISSING: "MISSING",
  MALFORMED: "MALFORMED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function provenance({ provider, sourceUrl, observedAt, publishedAt = null, vintageAt = null }) {
  return Object.freeze({ provider, sourceUrl, observedAt, publishedAt, vintageAt });
}

export function freshness(timestamp, { now = Date.now(), maxAgeMs }) {
  const time = Date.parse(timestamp || "");
  if (!Number.isFinite(time)) return { state: PROVIDER_STATE.MISSING, ageMs: null };
  const ageMs = Math.max(0, now - time);
  return { state: ageMs <= maxAgeMs ? PROVIDER_STATE.FRESH : PROVIDER_STATE.STALE, ageMs };
}

export async function boundedFetch(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  maxBytes = 2 * 1024 * 1024,
  headers,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("PROVIDER_FETCH_UNAVAILABLE");
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error("PROVIDER_TIMEOUT"));
      reject(new Error("PROVIDER_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, { headers, signal: controller.signal })),
      timeout,
    ]);
    if (!response?.ok) throw Object.assign(new Error(`PROVIDER_HTTP_${response?.status || 0}`), { status: response?.status });
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
    return { text, sourceUrl: String(response.url || url) };
  } finally {
    clearTimeout(timer);
  }
}

export async function boundedJson(url, options) {
  const result = await boundedFetch(url, options);
  try { return { ...result, data: JSON.parse(result.text) }; }
  catch { throw new Error("PROVIDER_MALFORMED_JSON"); }
}

export function finiteOrNull(value) {
  if (value === null || value === undefined || value === "" || value === ".") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function providerFailure(error, provider, observedAt = new Date().toISOString()) {
  const malformed = /MALFORMED|SCHEMA/.test(String(error?.message));
  return Object.freeze({
    state: malformed ? PROVIDER_STATE.MALFORMED : PROVIDER_STATE.UNAVAILABLE,
    observations: [],
    provenance: provenance({ provider, sourceUrl: null, observedAt }),
    error: String(error?.message || error),
  });
}
