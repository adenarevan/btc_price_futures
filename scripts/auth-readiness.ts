import { getAuth, getDb } from "../src/lib/firebase/admin";
import { getConfig } from "../src/lib/config";
import { loadEnvironment } from "./private-cli";
async function main() {
  loadEnvironment();
  const c = getConfig();
  const user = await getAuth().getUser(c.OWNER_UID),
    profile = (await getDb().doc(`users/${c.OWNER_UID}`).get()).data();
  const checks = {
    ownerMatches: user.uid === c.OWNER_UID,
    emailMatches: user.email === c.ADMIN_AUTH_EMAIL,
    passwordProvider: user.providerData.some(
      (p) => p.providerId === "password",
    ),
    role: profile?.role === "ADMIN",
    schema: profile?.authSchemaVersion === 2,
    passwordRotated:
      profile?.passwordChangeRequired === false && !!profile?.passwordChangedAt,
    enabled: !user.disabled,
    secrets:
      c.CSRF_SIGNING_SECRET.length >= 32 &&
      c.RATE_LIMIT_HMAC_SECRET.length >= 32,
  };
  console.log(
    JSON.stringify(
      {
        status: Object.values(checks).every(Boolean) ? "READY" : "NOT_READY",
        checks,
      },
      null,
      2,
    ),
  );
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "AUTH_NOT_READY: konfigurasi atau akses layanan belum lengkap.",
  );
  process.exitCode = 1;
});
