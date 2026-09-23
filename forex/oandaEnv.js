import { FOREX_SPEC } from "./forexSpec.js";

export function resolveOandaEnv(env = process.env) {
  const token = String(
    env.OANDA_PRACTICE_TOKEN || env.OANDA_API_KEY || env.OANDA_TOKEN || env.OANDA_API_TOKEN || ""
  ).trim();
  const accountId = String(env.OANDA_ACCOUNT_ID || "").trim();
  const requestedUrl = String(env.OANDA_API_URL || "").trim();
  const liveRequested = /api-fxtrade\.oanda\.com/i.test(requestedUrl);
  return {
    token,
    accountId,
    baseUrl: liveRequested ? FOREX_SPEC.practiceApiUrl : (requestedUrl || FOREX_SPEC.practiceApiUrl),
    liveUrlRejected: liveRequested,
  };
}
