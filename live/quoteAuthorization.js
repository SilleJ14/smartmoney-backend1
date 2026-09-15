export function assertVerifiedQuote(resolution, symbol) {
  if (resolution?.quoteReady !== true) {
    throw new Error(`QUOTE_VERIFICATION_FAILED: ${symbol} requires a verified fresh price and spread before buying`);
  }
  return resolution.quote;
}
