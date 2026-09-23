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
  const converted = Number.isFinite(factor) && factor > 0 ? priceLoss * factor : priceLoss;
  return converted + Number(costAllowance || 0);
}

export function quoteConversionFactor(price = {}, side = "buy") {
  const factors = price.quoteHomeConversionFactors || price.homeConversions || {};
  const positive = Number(factors.positiveUnits?.positionCost || factors.positiveUnits);
  const negative = Number(factors.negativeUnits?.positionCost || factors.negativeUnits);
  if (side === "buy") return Number.isFinite(positive) && positive > 0 ? positive : 1;
  return Number.isFinite(negative) && negative > 0 ? negative : 1;
}
