// Emits only field names and booleans, never environment values.
import { getConfig } from "../src/lib/config";
import { ConfigurationError } from "../src/lib/errors";
import { createPrivateKey } from "node:crypto";
const file = process.argv[2] ?? ".env.local";
process.loadEnvFile(file);
if (process.argv.includes("--vercel")) process.env.VERCEL = "1";
const fixed: Record<string, string[]> = {
  ADMIN_USERNAME: ["admin"], DEMO_MODE: ["true", "false"], AI_ENABLED: ["true", "false"], AUTOMATION_ENABLED: ["false"],
};
const invalid = Object.keys(fixed).filter(key => process.env[key] !== undefined && !fixed[key]!.includes(process.env[key]!));
const populated = Object.fromEntries(["APP_ORIGIN", "ADMIN_USERNAME", "SESSION_MAX_AGE_SECONDS", "DEMO_MODE", "AI_ENABLED", "AUTOMATION_ENABLED", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_WEB_API_KEY", "CSRF_SIGNING_SECRET", "RATE_LIMIT_HMAC_SECRET", "OWNER_UID", "ADMIN_AUTH_EMAIL"].map(key => [key, !!process.env[key]?.trim()]));
try {
  const c = getConfig();
  const checks = {
    publicOriginMatches: c.APP_ORIGIN === "https://btc-price-futures.vercel.app",
    csrfSecretLongEnough: c.CSRF_SIGNING_SECRET.length >= 32,
    rateLimitSecretLongEnough: c.RATE_LIMIT_HMAC_SECRET.length >= 32,
    firebaseProjectPresent: !!c.FIREBASE_PROJECT_ID,
    firebaseClientEmailPresent: !!c.FIREBASE_CLIENT_EMAIL,
    firebaseWebKeyPresent: !!c.FIREBASE_WEB_API_KEY,
    ownerPresent: !!c.OWNER_UID,
    adminEmailPresent: !!c.ADMIN_AUTH_EMAIL,
    privateKeyValid: false,
    aiEnabled: c.AI_ENABLED === "true",
    aiKeyPresent: !!c.OPENAI_API_KEY,
  };
  try { createPrivateKey(c.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")); checks.privateKeyValid = true; } catch { /* No secret in output. */ }
  console.log(JSON.stringify({ configurationValid: true, invalidRawEnumFields: invalid, checks }));
} catch (error) {
  console.log(JSON.stringify({ configurationValid: false, fields: error instanceof ConfigurationError ? error.fields : ["UNKNOWN"], invalidRawEnumFields: invalid, populated }));
  process.exitCode = 1;
}
