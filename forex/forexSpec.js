export const FOREX_SPEC_VERSION = "fx-v1";

export const FOREX_SPEC = Object.freeze({
  version: FOREX_SPEC_VERSION,
  practiceApiUrl: "https://api-fxpractice.oanda.com",
  liveApiHostForbidden: "api-fxtrade.oanda.com",
  quoteProviderMaxAgeSeconds: 2,
  quoteTransportMaxAgeSeconds: 1,
  accountMaxAgeSeconds: 5,
  calendarMaxAgeMinutes: 15,
  candlePollDeadlineSeconds: 30,
  authorizationExpiresSeconds: 2,
  h4Count: 220,
  h1Count: 140,
  m15Count: 80,
  atrPeriod: 14,
  atrTimeframe: "H1",
  scanInstruments: Object.freeze([
    "EUR_USD",
    "GBP_USD",
    "USD_JPY",
    "USD_CHF",
    "AUD_USD",
    "NZD_USD",
    "USD_CAD",
    "EUR_JPY",
    "GBP_JPY",
  ]),
  entryLifetimeSeconds: 60,
  maxAdverseEntryAtr: 0.10,
  stopDistanceMinAtr: 0.25,
  stopDistanceMaxAtr: 1.5,
  targetMultiple: 2.2,
  minNetRewardRisk: 2.0,
  maxHoldHours: 8,
  eventBlockMinutes: 30,
  eventResumeMinutes: 15,
  centralBankBlockBeforeMinutes: 60,
  centralBankBlockAfterMinutes: 60,
  liveOrdersAuthorized: false,
  marginBufferPercent: 20,
});

export function pipSize(instrument) {
  return /JPY/i.test(String(instrument || "")) ? 0.01 : 0.0001;
}

export function toOandaInstrument(symbol) {
  return String(symbol || "").trim().replace("/", "_").replace("-", "_").toUpperCase();
}

export function toDisplayPair(instrument) {
  const symbol = toOandaInstrument(instrument);
  const match = symbol.match(/^([A-Z]{3})_([A-Z]{3})$/);
  return match ? `${match[1]}/${match[2]}` : symbol;
}
