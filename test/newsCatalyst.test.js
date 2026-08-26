import test from "node:test";
import assert from "node:assert/strict";
import { calculateNewsCatalyst } from "../scoring/newsCatalyst.js";

test("fresh positive news creates catalyst evidence and duplicate headlines count once", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const article = {
    headline: "Company raises guidance after earnings beat",
    summary: "Revenue growth exceeded expectations",
    datetime: now / 1000 - 60,
    source: "company",
  };
  const result = calculateNewsCatalyst({
    articles: [article, { ...article, source: "syndicated" }],
    dataAvailable: true,
    now,
  });

  assert.equal(result.catalystAvailable, true);
  assert.ok(result.catalystScore >= 65);
  assert.equal(result.deduplicatedArticleCount, 1);
  assert.equal(result.riskDetected, false);
});

test("dangerous news stays a separate risk flag", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const result = calculateNewsCatalyst({
    articles: [{
      headline: "Company announces share offering and possible dilution",
      datetime: now / 1000 - 60,
    }],
    dataAvailable: true,
    now,
  });

  assert.equal(result.riskDetected, true);
  assert.ok(result.dangerHits.includes("offering"));
  assert.equal(result.label, "DANGEROUS_CATALYST");
});

test("missing or stale news cannot fabricate catalyst coverage", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const missing = calculateNewsCatalyst({ dataAvailable: false, now });
  const stale = calculateNewsCatalyst({
    articles: [{
      headline: "Company wins new contract",
      datetime: now / 1000 - 10 * 24 * 60 * 60,
    }],
    dataAvailable: true,
    now,
    maxAgeHours: 72,
  });

  assert.equal(missing.catalystAvailable, false);
  assert.equal(missing.catalystScore, 0);
  assert.equal(stale.catalystAvailable, false);
  assert.equal(stale.catalystScore, 0);
});

test("undated and negated headlines cannot be labeled fresh positive catalysts", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const undated = calculateNewsCatalyst({
    headlines: ["Company receives FDA approval"],
    dataAvailable: true,
    now,
  });
  const negated = calculateNewsCatalyst({
    articles: [{
      headline: "Company was not approved for the proposed launch",
      datetime: now / 1000 - 60,
    }],
    dataAvailable: true,
    now,
  });

  assert.equal(undated.catalystAvailable, false);
  assert.equal(undated.undatedArticleCount, 1);
  assert.equal(negated.positiveHits.includes("approved"), false);
});

test("ordinary product offerings are not treated as financing dilution", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const product = calculateNewsCatalyst({
    articles: [{
      headline: "Company expands its cloud product offering",
      datetime: now / 1000 - 60,
    }],
    dataAvailable: true,
    now,
  });
  const shares = calculateNewsCatalyst({
    articles: [{
      headline: "Company announces registered direct share offering",
      datetime: now / 1000 - 60,
    }],
    dataAvailable: true,
    now,
  });

  assert.equal(product.riskDetected, false);
  assert.equal(shares.riskDetected, true);
});

test("negated danger language does not create a false risk flag", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const result = calculateNewsCatalyst({
    articles: [{
      headline: "Company says no bankruptcy filing is planned",
      datetime: now / 1000 - 60,
    }],
    dataAvailable: true,
    now,
  });

  assert.equal(result.riskDetected, false);
  assert.equal(result.dangerHits.includes("bankruptcy"), false);
});

test("near-duplicate syndicated headlines count as one news event", () => {
  const now = Date.parse("2026-08-25T16:00:00Z");
  const result = calculateNewsCatalyst({
    articles: [
      {
        headline: "Company wins major federal cloud contract after review",
        datetime: now / 1000 - 60,
      },
      {
        headline: "After review company wins a major federal cloud contract",
        datetime: now / 1000 - 120,
      },
    ],
    dataAvailable: true,
    now,
  });

  assert.equal(result.deduplicatedArticleCount, 1);
});
