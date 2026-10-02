import { createHash } from "node:crypto";

export const EVIDENCE_SNAPSHOT_VERSION = 1;
const STATES = new Set(["FRESH", "STALE", "MISSING", "MALFORMED", "UNAVAILABLE"]);

function canonical(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(canonical(value));
}

export function evidenceHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function normalizeProviderRecord(record, name) {
  if (!record || typeof record !== "object") throw new Error(`EVIDENCE_SCHEMA_INVALID:${name}`);
  const state = String(record.state || "");
  if (!STATES.has(state)) throw new Error(`EVIDENCE_STATE_INVALID:${name}`);
  const observations = Array.isArray(record.observations) ? record.observations.map(canonical) : [];
  const provider = record.provenance?.provider;
  const observedAt = record.provenance?.observedAt;
  if (!provider || !Number.isFinite(Date.parse(observedAt || ""))) throw new Error(`EVIDENCE_PROVENANCE_INVALID:${name}`);
  return canonical({
    state,
    ageMs: record.ageMs ?? null,
    observations,
    provenance: {
      provider: String(provider),
      sourceUrl: record.provenance.sourceUrl ?? null,
      observedAt,
      publishedAt: record.provenance.publishedAt ?? null,
      vintageAt: record.provenance.vintageAt ?? null,
    },
    error: record.error ?? null,
  });
}

export function createEvidenceSnapshot({
  capturedAt = new Date().toISOString(),
  instrument = null,
  decisionTime = capturedAt,
  providers = {},
  market = {},
  context = {},
} = {}) {
  if (!Number.isFinite(Date.parse(capturedAt)) || !Number.isFinite(Date.parse(decisionTime))) {
    throw new Error("EVIDENCE_TIMESTAMP_INVALID");
  }
  const normalizedProviders = Object.fromEntries(
    Object.keys(providers).sort().map((name) => [name, normalizeProviderRecord(providers[name], name)])
  );
  const states = Object.values(normalizedProviders).map((record) => record.state);
  const qualityState = states.length === 0 ? "MISSING"
    : states.every((state) => state === "FRESH") ? "FRESH"
      : states.includes("MALFORMED") ? "MALFORMED"
        : states.includes("UNAVAILABLE") ? "UNAVAILABLE"
          : states.includes("MISSING") ? "MISSING" : "STALE";
  const body = canonical({
    version: EVIDENCE_SNAPSHOT_VERSION,
    capturedAt,
    decisionTime,
    instrument,
    qualityState,
    providers: normalizedProviders,
    market,
    context,
  });
  return deepFreeze({ ...body, hash: evidenceHash(body) });
}

export function verifyEvidenceSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== EVIDENCE_SNAPSHOT_VERSION || typeof snapshot.hash !== "string") return false;
  const { hash, ...body } = snapshot;
  return hash === evidenceHash(body);
}
