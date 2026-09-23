export function mapInstrument(row = {}) {
  const name = row.name || row.instrument;
  const [base, quote] = String(name || "").split("_");
  return {
    instrumentId: name,
    assetClass: "forex",
    displayName: row.displayName || name,
    pipLocation: Number(row.pipLocation),
    displayPrecision: Number(row.displayPrecision),
    tradeUnitsPrecision: Number(row.tradeUnitsPrecision ?? 0),
    minimumTradeSize: Number(row.minimumTradeSize || 1),
    maximumOrderUnits: Number(row.maximumOrderUnits || 0),
    marginRate: Number(row.marginRate || 0),
    baseCurrency: base || null,
    quoteCurrency: quote || null,
    tradeable: row.tradeable !== false,
    absoluteSpreadLimit: Number(row.absoluteSpreadLimit || 0),
  };
}

export function conversionLossPerUnit({ worstEntry, stop, conversionFactor, costAllowance = 0 }) {
  const priceLoss = Math.abs(Number(worstEntry) - Number(stop));
  const factor = Number(conversionFactor);
  if (!Number.isFinite(factor) || factor <= 0) return NaN;
  const converted = priceLoss * factor;
  return converted + Number(costAllowance || 0);
}

export function quoteConversionFactor(price = {}, side = "buy") {
  const factors = price.quoteHomeConversionFactors || price.homeConversions || {};
  const positive = Number(factors.positiveUnits?.positionCost || factors.positiveUnits);
  const negative = Number(factors.negativeUnits?.positionCost || factors.negativeUnits);
  if (side === "buy") return Number.isFinite(positive) && positive > 0 ? positive : null;
  return Number.isFinite(negative) && negative > 0 ? negative : null;
}

export function lossConversion(instrument, accountCurrency, conversions = []) {
  const currency = String(instrument).split("_")[1];
  if (currency === accountCurrency) return 1;
  const value = Number(conversions.find((row) => row.currency === currency)?.accountLoss);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function priceText(value, instrument) {
  const precision = Number(instrument?.displayPrecision);
  if (!Number.isInteger(precision) || precision < 0 || precision > 10 || !(Number(value) > 0)) return null;
  return Number(value).toFixed(precision);
}
