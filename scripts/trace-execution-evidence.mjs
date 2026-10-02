// Read-only provider/backend probe. Never imports the server or submits orders.
import fs from 'node:fs';
import dotenv from 'dotenv';
const local = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {};
const env = { ...local, ...process.env };
const base = 'https://smartmoney1.onrender.com';
async function read(label, url, headers, project) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (!response.ok) return { label, status: response.status };
    return { label, status: response.status, data: project(await response.json()) };
  } catch (error) { return { label, error: error.name }; }
}
const pick = (value, fields) => Object.fromEntries(fields.map(key => [key, value?.[key]]));
const symbols = ['ASLE', 'SCNI', 'BTC/USD', 'ETH/USD'];
const results = [];
if (env.ADMIN_API_TOKEN) results.push(await read('backend candidates', `${base}/frontend/signals?limit=100`,
  { Authorization: `Bearer ${env.ADMIN_API_TOKEN}` }, body => (body.signals || []).filter(row => symbols.includes(row.symbol)).map(row => ({
    ...pick(row, ['symbol','price','bid','ask','spreadPercent','liveQuoteSource','liveQuoteUpdatedAt','spreadUpdatedAt',
      'entryQualityScore','entryQualityScoreAvailable','cryptoEntryScore','cryptoEntryScoreAvailable','masterFinalScore',
      'approved','executionEligibility','missingEvidenceReasons','decisionUpdatedAt','researchEvidenceAt']),
    entry: row.entryQualityScorecard || row.cryptoEntryScorecard,
  }))));
if (env.TRADIER_API_KEY) results.push(await read('tradier source', 'https://api.tradier.com/v1/markets/quotes?symbols=ASLE,SCNI',
  { Authorization: `Bearer ${env.TRADIER_API_KEY}`, Accept: 'application/json' }, body => body.quotes));
const key = env.ALPACA_LIVE_KEY, secret = env.ALPACA_LIVE_SECRET;
if (key && secret) {
  const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
  results.push(await read('alpaca stock source', 'https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=ASLE,SCNI', headers, body => body));
  results.push(await read('alpaca crypto source', 'https://data.alpaca.markets/v1beta3/crypto/us/latest/quotes?symbols=BTC%2FUSD,ETH%2FUSD', headers, body => body));
  results.push(await read('alpaca crypto orderbook source', 'https://data.alpaca.markets/v1beta3/crypto/us/latest/orderbooks?symbols=BTC%2FUSD,ETH%2FUSD', headers,
    body => Object.fromEntries(Object.entries(body.orderbooks || {}).map(([symbol, book]) => [symbol, { t: book.t, a: book.a?.slice(0, 2), b: book.b?.slice(0, 2) }]))));
}
console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
