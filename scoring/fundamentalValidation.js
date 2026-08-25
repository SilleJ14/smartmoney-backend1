const DEFAULT_MAX_AGE_DAYS = 120;
const DEFAULT_MIN_FIELD_COVERAGE = 1;

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

function normalizeMetadataToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function validateFundamentalInputs(
  signal = {},
  {
    now = Date.now(),
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
    minFieldCoverage = DEFAULT_MIN_FIELD_COVERAGE,
  } = {}
) {
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
  const coverage = validFields.length / Object.keys(FIELD_RULES).length;
  if (coverage < minFieldCoverage) {
    errors.push({
      field: "fundamentals",
      code: "INSUFFICIENT_FIELD_COVERAGE",
      coverage: Number(coverage.toFixed(2)),
      minimumCoverage: minFieldCoverage,
    });
  }
  const provider = source.provider || source.source || signal.fundamentalsProvider || null;
  if (!provider) errors.push({ field: "provider", code: "MISSING_PROVENANCE" });
  const reportingPeriod = normalizeMetadataToken(
    source.reportingPeriod || source.fiscalPeriod || source.period
  );
  if (!["TTM", "LTM", "FY", "ANNUAL"].includes(reportingPeriod)) {
    errors.push({ field: "reportingPeriod", code: "MISSING_OR_UNSUPPORTED_REPORTING_PERIOD" });
  }
  const currency = normalizeMetadataToken(source.currency || source.currencyCode);
  if (currency !== "USD") {
    errors.push({ field: "currency", code: "FUNDAMENTAL_CURRENCY_MUST_BE_USD" });
  }
  const freeCashFlowUnit = normalizeMetadataToken(
    source.freeCashFlowUnit || source.units?.freeCashFlow || source.monetaryUnit
  );
  if (!["USD", "DOLLARS", "US_DOLLARS"].includes(freeCashFlowUnit)) {
    errors.push({ field: "freeCashFlowUnit", code: "FREE_CASH_FLOW_UNIT_MUST_BE_USD" });
  }
  const sharesUnit = normalizeMetadataToken(
    source.sharesUnit || source.units?.sharesOutstanding
  );
  if (!["SHARE", "SHARES"].includes(sharesUnit)) {
    errors.push({ field: "sharesUnit", code: "SHARES_UNIT_MUST_BE_SHARES" });
  }
  const sharesBasis = normalizeMetadataToken(
    source.sharesBasis || source.shareBasis
  );
  if (!["DILUTED", "OUTSTANDING", "SHARES_OUTSTANDING"].includes(sharesBasis)) {
    errors.push({ field: "sharesBasis", code: "MISSING_OR_UNSUPPORTED_SHARES_BASIS" });
  }
  const priceRaw =
    source.currentPrice ??
    source.marketPrice ??
    source.price ??
    signal.current ??
    signal.price;
  const currentPrice = Number(priceRaw);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    errors.push({ field: "currentPrice", code: "MISSING_OR_INVALID_MARKET_PRICE" });
  }
  const valid = errors.length === 0;
  return {
    valid,
    values,
    validFields,
    errors,
    provider,
    metadata: {
      reportingPeriod,
      currency,
      freeCashFlowUnit,
      sharesUnit,
      sharesBasis,
    },
    currentPrice: Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null,
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
    ageDays: ageDays === null ? null : Number(ageDays.toFixed(2)),
    coverage: Number(coverage.toFixed(2)),
    minimumCoverage: minFieldCoverage,
    maxAgeDays,
  };
}

export function scoreValidatedFundamentals(validation = {}, { clampScore = (value) => Math.max(0, Math.min(100, value)) } = {}) {
  if (!validation.valid) return { fundamentalScore: 50, dataUsable: false, reason: "FUNDAMENTALS_EXCLUDED_INVALID_INPUT", validation };
  const values = validation.values || {};
  const fcfPerShare = values.freeCashFlow / values.sharesOutstanding;
  const freeCashFlowYield = fcfPerShare / validation.currentPrice;
  const cashFlowYieldScore = clampScore(50 + freeCashFlowYield * 500);
  const scoredComponents = [
    { name: "cashFlowYieldScore", score: cashFlowYieldScore, weight: 0.4, available: true },
    { name: "growthScore", score: clampScore(50 + Number(values.revenueGrowth) * 100), weight: 0.25, available: values.revenueGrowth !== undefined },
    { name: "marginScore", score: clampScore(50 + Number(values.operatingMargin) * 80), weight: 0.2, available: values.operatingMargin !== undefined },
    { name: "balanceSheetScore", score: clampScore(80 - Number(values.debtToEquity) * 12), weight: 0.15, available: values.debtToEquity !== undefined },
  ];
  const availableWeight = scoredComponents
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.weight, 0);
  const fundamentalScore = clampScore(
    scoredComponents
      .filter((component) => component.available)
      .reduce((sum, component) => sum + component.score * component.weight, 0) /
      availableWeight
  );
  return {
    fundamentalScore,
    dataUsable: true,
    fcfPerShare,
    freeCashFlowYield,
    components: Object.fromEntries(
      scoredComponents.map((component) => [
        component.name,
        component.available ? component.score : null,
      ])
    ),
    componentTelemetry: scoredComponents,
    reason: "VALIDATED_FUNDAMENTAL_INPUTS",
    validation,
  };
}
