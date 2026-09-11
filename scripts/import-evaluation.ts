import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluateReport } from "../src/lib/evaluation";
import { getDb } from "../src/lib/firebase/admin";
import { getConfig } from "../src/lib/config";
import { encode } from "../src/lib/repository";
import { loadEnvironment } from "./private-cli";
async function main() {
  loadEnvironment();
  const input = process.argv[2];
  if (!input) throw new Error("INPUT_FILE_REQUIRED");
  const raw = readFileSync(input, "utf8"),
    report = evaluateReport(JSON.parse(raw));
  // Each referenced data/sensitivity artifact must be locally provided and match its SHA-256.
  const files = process.argv.slice(3).filter((a) => a !== "--save"),
    hashes = new Set(
      files.map((file) =>
        createHash("sha256").update(readFileSync(file)).digest("hex"),
      ),
    );
  if (
    report.arms.some(
      (a) =>
        !hashes.has(a.datasetHash) ||
        !a.sensitivityEvidenceHash ||
        !hashes.has(a.sensitivityEvidenceHash),
    )
  )
    throw new Error("PROVENANCE_ARTIFACTS_REQUIRED");
  const output = {
    ...report,
    sourceHash: createHash("sha256").update(raw).digest("hex"),
    accountId: "paper-futures-v1",
    createdAt: Date.now(),
    warning:
      "Research gate is not a profit guarantee or permission for real money.",
  };
  if (process.argv.includes("--save")) {
    const c = getConfig();
    if (!c.OWNER_UID) throw new Error("OWNER_REQUIRED");
    await getDb()
      .doc(`users/${c.OWNER_UID}/evaluations/${report.id}`)
      .create(encode(output) as Record<string, unknown>);
  }
  console.log(JSON.stringify(output, null, 2));
}
main().catch(() => {
  console.error(
    "Evaluation import rejected: verify strict schema, provenance artifacts and owner configuration.",
  );
  process.exitCode = 1;
});
