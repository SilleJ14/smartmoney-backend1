const DEFAULT_MAX_AGE_DAYS = 120;

const FIELD_RULES = Object.freeze({
  freeCashFlow: { aliases: ["freeCashFlow", "free_cash_flow", "fcf"], min: -1e13, max: 1e13 },
  sharesOutstanding: { aliases: ["sharesOutstanding", "shares_outstanding"], min: 1, max: 1e13 },
  revenueGrowth: { aliases: ["revenueGrowth", "revenue_growth"], min: -1, max: 10 },
  operatingMargin: { aliases: ["operatingMargin", "operating_margin"], min: -5, max: 1 },
  debtToEquity: { aliases: ["debtToEquity", "debt_to_equity"], min: 0, max: 100 },
});

function readField(source, aliases) {
  for (const key of aliases) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  }
  return undefined;
}

export function validateFundamentalInputs(signal = {}, { now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const source = signal.fundamentals && typeof signal.fundamentals === "object" ? signal.fundamentals : signal;
  const values = {};
  const errors = [];
  const validFields = [];
  for (const [name, rule] of Object.entries(FIELD_RULES)) {
    const raw = readField(source, rule.aliases);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < rule.min || value > rule.max) {
      errors.push({ field: name, code: "OUT_OF_RANGE_OR_NON_NUMERIC", value: raw });
      continue;
    }
    values[name] = value;
    validFields.push(name);
  }
  const asOfRaw = source.asOf || source.updatedAt || source.fetchedAt || signal.fundamentalsUpdatedAt;
  const asOfMs = asOfRaw ? Date.parse(asOfRaw) : NaN;
  const ageDays = Number.isFinite(asOfMs) ? (now - asOfMs) / 86400000 : null;
  if (!asOfRaw || !Number.isFinite(asOfMs)) errors.push({ field: "asOf", code: "MISSING_OR_INVALID_TIMESTAMP" });
  else if (ageDays < -1 || ageDays > maxAgeDays) errors.push({ field: "asOf", code: ageDays < -1 ? "FUTURE_TIMESTAMP" : "STALE_DATA", ageDays: Number(ageDays.toFixed(2)) });
  const required = ["freeCashFlow", "sharesOutstanding"];
  for (const field of required) if (!validFields.includes(field)) errors.push({ field, code: "REQUIRED_FIELD_MISSING" });
  const provider = source.provider || source.source || signal.fundamentalsProvider || null;
  if (!provider) errors.push({ field: "provider", code: "MISSING_PROVENANCE" });
  const valid = errors.length === 0;
  return {
    valid,
    values,
    validFields,
    errors,
    provider,
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
    ageDays: ageDays === null ? null : Number(ageDays.toFixed(2)),
    coverage: Number((validFields.length / Object.keys(FIELD_RULES).length).toFixed(2)),
    maxAgeDays,
  };
}

export function scoreValidatedFundamentals(validation = {}, { clampScore = (value) => Math.max(0, Math.min(100, value)) } = {}) {
  if (!validation.valid) return { fundamentalScore: 50, dataUsable: false, reason: "FUNDAMENTALS_EXCLUDED_INVALID_INPUT", validation };
  const values = validation.values || {};
  const fcfPerShare = values.freeCashFlow / values.sharesOutstanding;
  const cashFlowYieldScore = clampScore(50 + Math.max(-25, Math.min(35, fcfPerShare * 8)));
  const growthScore = clampScore(50 + Number(values.revenueGrowth || 0) * 100);
  const marginScore = clampScore(50 + Number(values.operatingMargin || 0) * 80);
  const balanceSheetScore = clampScore(80 - Number(values.debtToEquity || 0) * 12);
  const fundamentalScore = clampScore(cashFlowYieldScore * 0.4 + growthScore * 0.25 + marginScore * 0.2 + balanceSheetScore * 0.15);
  return {
    fundamentalScore,
    dataUsable: true,
    fcfPerShare,
    components: { cashFlowYieldScore, growthScore, marginScore, balanceSheetScore },
    reason: "VALIDATED_FUNDAMENTAL_INPUTS",
    validation,
  };
}
