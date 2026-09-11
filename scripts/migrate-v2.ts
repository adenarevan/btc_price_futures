import { getDb } from "../src/lib/firebase/admin";
import { getConfig } from "../src/lib/config";
import { newAccount, DEFAULT_SETTINGS } from "../src/lib/engine";
import { encode } from "../src/lib/repository";
import { loadEnvironment } from "./private-cli";
async function main() {
  loadEnvironment();
  const c = getConfig();
  if (!c.OWNER_UID) throw new Error("OWNER_UID_REQUIRED");
  const db = getDb(),
    ref = db.doc(`users/${c.OWNER_UID}/accounts/paper-futures-v1`),
    cfg = db.doc(`users/${c.OWNER_UID}/settings/trading`);
  await db.runTransaction(async (tx) => {
    const [a, s] = await tx.getAll(ref, cfg);
    if (!a!.exists)
      tx.create(ref, encode(newAccount()) as Record<string, unknown>);
    if (!s!.exists) tx.create(cfg, DEFAULT_SETTINGS);
  });
  console.log(
    "Fresh futures account v2 created if absent. Historical spot documents unchanged and excluded by account scope. Attach password to existing OWNER_UID using bootstrap:admin -- --attach-password. Disable Google provider in Firebase Console.",
  );
}
main().catch(() => {
  console.error("MIGRATION_NOT_READY");
  process.exitCode = 1;
});
