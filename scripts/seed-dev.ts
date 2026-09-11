import { getDb } from "../src/lib/firebase/admin";
import { getConfig } from "../src/lib/config";
import { newAccount, DEFAULT_SETTINGS } from "../src/lib/engine";
import { encode } from "../src/lib/repository";
import { loadEnvironment } from "./private-cli";
async function main() {
  loadEnvironment();
  const c = getConfig();
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !c.FIREBASE_PROJECT_ID.startsWith("demo-") ||
    !c.OWNER_UID
  )
    throw new Error("EMULATOR_OWNER_REQUIRED");
  const ref = getDb().doc(`users/${c.OWNER_UID}/accounts/paper-futures-v1`),
    cfg = getDb().doc(`users/${c.OWNER_UID}/settings/trading`);
  await getDb().runTransaction(async (tx) => {
    const [a, s] = await tx.getAll(ref, cfg);
    if (!a!.exists)
      tx.create(ref, encode(newAccount()) as Record<string, unknown>);
    if (!s!.exists) tx.create(cfg, DEFAULT_SETTINGS);
  });
  console.log(
    "DEMO: account/schema initialized if absent; authentication unchanged.",
  );
}
main().catch(() => {
  console.error("SEED_NOT_READY");
  process.exitCode = 1;
});
