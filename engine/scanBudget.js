export function resolveBoundedScanLimit(
  value,
  { fallback = 60, minimum = 10, maximum = 60 } = {}
) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(Number(fallback))
    ? Number(fallback)
    : 60;
  const requested = Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : Math.floor(safeFallback);
  return Math.max(
    Math.floor(Number(minimum) || 1),
    Math.min(Math.floor(Number(maximum) || 60), requested)
  );
}
