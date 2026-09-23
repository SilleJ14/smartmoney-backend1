export function canonicalAccountId({
  environment = "practice",
  broker = "oanda",
  accountId,
  assetClass = "forex",
  instrumentId,
} = {}) {
  const parts = [environment, broker, accountId, assetClass, instrumentId].map((part) =>
    String(part || "").trim()
  );
  if (parts.some((part) => !part)) {
    throw new Error("CANONICAL_IDENTITY_INCOMPLETE");
  }
  return parts.join(":");
}

export function classifyPositionEffect({ currentUnits = 0, orderUnits }) {
  const current = Number(currentUnits) || 0;
  const order = Number(orderUnits);
  if (!Number.isFinite(order) || order === 0) return "NONE";
  if (current === 0) return order > 0 ? "OPENING_LONG" : "OPENING_SHORT";
  const next = current + order;
  if (next === 0) return "CLOSING";
  if (Math.sign(current) === Math.sign(order)) return "INCREASING";
  if (Math.abs(next) < Math.abs(current)) return "REDUCING";
  return Math.sign(order) > 0 ? "OPENING_LONG" : "OPENING_SHORT";
}

export function isOpeningRisk(effect) {
  return effect === "OPENING_LONG" || effect === "OPENING_SHORT" || effect === "INCREASING";
}

export function resolveAssetClass({ assetClass, broker, instrumentId, symbol } = {}) {
  const explicit = String(assetClass || "").toLowerCase();
  if (explicit === "forex" || explicit === "stock" || explicit === "crypto") return explicit;
  if (String(broker || "").toLowerCase() === "oanda") return "forex";
  const id = String(instrumentId || symbol || "");
  if (/^[A-Z]{3}[_/][A-Z]{3}$/.test(id.replace("-", "_"))) {
    throw new Error("ASSET_CLASS_REQUIRED");
  }
  return "unknown";
}
