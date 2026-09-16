import { D } from "./decimal";
import type { Signal } from "./domain";
export function signalProgress(s: Signal) {
  if (s.decision === "WAIT" && s.baseline?.decision !== "WAIT" && s.baseline?.plan) {
    if (s.reviewStatus === "INVALID") {
      const reason = s.reviewFailureCode?.startsWith("HTTP_") ? "layanan AI menolak permintaan" : s.reviewFailureCode === "REQUEST" ? "koneksi atau waktu respons AI bermasalah" : "jawaban review AI tidak valid";
      return `WAIT — ${reason}. Kandidat teknikal belum disetujui; entry dan email belum dipicu.`;
    }
    if (s.reviewStatus === "QUOTA_EXHAUSTED") return "WAIT — kuota review AI habis. Kandidat belum disetujui.";
    if (s.reviewStatus === "ACCOUNT_CHANGED") return "WAIT — akun berubah saat analisis. Jalankan scan ulang.";
    return "WAIT — kandidat teknikal belum mendapat konfirmasi AI. Belum ada entry atau email sinyal.";
  }
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
