import { randomUUID } from "node:crypto";
import { getAuth, getDb } from "../src/lib/firebase/admin";
import { getConfig } from "../src/lib/config";
import { newAccount, DEFAULT_SETTINGS } from "../src/lib/engine";
import { encode } from "../src/lib/repository";
import { hiddenPassword, loadEnvironment } from "./private-cli";
async function main() {
  loadEnvironment();
  const c = getConfig();
  if (!c.ADMIN_AUTH_EMAIL) throw new Error("ADMIN_AUTH_EMAIL_REQUIRED");
  const reset = process.argv.includes("--reset"),
    migrate = process.argv.includes("--attach-password");
  if (
    process.argv
      .slice(2)
      .some((a) => !["--reset", "--attach-password"].includes(a))
  )
    throw new Error("NO_PASSWORD_ARGUMENTS_ALLOWED");
  let existing = null;
  try {
    existing = await getAuth().getUser(c.OWNER_UID || "nonexistent");
  } catch (e) {
    if ((e as { code: string }).code !== "auth/user-not-found") throw e;
  }
  try {
    const byEmail = await getAuth().getUserByEmail(c.ADMIN_AUTH_EMAIL);
    if (existing && byEmail.uid !== existing.uid)
      throw new Error("UID_EMAIL_CONFLICT");
    existing = byEmail;
  } catch (e) {
    if ((e as { code: string }).code !== "auth/user-not-found") throw e;
  }
  if (existing && !reset && !migrate)
    throw new Error("ACCOUNT_EXISTS_REFUSING_OVERWRITE");
  if ((reset || migrate) && (!existing || existing.uid !== c.OWNER_UID))
    throw new Error("EXISTING_OWNER_UID_REQUIRED");
  const password = await hiddenPassword(),
    confirm = await hiddenPassword("Ulangi password: ");
  if (password !== confirm || password.length < 6)
    throw new Error("PASSWORD_CONFIRMATION_FAILED");
  const uid = existing?.uid || c.OWNER_UID || randomUUID();
  const userRef = getDb().doc(`users/${uid}`);
  if (existing) {
    await userRef.set({ passwordChangeRequired: true }, { merge: true });
    await getAuth().updateUser(uid, { email: c.ADMIN_AUTH_EMAIL, password });
    await getAuth().revokeRefreshTokens(uid);
  } else
    await getAuth().createUser({ uid, email: c.ADMIN_AUTH_EMAIL, password });
  await getDb().runTransaction(async (tx) => {
    const accountRef = getDb().doc(`users/${uid}/accounts/paper-futures-v1`),
      settingsRef = getDb().doc(`users/${uid}/settings/trading`);
    const [account, settings] = await tx.getAll(accountRef, settingsRef);
    tx.set(
      userRef,
      {
        username: "admin",
        role: "ADMIN",
        timezone: "Asia/Jakarta",
        authSchemaVersion: 2,
        passwordChangeRequired: true,
      },
      { merge: true },
    );
    if (!account!.exists)
      tx.create(accountRef, encode(newAccount()) as Record<string, unknown>);
    if (!settings!.exists) tx.create(settingsRef, DEFAULT_SETTINGS);
  });
  process.stdout.write(`OWNER_UID=${uid}\n`);
}
main().catch((e) => {
  process.stderr.write(
    "Bootstrap error: " + (e instanceof Error ? e.message + "\n" + e.stack : String(e)) + "\n"
  );
  process.stderr.write(
    "Bootstrap tidak selesai. Periksa konfigurasi/akun existing dan gunakan terminal privat. Tidak ada credential ditampilkan.\n",
  );
  process.exitCode = 1;
});
