const recipient = String(process.argv[2] || "").trim().toLowerCase();
const apiKey = String(process.env.RESEND_API_KEY || "").trim();
const from = String(process.env.RECOVERY_EMAIL_FROM || "SmartMoney <onboarding@resend.dev>").trim();

if (!/^\S+@\S+\.\S+$/.test(recipient)) {
  console.error("Usage: node scripts/testRecoveryEmail.js your@email.com");
  process.exit(1);
}
if (!apiKey) {
  console.error("RESEND_API_KEY is missing from this Render service.");
  process.exit(1);
}
if (!apiKey.startsWith("re_")) {
  console.error("RESEND_API_KEY is present but is not a Resend key beginning with re_.");
  process.exit(1);
}

try {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "SmartMoney-Recovery-Test/1.0",
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: "SmartMoney recovery test",
      text: "Your SmartMoney recovery email service is working.",
    }),
  });
  const responseText = await response.text();
  console.log(`Resend HTTP ${response.status}`);
  console.log(responseText || (response.ok ? "Email accepted." : "No error details returned."));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Unable to reach Resend: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
}
