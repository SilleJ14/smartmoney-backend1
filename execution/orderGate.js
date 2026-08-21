export const EMERGENCY_BUY_BLOCK_MESSAGE =
  "Emergency stop is active. New buy orders are blocked.";

export function assertOrderAllowed({
  path,
  options = {},
  emergencyStopActive = false,
} = {}) {
  if (!emergencyStopActive) return;

  const method = String(options.method || "GET").toUpperCase();
  if (method !== "POST" || path !== "/v2/orders") return;

  let orderBody;
  try {
    orderBody = JSON.parse(options.body || "{}");
  } catch {
    throw new Error(
      "Emergency stop is active. Malformed order payload was blocked."
    );
  }

  const side = String(orderBody?.side || "").toLowerCase();
  if (side !== "sell") {
    throw new Error(EMERGENCY_BUY_BLOCK_MESSAGE);
  }
}
