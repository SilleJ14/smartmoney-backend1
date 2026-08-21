function nextDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeBars(payload = {}, dateKey) {
  const rows = [];
  for (const [symbol, bars] of Object.entries(payload.bars || {})) {
    for (const bar of Array.isArray(bars) ? bars : []) {
      const barDateKey = bar.t ? String(bar.t).slice(0, 10) : dateKey;
      if (barDateKey !== dateKey) continue;
      rows.push({
        T: symbol,
        o: Number(bar.o || 0),
        h: Number(bar.h || 0),
        l: Number(bar.l || 0),
        c: Number(bar.c || 0),
        v: Number(bar.v || 0),
        t: bar.t || `${dateKey}T00:00:00Z`,
      });
    }
  }
  return rows;
}

export async function fetchAlpacaGroupedDaily({
  symbols = [],
  dateKey,
  dataRequest,
  batchSize = 200,
  maxDownloadBytes,
  feed = "iex",
} = {}) {
  const cleanSymbols = [...new Set(symbols.map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean))];
  if (!cleanSymbols.length) throw new Error("Alpaca fallback has no tradable stock symbols");
  if (typeof dataRequest !== "function") throw new Error("Alpaca data client unavailable");

  const rowsBySymbol = new Map();
  let downloadedBytes = 0;
  let requestCount = 0;
  let pageCount = 0;
  const end = nextDateKey(dateKey);

  for (let offset = 0; offset < cleanSymbols.length; offset += batchSize) {
    const batch = cleanSymbols.slice(offset, offset + batchSize);
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        symbols: batch.join(","),
        timeframe: "1Day",
        start: dateKey,
        end,
        adjustment: "all",
        feed,
        limit: "10000",
      });
      if (pageToken) params.set("page_token", pageToken);
      const payload = await dataRequest(`/v2/stocks/bars?${params.toString()}`);
      requestCount += 1;
      pageCount += 1;
      downloadedBytes += Buffer.byteLength(JSON.stringify(payload || {}));
      if (downloadedBytes > maxDownloadBytes) {
        throw new Error(`Discovery download budget exceeded during Alpaca fallback: ${downloadedBytes} bytes`);
      }
      for (const row of normalizeBars(payload, dateKey)) rowsBySymbol.set(row.T, row);
      pageToken = String(payload?.next_page_token || "");
    } while (pageToken);
  }

  if (!rowsBySymbol.size) throw new Error(`Alpaca fallback returned no daily bars for ${dateKey}`);

  return {
    groupedResults: [...rowsBySymbol.values()],
    downloadedBytes,
    requestCount,
    pageCount,
    requestedSymbols: cleanSymbols.length,
    returnedSymbols: rowsBySymbol.size,
    feed,
  };
}
