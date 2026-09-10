import crypto from "crypto";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { cancelResponseBody, readBoundedResponseJson } from "../utils/boundedResponse.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export function createRecoveryEmailSender({ apiKey = "", from = "" } = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  const normalizedFrom = String(from || "").trim();
  if (!normalizedApiKey || !normalizedFrom) return null;

  return async function sendRecoveryEmail({ to, code, expiresInMinutes }) {
    const idempotencyKey = `smartmoney-recovery-${crypto.randomUUID()}`;
    const response = await fetchWithTimeout(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "SmartMoney-Recovery/1.0",
      },
      body: JSON.stringify({
        from: normalizedFrom,
        to: [String(to || "").trim()],
        subject: "Your SmartMoney recovery code",
        text: [
          "Your SmartMoney password recovery code is:",
          "",
          String(code),
          "",
          `This code expires in ${expiresInMinutes} minutes and can be used only once.`,
          "If you did not request this code, you can safely ignore this email.",
        ].join("\n"),
      }),
    }, 10000);

    if (!response.ok) {
      cancelResponseBody(response);
      throw new Error(`Email provider rejected the request (${response.status})`);
    }
    const result = await readBoundedResponseJson(response, { maxBytes: 16384, timeoutMs: 5000 });
    if (typeof result?.id !== 'string' || !result.id.trim()) {
      throw new Error('Email provider did not confirm acceptance');
    }
    return result;
  };
}
