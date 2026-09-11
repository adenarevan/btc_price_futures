// Read-only diagnostic: never opens or closes a position.
import { loadEnvironment } from "./private-cli";
import { getConfig } from "../src/lib/config";
import * as repo from "../src/lib/repository";
import { marketSnapshot } from "../src/lib/market";
import { createManualPlan } from "../src/lib/engine";

async function main() {
  loadEnvironment();
  const uid = getConfig().OWNER_UID;
  const [settings, context] = await Promise.all([repo.settings(uid), repo.context(uid)]);
  console.log(JSON.stringify({ equityCollateral: context.account.availableCollateral, openPositions: context.positions.filter(p => p.status === "OPEN").length }));
  for (const symbol of ["SOLUSDT", "BTCUSDT"] as const) {
    try {
      const snapshot = await marketSnapshot(symbol, Date.now() + 45000);
      for (const side of ["LONG", "SHORT"] as const) {
        try {
          const plan = createManualPlan({ snapshot, side, settings, context });
          console.log(JSON.stringify({ symbol, side, result: "PLAN_READY", netRR: plan.netRR }));
        } catch (error) {
          console.log(JSON.stringify({ symbol, side, error: error instanceof Error ? error.stack : String(error) }));
        }
      }
    } catch (error) { console.log(JSON.stringify({ symbol, error: String(error) })); }
  }
}
main().catch(() => { console.error("READINESS_CHECK_FAILED"); process.exitCode = 1; });
