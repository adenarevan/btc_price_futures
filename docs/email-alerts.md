# Signal email alerts

Uses Resend to send approved, unexpired LONG/SHORT paper signals. WAIT,
manual experiments, demo mode, and consumed signals are excluded.
The configured recipient is server-only; only OWNER_UID can trigger delivery.

Set these server environment variables in Vercel, then redeploy:

```
EMAIL_ALERTS_ENABLED=true
RESEND_API_KEY=<key from Resend dashboard>
SIGNAL_EMAIL_FROM=onboarding@resend.dev
SIGNAL_EMAIL_TO=<recipient email>
```

The Resend test sender can send only to the email associated with your Resend
account. Sign up using the intended recipient, or verify a sending domain and
replace SIGNAL_EMAIL_FROM with an address on it. Never use a Gmail password.

Messages include the symbol, direction, entry, stop-loss, target, expiry and
signal link. Firestore users/{uid}/emailAlerts records ACCEPTED (accepted by
the provider, not confirmed inbox delivery) or FAILED with HTTP status.
Provider idempotency plus the stored receipt prevent repeated submissions.
Failed sends can be retried by rescanning while the signal remains valid.

Email does not schedule analysis. The current browser monitor must stay open
and enabled to generate periodic signals; no background cron is added here.
After configuration, generate a valid signal, inspect the provider delivery
log and check the recipient inbox/spam folder. Delivery has not been tested
until real sender credentials are configured.
