const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const POSITIVE_TERMS = Object.freeze({
  "earnings beat": 14,
  "raises guidance": 18,
  "revenue growth": 10,
  "new contract": 14,
  "contract awarded": 16,
  partnership: 10,
  "fda approval": 24,
  acquisition: 14,
  buyout: 24,
  merger: 12,
  patent: 10,
  "analyst upgrade": 10,
  "protocol upgrade": 12,
  "exchange listing": 18,
  approved: 8,
  launch: 7,
});

const DANGER_TERMS = Object.freeze({
  offering: 24,
  dilution: 24,
  bankruptcy: 35,
  delisting: 30,
  investigation: 18,
  lawsuit: 14,
  downgrade: 10,
  "reverse split": 24,
  "weak guidance": 20,
  exploit: 30,
  hacked: 35,
  hack: 30,
  "token unlock": 16,
  halted: 22,
  fraud: 35,
});

function normalizeHeadline(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text, phrase) {
  const haystack = ` ${normalizeHeadline(text)} `;
  const needle = ` ${normalizeHeadline(phrase)} `;
  return haystack.includes(needle);
}

function positiveTermApplies(text, term) {
  if (!containsPhrase(text, term)) return false;
  const normalized = normalizeHeadline(text);
  const negated = [
    `not ${term}`,
    `no ${term}`,
    `${term} denied`,
    `${term} rejected`,
    `${term} fails`,
    `without ${term}`,
  ].some((phrase) => containsPhrase(normalized, phrase));
  return !negated;
}

function dangerTermApplies(text, term) {
  if (!containsPhrase(text, term)) return false;
  const negated = [
    `not ${term}`,
    `no ${term}`,
    `without ${term}`,
    `avoids ${term}`,
    `denies ${term}`,
    `${term} denied`,
    `${term} dismissed`,
    `${term} rejected`,
  ].some((phrase) => containsPhrase(text, phrase));
  if (negated) return false;
  if (term !== "offering") return true;
  // "Offering" alone often describes a product or service. Only financing
  // contexts are dilution risk.
  return [
    "stock offering",
    "share offering",
    "equity offering",
    "public offering",
    "secondary offering",
    "registered direct offering",
    "securities offering",
    "token offering",
  ].some((phrase) => containsPhrase(text, phrase));
}

function headlineTokens(value = "") {
  const ignored = new Set([
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
    "the", "to", "with", "after", "amid", "says", "report", "reports",
  ]);
  return new Set(normalizeHeadline(value).split(" ").filter(
    (token) => token.length > 2 && !ignored.has(token)
  ));
}

function headlinesAreNearDuplicates(left = "", right = "") {
  const leftTokens = headlineTokens(left);
  const rightTokens = headlineTokens(right);
  if (leftTokens.size < 4 || rightTokens.size < 4) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && overlap / union >= 0.8;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? numeric < 10_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function articleFrom(value, index = 0) {
  if (typeof value === "string") {
    return { headline: value, summary: "", source: "unknown", datetime: null, id: `headline-${index}` };
  }
  return {
    headline: String(value?.headline || value?.title || ""),
    summary: String(value?.summary || value?.description || ""),
    source: String(value?.source || "unknown"),
    datetime: normalizeTimestamp(value?.datetime ?? value?.publishedAt ?? value?.timestamp),
    id: String(value?.id || value?.url || `article-${index}`),
    url: value?.url || null,
    related: value?.related || null,
  };
}

export function calculateNewsCatalyst({
  articles = [],
  headlines = [],
  dataAvailable = false,
  now = Date.now(),
  maxAgeHours = 72,
  source = "news_provider",
} = {}) {
  const raw = [
    ...(Array.isArray(articles) ? articles : []),
    ...(Array.isArray(headlines) ? headlines : []),
  ].map(articleFrom).filter((article) => article.headline);
  const deduplicated = [];
  const seen = new Set();
  for (const article of raw) {
    const key = normalizeHeadline(article.headline);
    if (
      !key ||
      seen.has(key) ||
      deduplicated.some((existing) => (
        headlinesAreNearDuplicates(existing.headline, article.headline)
      ))
    ) continue;
    seen.add(key);
    deduplicated.push(article);
  }
  const recent = deduplicated.filter((article) => {
    // A catalyst cannot be called fresh without a publication time.
    if (article.datetime === null) return false;
    const ageHours = (Number(now) - article.datetime) / (60 * 60 * 1000);
    return ageHours >= -1 && ageHours <= maxAgeHours;
  });
  const evidence = recent.map((article) => {
    const text = normalizeHeadline(`${article.headline} ${article.summary}`);
    const positiveHits = Object.entries(POSITIVE_TERMS)
      .filter(([term]) => positiveTermApplies(text, term))
      .map(([term, points]) => ({ term, points }));
    const dangerHits = Object.entries(DANGER_TERMS)
      .filter(([term]) => dangerTermApplies(text, term))
      .map(([term, points]) => ({ term, points }));
    const ageHours = article.datetime === null
      ? null
      : Math.max(0, (Number(now) - article.datetime) / (60 * 60 * 1000));
    const freshnessMultiplier = ageHours === null
      ? 0.65
      : ageHours <= 6
        ? 1
        : ageHours <= 24
          ? 0.85
          : 0.6;
    return { ...article, positiveHits, dangerHits, ageHours, freshnessMultiplier };
  });
  const positivePoints = evidence.reduce(
    (sum, item) => sum + item.positiveHits.reduce(
      (subtotal, hit) => subtotal + hit.points * item.freshnessMultiplier,
      0
    ),
    0
  );
  const dangerPoints = evidence.reduce(
    (sum, item) => sum + item.dangerHits.reduce(
      (subtotal, hit) => subtotal + hit.points * item.freshnessMultiplier,
      0
    ),
    0
  );
  const relevantEvidence = evidence.filter(
    (item) => item.positiveHits.length > 0 || item.dangerHits.length > 0
  );
  const catalystAvailable = Boolean(dataAvailable) && relevantEvidence.length > 0;
  const riskDetected = dangerPoints >= 14;
  const catalystScore = catalystAvailable
    ? clamp(50 + Math.min(45, positivePoints) - Math.min(50, dangerPoints))
    : 0;
  return {
    source,
    dataAvailable: Boolean(dataAvailable),
    catalystAvailable,
    catalystScore: Number(catalystScore.toFixed(2)),
    riskDetected,
    positivePoints: Number(positivePoints.toFixed(2)),
    dangerPoints: Number(dangerPoints.toFixed(2)),
    articleCount: raw.length,
    deduplicatedArticleCount: deduplicated.length,
    recentArticleCount: recent.length,
    undatedArticleCount: deduplicated.filter((article) => article.datetime === null).length,
    relevantArticleCount: relevantEvidence.length,
    newestAgeHours: evidence.length > 0
      ? Math.min(...evidence.map((item) => item.ageHours ?? maxAgeHours))
      : null,
    positiveHits: [...new Set(
      evidence.flatMap((item) => item.positiveHits.map((hit) => hit.term))
    )],
    dangerHits: [...new Set(
      evidence.flatMap((item) => item.dangerHits.map((hit) => hit.term))
    )],
    headlines: recent.slice(0, 8).map((item) => item.headline),
    label: riskDetected
      ? "DANGEROUS_CATALYST"
      : catalystScore >= 82
        ? "MAJOR_FRESH_CATALYST"
        : catalystScore >= 65
          ? "POSITIVE_FRESH_CATALYST"
          : catalystAvailable
            ? "MIXED_CATALYST"
            : dataAvailable
              ? "NO_RELEVANT_FRESH_CATALYST"
              : "NEWS_DATA_UNAVAILABLE",
  };
}
