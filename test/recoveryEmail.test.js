import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryEmailSender } from "../security/recoveryEmail.js";

test("recovery email sender stays disabled until both server secrets are configured", () => {
  assert.equal(createRecoveryEmailSender(), null);
  assert.equal(createRecoveryEmailSender({ apiKey: "re_test" }), null);
  assert.equal(createRecoveryEmailSender({ from: "SmartMoney <security@example.com>" }), null);
});

test("recovery email sender uses the provider API without exposing its key in content", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: "email-id" }) };
  };

  try {
    const sender = createRecoveryEmailSender({
      apiKey: "re_private_test_key",
      from: "SmartMoney Security <security@example.com>",
    });
    const result = await sender({
      to: "owner@example.com",
      code: "01234567",
      expiresInMinutes: 10,
    });
    assert.equal(result.id, "email-id");
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.options.headers.Authorization, "Bearer re_private_test_key");
    assert.match(request.options.headers["Idempotency-Key"], /^smartmoney-recovery-/);
    const payload = JSON.parse(request.options.body);
    assert.deepEqual(payload.to, ["owner@example.com"]);
    assert.equal(payload.subject, "Your SmartMoney recovery code");
    assert.match(payload.text, /01234567/);
    assert.match(payload.text, /10 minutes/);
    assert.doesNotMatch(payload.text, /re_private_test_key/);
  } finally {
    global.fetch = originalFetch;
  }
});
