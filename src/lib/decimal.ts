import Decimal from "decimal.js";
import { EngineError } from "./domain";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export { Decimal };
export function D(value: Decimal.Value): Decimal {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error("non-finite");
    return result;
  } catch {
    throw new EngineError("DATA_INVALID", "Angka desimal tidak valid.");
  }
}
export function decimal(value: Decimal.Value): string {
  return D(value).toFixed();
}
export function positive(value: Decimal.Value): Decimal {
  const result = D(value);
  if (!result.gt(0))
    throw new EngineError(
      "DATA_INVALID",
      "Harga atau kuantitas harus positif.",
    );
  return result;
}
export function floorToStep(
  value: Decimal.Value,
  step: Decimal.Value,
): Decimal {
  return D(value).div(positive(step)).floor().mul(step);
}
export function ceilToStep(value: Decimal.Value, step: Decimal.Value): Decimal {
  return D(value).div(positive(step)).ceil().mul(step);
}
export function sum(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.add(D(value)), D(0));
}
export function min(...values: Decimal.Value[]): Decimal {
  return Decimal.min(...values.map(D));
}
export function max(...values: Decimal.Value[]): Decimal {
  return Decimal.max(...values.map(D));
}
