import { loadEnvironment } from "./private-cli";
import { getConfig } from "../src/lib/config";
import { getDb } from "../src/lib/firebase/admin";
import { decode } from "../src/lib/repository";
import type { Signal } from "../src/lib/domain";
async function main() {
  loadEnvironment();
  const uid = getConfig().OWNER_UID;
  const [signals, runs] = await Promise.all([
    getDb().collection(`users/${uid}/signals`).orderBy("createdAt", "desc").limit(100).get(),
    getDb().collection(`users/${uid}/runs`).orderBy("startedAt", "desc").limit(100).get(),
  ]);
  const reasons: Record<string, number> = {}, errors: Record<string, number> = {};
  let baselineCandidates = 0, entries = 0;
  for (const doc of signals.docs) {
    const s = decode<Signal>(doc.data());
    if (s.strategyVersion.startsWith("manual")) continue;
    if (s.baseline?.decision !== "WAIT" && s.baseline?.plan) baselineCandidates++;
    if (s.decision !== "WAIT") entries++;
    for (const reason of s.baseline?.reasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  for (const doc of runs.docs) { const r = doc.data(); if (r.error) errors[String(r.error)] = (errors[String(r.error)] ?? 0) + 1; }
  console.log(JSON.stringify({ sampledSignals: signals.size, baselineCandidates, entries, reasons, sampledRuns: runs.size, errors }, null, 2));
}
main().catch(() => { console.error("SIGNAL_AUDIT_UNAVAILABLE"); process.exitCode = 1; });
