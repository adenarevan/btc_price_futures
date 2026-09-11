import fixture from "../fixtures/accounting.json";
import { D } from "../src/lib/decimal";
import { marginEstimate } from "../src/lib/engine";
// Accounting replay is deliberately never eligible for a research gate.
for (const side of ["long", "short"] as const) {
  const d = side === "long" ? 1 : -1,
    f = fixture[side],
    gross = D(fixture.qty).mul(D(f.exit).sub(fixture.entry)).mul(d),
    funding = D(fixture.qty)
      .mul(fixture.eventMark)
      .mul(fixture.settledRate)
      .mul(-d),
    net = gross
      .sub(fixture.entryFee)
      .sub(D(fixture.qty).mul(f.exit).mul(fixture.feeRate))
      .add(funding);
  if (!net.eq(f.netPnl)) throw new Error("FIXTURE_MISMATCH");
  console.log(
    JSON.stringify({
      label: "DEMO",
      side,
      netPnl: net.toFixed(),
      finalEquity: D(fixture.equity).add(net).toFixed(),
      status: "NOT_TESTED",
    }),
  );
}
console.log(
  JSON.stringify({
    model: marginEstimate("LONG", "1", "100", "20", "100"),
    limitation:
      "Accounting fixture only; historical strategy replay requires a validated dataset and execution harness.",
  }),
);
