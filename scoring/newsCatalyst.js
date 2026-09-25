import { positiveBusinessImpact } from './positiveBusinessImpact.js';
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
  if (['merger', 'acquisition', 'buyout'].includes(term) &&
      /\b(terminated|termination|cancelled|canceled|called off)\b/.test(normalized)) return false;
  const negated = [
    `not ${term}`,
    `no ${term}`,
    `${term} denied`,
    `${term} rejected`,
    `${term} fails`,
    `${term} failed`,
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
  coverageMode = "SYMBOL_SCOPED",
  coverageReason = null,
  sources = [],
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
    // No double award for wording describing the same named catalyst.
    const broaderImpact = positiveBusinessImpact(`${article.headline}. ${article.summary}`);
    if (positiveHits.length === 0 && broaderImpact) positiveHits.push(broaderImpact);
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
  const riskDetected = Boolean(dataAvailable) && dangerPoints >= 14;
  const catalystScore = catalystAvailable
    ? clamp(50 + Math.min(45, positivePoints) - Math.min(50, dangerPoints))
    : 0;
  const assessment = {
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
    // Retain the actual publication window used by this assessment. Never use
    // the assessment/receipt clock as a substitute for article publication.
    publicationWindow: {
      oldestAt: relevantEvidence.length ? new Date(Math.min(...relevantEvidence.map(item => item.datetime))).toISOString() : null,
      newestAt: relevantEvidence.length ? new Date(Math.max(...relevantEvidence.map(item => item.datetime))).toISOString() : null,
    },
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
  // Problem #42: coverage is separate from what the headlines said.
  // A zero catalyst score is not a status.
  assessment.newsEvidence = buildNewsEvidence(assessment, {
    coverageMode,
    coverageReason,
    sources,
    unusableArticles: assessment.undatedArticleCount,
    now,
    windowHours: maxAgeHours,
  });
  return assessment;
}

function buildNewsEvidence(assessment, {
  coverageMode = "SYMBOL_SCOPED",
  coverageReason = null,
  sources = [],
  unusableArticles = 0,
  now = Date.now(),
  windowHours = 72,
} = {}) {
  const checkedAt = new Date(now).toISOString();
  const unknown = {
    providerState: assessment.dataAvailable ? "AVAILABLE" : "UNAVAILABLE",
    coverageState: assessment.dataAvailable ? "UNKNOWN" : "UNKNOWN",
    coverageReason: assessment.dataAvailable ? coverageReason : "PROVIDER_UNAVAILABLE",
    catalystState: "UNKNOWN",
    catalystScore: null,
    adverseState: "UNKNOWN",
    adverseScore: null,
    adverseSummary: null,
    articlesRead: assessment.articleCount,
    relevantArticles: assessment.relevantArticleCount,
    unusableArticles,
    windowHours,
    oldestCheckedAt: assessment.publicationWindow?.oldestAt || null,
    newestCheckedAt: assessment.publicationWindow?.newestAt || null,
    checkedAt,
    sources,
  };
  if (!assessment.dataAvailable) {
    return { ...unknown, providerState: "UNAVAILABLE", coverageState: "UNKNOWN", coverageReason: "PROVIDER_UNAVAILABLE" };
  }
  if (coverageMode === "NOT_COVERED") {
    return {
      ...unknown,
      providerState: "AVAILABLE",
      coverageState: "NOT_COVERED",
      coverageReason: coverageReason || "NO_SYMBOL_TAG",
    };
  }
  if (assessment.recentArticleCount === 0 && unusableArticles > 0) {
    return {
      ...unknown,
      providerState: "AVAILABLE",
      coverageState: "PARTIAL",
      coverageReason: "ARTICLE_TIMESTAMP_MISSING",
    };
  }
  const adverseState = assessment.riskDetected ? "NEGATIVE" : "NONE_FOUND";
  const catalystState = !assessment.catalystAvailable
    ? "NONE_FOUND"
    : assessment.catalystScore >= 82
      ? "MAJOR_POSITIVE"
      : assessment.positivePoints > 0
        ? "POSITIVE"
        : "NONE_FOUND";
  const partial = unusableArticles > 0;
  const measured = adverseState === "NEGATIVE" || catalystState === "POSITIVE" || catalystState === "MAJOR_POSITIVE";
  return {
    providerState: "AVAILABLE",
    coverageState: partial ? "PARTIAL" : "COVERED",
    coverageReason: partial
      ? "ARTICLE_TIMESTAMP_MISSING"
      : (coverageReason || (coverageMode === "SYMBOL_TAGGED" ? "SYMBOL_TAGGED_BY_PROVIDER" : "SYMBOL_SCOPED_PROVIDER_RESULT")),
    catalystState: partial && !measured ? "UNKNOWN" : catalystState,
    catalystScore: partial && !measured ? null : assessment.catalystScore,
    adverseState: partial && !measured ? "UNKNOWN" : adverseState,
    adverseScore: partial && !measured ? null : assessment.dangerPoints,
    adverseSummary: adverseState === "NONE_FOUND" && !(partial && !measured)
      ? "No adverse news found in monitored sources/window."
      : adverseState === "NEGATIVE"
        ? "Measured adverse news in monitored sources/window."
        : null,
    articlesRead: assessment.articleCount,
    relevantArticles: assessment.relevantArticleCount,
    unusableArticles,
    windowHours,
    oldestCheckedAt: assessment.publicationWindow?.oldestAt || null,
    newestCheckedAt: assessment.publicationWindow?.newestAt || null,
    checkedAt,
    sources,
  };
}
