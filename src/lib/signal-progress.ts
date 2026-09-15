import { D } from "./decimal";
import type { Signal } from "./domain";
export function signalProgress(s: Signal) {
  const evidence = s.baseline?.evidence, reasons = s.baseline?.reasons ?? [];
  if (!evidence) return null;
  try {
    if (reasons.includes("VOLUME_FILTER") && evidence["volume.ratio"]?.value != null)
      return `Volume baru ${D(String(evidence["volume.ratio"].value)).toFixed(2)}× rata-rata; syaratnya ${D(String(evidence["volume.required"]?.value ?? "1")).toFixed(2)}×. Belum ada pemicu entry.`;
    if (reasons.includes("TREND_BREAKOUT_FILTER") && evidence["breakout.upper"] && evidence["trigger.close"]) {
      const long = evidence["gate.trendLong"]?.value === true;
      const short = evidence["gate.trendShort"]?.value === true;
      if (!long && !short) return "Tren EMA belum searah; belum ada setup entry.";
      const bound = evidence[long ? "breakout.upper" : "breakout.lower"]?.value;
      return `Tren ${long ? "naik" : "turun"}, tetapi candle ditutup di ${evidence["trigger.close"]?.value}. Pemicu ${long ? "LONG di atas" : "SHORT di bawah"} ${bound}. Belum ada entry.`;
    }
  } catch { return null; }
  return null;
}
