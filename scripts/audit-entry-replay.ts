import { loadEnvironment } from "./private-cli";
import { getConfig } from "../src/lib/config";
import { getDb } from "../src/lib/firebase/admin";
import { decode, settings } from "../src/lib/repository";
import { evaluateBaseline, newAccount } from "../src/lib/engine";
import type { Signal, MarketSnapshot } from "../src/lib/domain";

async function main() {
  loadEnvironment();
  const uid = getConfig().OWNER_UID, db = getDb();
  const [rows, cfg] = await Promise.all([
    db.collection(`users/${uid}/signals`).orderBy("createdAt", "desc").limit(100).get(), settings(uid),
  ]);
  const signals = rows.docs.map(doc => decode<Signal>(doc.data())).filter(s => !s.strategyVersion.startsWith("manual-"));
  const snapshots = await db.getAll(...signals.map(s => db.doc(`snapshots/${s.snapshotId}`)));
  const reasons: Record<string, number> = {};
  let evaluated = 0, oldCandidates = 0, newCandidates = 0;
  const clock = Date.now;
  try {
    for (let i = 0; i < signals.length; i++) {
      if (!snapshots[i]!.exists) continue;
      const s = decode<MarketSnapshot>(snapshots[i]!.data());
      Date.now = () => s.serverTime;
      const result = evaluateBaseline(s, cfg, { account: newAccount(), positions: [] });
      evaluated++;
      if (signals[i]!.baseline?.decision !== "WAIT" && signals[i]!.baseline?.plan) oldCandidates++;
      if (result.decision !== "WAIT") newCandidates++;
      for (const reason of result.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  } finally { Date.now = clock; }
  console.log(JSON.stringify({ label: "Snapshot eligibility only; fresh empty paper account, no PNL/backtest or AI review", evaluated, oldCandidates, newCandidates, reasons }, null, 2));
}
main().catch(() => { console.error("ENTRY_REPLAY_UNAVAILABLE"); process.exitCode = 1; });
