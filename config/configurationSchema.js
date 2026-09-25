import { STOCK_EXECUTION_THRESHOLDS } from "../scoring/stockQualificationPolicy.js";
import { CRYPTO_MAX_ENTRY_SPREAD_PERCENT } from "../scoring/cryptoScoring.js";

// Canonical policy is not a user setting. Automation preference cannot rename Qualified.
export const CONFIGURATION_SCHEMA = Object.freeze({
  "policy.stocks.finalScore": {
    owner: "policy.stocks",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: STOCK_EXECUTION_THRESHOLDS.finalScore,
    purpose: "Canonical stock qualification line. Not editable from automation settings.",
    consumers: ["STOCK_EXECUTION_THRESHOLDS.finalScore"],
  },
  "policy.stocks.entryScore": {
    owner: "policy.stocks",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: STOCK_EXECUTION_THRESHOLDS.entryScore,
    purpose: "Canonical stock entry minimum.",
    consumers: ["STOCK_EXECUTION_THRESHOLDS.entryScore"],
  },
  "policy.stocks.maxQuotedSpreadPercent": {
    owner: "policy.stocks",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: STOCK_EXECUTION_THRESHOLDS.maxSpreadPercent,
    purpose: "Execution spread limit. Distinct from discovery mover spreads.",
    consumers: ["STOCK_EXECUTION_POLICY.maxQuotedSpreadPercent"],
  },
  "policy.crypto.maxQuotedSpreadPercent": {
    owner: "policy.crypto",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: CRYPTO_MAX_ENTRY_SPREAD_PERCENT,
    purpose: "Crypto execution quoted-spread limit.",
    consumers: ["CRYPTO_EXECUTION_POLICY.maxQuotedSpreadPercent"],
  },
  "discovery.stocks.regularMoverMaxSpread": {
    owner: "discovery.stocks",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: 2,
    purpose: "Broad regular-session discovery filter. Not an execution gate.",
    consumers: ["REGULAR_MOVER_DISCOVERY_MAX_SPREAD"],
  },
  "discovery.stocks.premarketMoverMaxSpread": {
    owner: "discovery.stocks",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: 3,
    purpose: "Premarket discovery filter. Not an execution gate.",
    consumers: ["PREMARKET_MOVER_DISCOVERY_MAX_SPREAD"],
  },
  "discovery.stocks.minScanVolume": {
    owner: "discovery.stocks",
    type: "number",
    minimum: 0,
    maximum: 1e12,
    default: 300000,
    purpose: "Discovery volume floor. Zero is a real floor, not a missing value.",
    consumers: ["CONFIG.minScanVolume"],
  },
  "automation.minimumPreference": {
    owner: "automation",
    type: "number",
    minimum: 0,
    maximum: 100,
    default: null,
    purpose: "Optional user selectivity for automation. Does not change Qualified or F70.",
    consumers: ["automation.minimumPreference"],
  },
  "automation.autoTradingEnabled": {
    owner: "automation",
    type: "boolean",
    default: false,
    purpose: "Whether automatic orders are allowed.",
    consumers: ["runtimeConfig.autoTradingEnabled"],
  },
  "infrastructure.apiBaseUrl": {
    owner: "infrastructure",
    type: "string",
    default: "https://smartmoney1.onrender.com",
    purpose: "Single client API origin.",
    consumers: ["API_BASE_URL"],
  },
  runnerWatchlistMinimumConfidence: {
    owner: "discovery.stocks",
    type: "number",
    default: 75,
    purpose: "Unused runner-watch confidence floor.",
    deprecated: true,
    consumers: [],
  },
  runnerHighAlertMinimumMove20Probability: {
    owner: "discovery.stocks",
    type: "number",
    default: 50,
    purpose: "Unused runner-alert probability floor.",
    deprecated: true,
    consumers: [],
  },
  targetCapitalSlots: {
    owner: "automation",
    type: "number",
    default: 15,
    purpose: "Unused capital-slot target.",
    deprecated: true,
    consumers: [],
  },
});

export function auditConfigurationConsumers(schema = CONFIGURATION_SCHEMA) {
  const unread = [];
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.deprecated === true || spec.reserved === true) continue;
    if (!Array.isArray(spec.consumers) || spec.consumers.length === 0) unread.push(key);
    for (const field of ["owner", "type", "default", "purpose"]) {
      if (spec[field] === undefined) unread.push(`${key}.${field}`);
    }
  }
  return { ok: unread.length === 0, unread };
}

export function applyAutomationPreference(preference, policy = STOCK_EXECUTION_THRESHOLDS) {
  return {
    finalScore: policy.finalScore,
    automationMinimumPreference: preference ?? null,
    changedCanonicalQualification: false,
  };
}

export function recordConfigRevision(previous = {}, next = {}, { now = new Date().toISOString(), revision = 1 } = {}) {
  const changes = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] !== next[key]) changes.push({ key, before: previous[key] ?? null, after: next[key] ?? null });
  }
  return { revision, at: now, changes };
}
