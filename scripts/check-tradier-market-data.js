import "dotenv/config";
import { createTradierMarketData } from "../providers/tradierMarketData.js";

// Explicitly read-only: imports neither server.js nor an order service.
const provider = createTradierMarketData();
if (!provider.getStatus().configured) {
  console.log(JSON.stringify({ configured: false, error: "TRADIER_API_KEY_NOT_CONFIGURED" }));
  process.exitCode = 2;
} else {
  const quotes = await provider.getLatestQuotes([String(process.argv[2] || "SPY").toUpperCase()]);
  console.log(JSON.stringify({
    ...provider.getStatus(),
    quotes: quotes.map((quote) => ({
      symbol: quote.symbol, source: quote.source, priceIsLive: quote.priceIsLive,
      quoteAgeSeconds: (Date.now() - Date.parse(quote.liveQuoteUpdatedAt)) / 1000,
      spreadAgeSeconds: quote.spreadUpdatedAt ? (Date.now() - Date.parse(quote.spreadUpdatedAt)) / 1000 : null,
      spreadAvailable: quote.spreadAvailable,
    })),
  }, null, 2));
  if (!quotes.length) process.exitCode = 1;
}
