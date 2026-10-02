import { boundedJson, finiteOrNull, freshness, provenance, providerFailure } from "./providerUtils.js";

const ENDPOINT = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";

export function createCftcTffProvider({
  fetchImpl,
  endpoint = ENDPOINT,
  timeoutMs,
  maxBytes,
  maxAgeMs = 10 * 24 * 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  return Object.freeze({
    async observations({ market, limit = 500 } = {}) {
      const observedAt = new Date(now()).toISOString();
      try {
        const url = new URL(endpoint);
        url.searchParams.set("$limit", String(Math.min(5000, Math.max(1, limit))));
        url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
        if (market) url.searchParams.set("$where", `market_and_exchange_names like '%${String(market).replaceAll("'", "''")}%'`);
        const { data, sourceUrl } = await boundedJson(url, { fetchImpl, timeoutMs, maxBytes });
        if (!Array.isArray(data)) throw new Error("CFTC_SCHEMA_INVALID");
        const rows = data.map((row) => {
          const reportDate = row?.report_date_as_yyyy_mm_dd || row?.report_date;
          const marketName = row?.market_and_exchange_names || row?.contract_market_name;
          if (!reportDate || !marketName) throw new Error("CFTC_SCHEMA_INVALID");
          return Object.freeze({
            market: String(marketName),
            reportDate: String(reportDate).slice(0, 10),
            dealerLong: finiteOrNull(row.dealer_positions_long_all),
            dealerShort: finiteOrNull(row.dealer_positions_short_all),
            assetManagerLong: finiteOrNull(row.asset_mgr_positions_long_all),
            assetManagerShort: finiteOrNull(row.asset_mgr_positions_short_all),
            leveragedFundsLong: finiteOrNull(row.lev_money_positions_long_all),
            leveragedFundsShort: finiteOrNull(row.lev_money_positions_short_all),
            openInterest: finiteOrNull(row.open_interest_all),
          });
        });
        const publishedAt = rows[0]?.reportDate || null;
        return Object.freeze({
          ...freshness(publishedAt, { now: now(), maxAgeMs }),
          observations: Object.freeze(rows),
          provenance: provenance({ provider: "CFTC_TFF_SOCRATA", sourceUrl, observedAt, publishedAt }),
        });
      } catch (error) {
        return providerFailure(error, "CFTC_TFF_SOCRATA", observedAt);
      }
    },
  });
}
