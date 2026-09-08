import { providerDailyBar } from "./providerDailyBar.js";

function nextDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeBars(payload = {}, dateKey) {
  const rows = [];
  for (const [symbol, bars] of Object.entries(payload.bars || {})) {
    for (const bar of Array.isArray(bars) ? bars : []) {
      const normalized = providerDailyBar(symbol, bar);
      if (!normalized || normalized.d !== dateKey) continue;
      rows.push({
        T: symbol,
        o: Number(bar.o || 0),
        h: Number(bar.h || 0),
        l: Number(bar.l || 0),
        c: Number(bar.c || 0),
        v: Number(bar.v || 0),
        t: normalized.t,
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
  maxDownloadBytes = 16 * 1024 * 1024,
  maxPages = 100,
  maxDurationMs = 90000,
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
  const deadline = Date.now() + maxDurationMs;
  batchSize = Math.max(1, Math.min(200, Number(batchSize) || 200));

  for (let offset = 0; offset < cleanSymbols.length; offset += batchSize) {
    const batch = cleanSymbols.slice(offset, offset + batchSize);
    let pageToken = "";
    const seenTokens = new Set();
    do {
      if (Date.now() >= deadline || pageCount >= maxPages || seenTokens.has(pageToken)) {
        throw new Error("Discovery pagination/deadline budget exceeded");
      }
      seenTokens.add(pageToken);
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
      if (downloadedBytes >= maxDownloadBytes) throw new Error("Discovery download budget exhausted");
      let measuredBytes = false;
      const payload = await dataRequest(`/v2/stocks/bars?${params.toString()}`, {
        maxResponseBytes: maxDownloadBytes - downloadedBytes,
        timeoutMs: Math.max(1, deadline - Date.now()),
        onBytesRead: (bytes) => { measuredBytes = true; downloadedBytes += bytes; },
      });
      requestCount += 1;
      pageCount += 1;
      // In-memory clients have no HTTP body. Production reports consumed bytes.
      if (!measuredBytes) downloadedBytes += Buffer.byteLength(JSON.stringify(payload || {}));
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
