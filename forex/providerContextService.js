import {
  createCftcTffProvider,
  createCmeDelayedProvider,
  createFinnhubMacroProvider,
  createFredProvider,
} from "./providers/index.js";

const DEFAULT_RATE_SERIES = Object.freeze({
  USD: "DFF",
  EUR: "ECBDFR",
  GBP: "IUDERB6",
  JPY: "IRSTCB01JPM156N",
  CHF: "IRSTCI01CHM156N",
  CAD: "IRSTCB01CAM156N",
  AUD: "IRSTCB01AUM156N",
  NZD: "IRSTCI01NZM156N",
});

const CFTC_MARKETS = Object.freeze({
  EUR: "EURO FX",
  JPY: "JAPANESE YEN",
  GBP: "BRITISH POUND",
  AUD: "AUSTRALIAN DOLLAR",
  CAD: "CANADIAN DOLLAR",
  CHF: "SWISS FRANC",
  NZD: "NEW ZEALAND DOLLAR",
  USD: "U.S. DOLLAR INDEX",
});

const unavailable = (provider, now, error = "PROVIDER_NOT_REFRESHED") => Object.freeze({
  state: "UNAVAILABLE",
  ageMs: null,
  observations: Object.freeze([]),
  provenance: Object.freeze({
    provider,
    sourceUrl: null,
    observedAt: new Date(now()).toISOString(),
    publishedAt: null,
    vintageAt: null,
  }),
  error,
});

function dateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseJsonMap(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function combinedFred(results, now) {
  const records = Object.values(results);
  const observations = records.flatMap(record => record.observations || []);
  const order = ["MALFORMED", "UNAVAILABLE", "MISSING", "STALE", "FRESH"];
  const state = records.length
    ? records.reduce((worst, record) => order.indexOf(record.state) < order.indexOf(worst) ? record.state : worst, "FRESH")
    : "UNAVAILABLE";
  const ages = records.map(record => record.ageMs).filter(Number.isFinite);
  return Object.freeze({
    state,
    ageMs: ages.length ? Math.max(...ages) : null,
    observations: Object.freeze(observations),
    provenance: Object.freeze({
      provider: "FRED/ALFRED",
      sourceUrl: null,
      observedAt: new Date(now()).toISOString(),
      publishedAt: observations.at(-1)?.date || null,
      vintageAt: records[0]?.provenance?.vintageAt || null,
    }),
    error: records.find(record => record.error)?.error || null,
  });
}

function latestValues(results) {
  return Object.fromEntries(Object.entries(results).flatMap(([currency, record]) => {
    const row = [...(record.observations || [])].reverse().find(item => Number.isFinite(item.value));
    return row ? [[currency, row.value]] : [];
  }));
}

function macroEvents(record) {
  const grouped = new Map();
  for (const row of record.observations || []) {
    const key = `${row.currency || row.country || "UNKNOWN"}:${row.event}`;
    const surprise = Number.isFinite(row.actual) && Number.isFinite(row.estimate)
      ? row.actual - row.estimate : null;
    if (surprise !== null) (grouped.get(key) || grouped.set(key, []).get(key)).push(surprise);
  }
  return (record.observations || []).map(row => {
    const history = grouped.get(`${row.currency || row.country || "UNKNOWN"}:${row.event}`) || [];
    return {
      ...row,
      currency: row.currency || row.country || null,
      historicalSurprises: history,
    };
  });
}

function positioningByCurrency(record) {
  const result = {};
  for (const [currency, market] of Object.entries(CFTC_MARKETS)) {
    const rows = (record.observations || []).filter(row =>
      String(row.market).toUpperCase().includes(market));
    const values = rows.map(row =>
      Number.isFinite(row.leveragedFundsLong) && Number.isFinite(row.leveragedFundsShort)
        ? row.leveragedFundsLong - row.leveragedFundsShort : null).filter(Number.isFinite);
    if (values.length) result[currency] = { current: values[0], history: values.slice(1) };
  }
  return result;
}

function futuresByCurrency(record) {
  const symbolCurrency = { "6E": "EUR", "6J": "JPY", "6B": "GBP", "6A": "AUD", "6C": "CAD", "6S": "CHF", "6N": "NZD", DX: "USD" };
  const grouped = {};
  for (const row of record.observations || []) {
    const currency = symbolCurrency[String(row.symbol).toUpperCase()];
    if (currency) (grouped[currency] ||= []).push(row);
  }
  return Object.fromEntries(Object.entries(grouped).flatMap(([currency, rows]) => {
    rows.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (rows.length < 2) return [];
    return [[currency, {
      current: {
        price: rows[0].last,
        volume: rows[0].volume,
        openInterest: rows[0].openInterest,
      },
      previous: {
        price: rows[1].last,
        volume: rows[1].volume,
        openInterest: rows[1].openInterest,
      },
      asOf: rows[0].timestamp,
      now: record.provenance?.observedAt,
    }]];
  }));
}

export function createForexProviderContextService({
  fredApiKey,
  finnhubApiKey,
  cmeEndpoint,
  rateSeries = DEFAULT_RATE_SERIES,
  now = () => Date.now(),
  fred = createFredProvider({ apiKey: fredApiKey, now }),
  cftc = createCftcTffProvider({ now }),
  cme = createCmeDelayedProvider({ endpoint: cmeEndpoint, now }),
  finnhub = createFinnhubMacroProvider({ apiKey: finnhubApiKey, now }),
} = {}) {
  let refreshing = null;
  let context = Object.freeze({
    capturedAt: new Date(now()).toISOString(),
    providers: Object.freeze({
      fred: unavailable("FRED/ALFRED", now),
      cftc: unavailable("CFTC_TFF_SOCRATA", now),
      cme: unavailable("CME_DELAYED", now, cmeEndpoint ? "PROVIDER_NOT_REFRESHED" : "UNAVAILABLE_PROVIDER_TIER"),
      finnhub: unavailable("FINNHUB_MACRO", now),
    }),
    rates: Object.freeze({ yields: Object.freeze({}), expectedChanges: Object.freeze({}) }),
    macroEvents: Object.freeze([]),
    positioning: Object.freeze({}),
    futures: Object.freeze({}),
    crossMarkets: Object.freeze([]),
    executionCosts: Object.freeze({}),
    calibration: Object.freeze({}),
  });

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const at = now();
      const vintageDate = dateKey(at);
      const from = dateKey(at - 45 * 86400000);
      const to = dateKey(at + 14 * 86400000);
      const [rateRows, cftcRecord, cmeRecord, finnhubRecord] = await Promise.all([
        Promise.all(Object.entries(rateSeries).map(async ([currency, seriesId]) =>
          [currency, await fred.observations(seriesId, { vintageDate, limit: 100 })])),
        cftc.observations({ limit: 1000 }),
        cme.observations(),
        finnhub.observations({ from, to }),
      ]);
      const ratesByCurrency = Object.fromEntries(rateRows);
      const fredRecord = combinedFred(ratesByCurrency, now);
      context = Object.freeze({
        capturedAt: new Date(at).toISOString(),
        providers: Object.freeze({
          fred: fredRecord,
          cftc: cftcRecord,
          cme: cmeRecord,
          finnhub: finnhubRecord,
        }),
        rates: Object.freeze({
          yields: Object.freeze(latestValues(ratesByCurrency)),
          // A low-cost policy-rate feed is not a forward OIS curve.
          expectedChanges: Object.freeze({}),
        }),
        macroEvents: Object.freeze(macroEvents(finnhubRecord)),
        positioning: Object.freeze(positioningByCurrency(cftcRecord)),
        futures: Object.freeze(futuresByCurrency(cmeRecord)),
        crossMarkets: Object.freeze([]),
        executionCosts: Object.freeze({}),
        calibration: Object.freeze({}),
      });
      return context;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  return Object.freeze({
    refresh,
    getSnapshot: () => context,
    configuredRateSeries: Object.freeze({ ...rateSeries }),
  });
}

export function forexRateSeriesFromEnv(env = process.env) {
  return parseJsonMap(env.FOREX_FRED_RATE_SERIES_JSON, DEFAULT_RATE_SERIES);
}
