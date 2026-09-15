// Explicit, one-off email diagnostic. Does not create signals or positions.
const required = ["RESEND_API_KEY", "SIGNAL_EMAIL_FROM", "SIGNAL_EMAIL_TO"];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.log(JSON.stringify({ status: "CONFIG_MISSING", variables: missing }));
  process.exitCode = 1;
} else {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "sinyallab-email-test-20260915-01",
      },
      body: JSON.stringify({
        from: process.env.SIGNAL_EMAIL_FROM.trim(),
        to: [process.env.SIGNAL_EMAIL_TO.trim()],
        subject: "[TEST] SinyalLab — tes notifikasi email",
        text: "Ini email TEST notifikasi SinyalLab. Bukan sinyal LONG/SHORT dan tidak membuka transaksi.\n\nEmail sinyal asli nantinya memuat koin, arah LONG/SHORT, entry, stop-loss, target, dan masa berlaku.\n\nJika email ini sampai, pengiriman ke alamat Anda berhasil diuji.",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    console.log(JSON.stringify({ status: response.ok && data.id ? "ACCEPTED" : "REJECTED", httpStatus: response.status, providerId: response.ok ? data.id : undefined, errorType: !response.ok && typeof data.name === "string" ? data.name : undefined }));
    if (!response.ok) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ status: "NETWORK_OR_RESPONSE_ERROR" }));
    process.exitCode = 1;
  }
}
