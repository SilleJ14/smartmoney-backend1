// One numeric reader. Empty means missing. Zero is a real value.
export function parseFiniteNumber(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : defaultValue;
}

export function parseFiniteNumberDetailed(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return { value: defaultValue, usedDefault: true, reason: "EMPTY" };
  }
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) {
    return { value: defaultValue, usedDefault: true, reason: "INVALID_NUMBER" };
  }
  return { value: number, usedDefault: false, reason: null };
}
