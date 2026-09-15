// Explainable fallback for favorable business developments outside the named
// catalyst list. This is text evidence, not a price prediction or buy approval.
const domains = /\b(revenue|sales|earnings|profit(?:s|ability)?|margin[s]?|cash flow|demand|orders|backlog|customers|subscribers|production|capacity|exports|market share|costs|expenses|debt|interest payments|litigation|settlement|licen[sc]e|clearance|trial|study|results|dividend|buyback|repurchase|distribution|expansion|financing|funding|investment|commercialization|commercialisation)\b/i;
const improvements = /\b(record|accelerat\w*|surge\w*|grow\w*|grew|growth|ris\w*|rose|increas\w*|improv\w*|expand\w*|exceed\w*|outperform\w*|strong\w*|robust|successful|positive|favorable|favourable|secured|wins?|won|achiev\w*|resumes?|restores?)\b/i;
const reductions = /\b(reduc\w*|lower\w*|cut\w*|eliminat\w*|repays?|repaid)\b.{0,55}\b(costs|expenses|debt|interest payments)\b/i;
const distributions = /\b(announc\w*|authoriz\w*|approv\w*|increas\w*)\b.{0,55}\b(dividend|buyback|repurchase)\b/i;
const negatives = /\b(not|no|without|failed|fails|denied|rejected|cancelled|canceled|terminated|decline\w*|fell|decreas\w*|weak\w*|losses|misses|missed)\b/i;

export function positiveBusinessImpact(text = '') {
  for (const sentence of String(text).slice(0, 3000).split(/[.!?;\n]+/)) {
    if (negatives.test(sentence)) continue;
    if (reductions.test(sentence)) return { term: 'favorable_cost_or_balance_sheet_development', points: 10 };
    if (distributions.test(sentence)) return { term: 'favorable_shareholder_distribution', points: 10 };
    // Rising costs/debt alone are not favorable business growth.
    if (domains.test(sentence) && improvements.test(sentence) &&
        !/\b(costs|expenses|debt|interest payments)\b/i.test(sentence)) {
      return { term: 'favorable_business_development', points: 10 };
    }
  }
  return null;
}
