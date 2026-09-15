"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Signal, SymbolName } from "@/lib/domain";
import { STRATEGY_VERSION } from "@/lib/domain";
import { LIVE_SYMBOLS } from "@/lib/live-market";
import { nextScanAt, scanCandle, signalAlert } from "@/lib/signal-alerts";
import { api, errorMessage, messages } from "./api";
import { signalProgress } from "@/lib/signal-progress";
import type { SignalMode } from "@/lib/signal-policy";
import { autoEntryRequest } from "@/lib/auto-entry";

const preference = "sinyallab-signal-monitor";
const autoPreference = "sinyallab-auto-paper-entry";
function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* In-memory operation still works. */ } }
type Result = { symbol: SymbolName; signal?: Signal; error?: string };
export function SignalMonitor({ signals, aiReady, mode, now, onSignal, onEntry, hasPositions }: { signals: Signal[]; aiReady: boolean; mode: SignalMode; now: number; onSignal: (signal: Signal) => void; onEntry: () => void; hasPositions: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [autoEntry, setAutoEntry] = useState(false);
  const [autoExit, setAutoExit] = useState(false);
  const [exitNote, setExitNote] = useState("");
  const [entryNotes, setEntryNotes] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [alerts, setAlerts] = useState<Signal[]>([]);
  const [permission, setPermission] = useState("default");
  const [note, setNote] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const trigger = useRef<() => void>(() => {});
  const initialSignals = useRef(signals);
  const publish = useRef(onSignal);
  const refresh = useRef(onEntry);
  useEffect(() => { refresh.current = onEntry; }, [onEntry]);
  useEffect(() => { initialSignals.current = signals; publish.current = onSignal; }, [signals, onSignal]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setEnabled(read(preference) !== "off");
      setAutoEntry(read(autoPreference) !== "off");
      setAutoExit(read("sinyallab-auto-paper-exit") !== "off");
      setPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!autoExit || !hasPositions) return;
    let stopped = false, running = false;
    const check = async () => {
      if (stopped || running || read("sinyallab-auto-paper-exit") === "off") return;
      running = true;
      try {
        await api("positions/auto-exit", "POST", {});
        if (!stopped) { setExitNote("Pemeriksaan exit selesai; hasil posisi dimuat ulang."); refresh.current(); }
      } catch (error) { if (!stopped) setExitNote(`Exit belum terkonfirmasi: ${errorMessage(error)}`); }
      finally { running = false; }
    };
    const run = () => {
      if (navigator.locks) void navigator.locks.request("sinyallab-auto-exit", { ifAvailable: true }, async lock => { if (lock) await check(); });
      else void check();
    };
    const initial = setTimeout(run, 0), interval = setInterval(run, 60000);
    return () => { stopped = true; clearTimeout(initial); clearInterval(interval); };
  }, [autoExit, hasPositions]);
  useEffect(() => {
    if (enabled === null) return;
    let stopped = false, running = false, lastStarted = 0;
    const seen = new Set<string>();
    const completed = new Map<string, number>();
    const attempted = new Set<string>();
    async function enter(signal: Signal) {
      if (stopped || !autoEntry || read(autoPreference) === "off" || read(preference) === "off") return;
      const request = autoEntryRequest(signal, Date.now(), mode);
      if (!request || attempted.has(signal.id)) return;
      attempted.add(signal.id);
      const status = (message: string) => { if (!stopped) setEntryNotes(rows => ({ ...rows, [signal.symbol]: message })); };
      status(`${signal.symbol}: mengirim entry paper ${signal.side}…`);
      try {
        await api("positions", "POST", request.body, request.key);
        status(`${signal.symbol}: entry paper ${signal.side} berhasil. Lihat Posisi paper.`);
        refresh.current();
      } catch (error) {
        status(`${signal.symbol}: entry belum dikonfirmasi — ${errorMessage(error)}`);
        // A timeout may occur after commit. Refresh instead of assuming failure/success.
        refresh.current();
      }
    }
    async function notify(signal: Signal) {
      const alert = signalAlert(signal, Date.now());
      if (!alert || stopped) return;
      setAlerts(previous => [signal, ...previous.filter(s => s.id !== signal.id)].slice(0, 8));
      const storageKey = `sinyallab-alert-${signal.symbol}-${signal.side}-${alert.confirmed ? "ai" : "technical"}`;
      if (seen.has(alert.key) || read(storageKey) === alert.key) return;
      seen.add(alert.key); save(storageKey, alert.key);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const notification = new Notification(alert.title, { body: alert.body, tag: alert.key });
          notification.onclick = () => { window.focus(); window.location.assign(`/signals/${signal.id}`); notification.close(); };
        } catch { setNote("Notifikasi sistem tidak didukung browser ini. Notifikasi tetap muncul di panel."); }
      }
    }
    async function scan(force = false) {
      if (stopped || running || !enabled || read(preference) === "off") return;
      if (Date.now() - lastStarted < 60000) {
        if (force) setNote("Scan terakhir baru selesai. Tunggu satu menit sebelum scan ulang; pemantauan tetap aktif.");
        return;
      }
      // Web Locks coordinates open tabs; server leases also serialize each symbol.
      const work = async () => {
        if (stopped) return;
        running = true; lastStarted = Date.now();
        const candle = scanCandle(Date.now());
        try {
          for (const symbol of LIVE_SYMBOLS) {
            if (stopped) break;
            const key = `sinyallab-scan-${STRATEGY_VERSION}-${symbol}`;
            const latest = initialSignals.current.find(s => s.symbol === symbol && !s.strategyVersion.startsWith("manual-"));
            const done = Number(read(key)) >= candle || (completed.get(symbol) ?? 0) >= candle;
            if (!force && done) { if (latest) { setResults(rows => [...rows.filter(r => r.symbol !== symbol), { symbol, signal: latest }]); await notify(latest); await enter(latest); } continue; }
            setScanning(symbol);
            try {
              const signal = await api<Signal>("analysis", "POST", { symbol });
              if (stopped) break;
              completed.set(symbol, signal.candleEndAt); save(key, String(signal.candleEndAt));
              setResults(rows => [...rows.filter(r => r.symbol !== symbol), { symbol, signal }]);
              publish.current(signal); await notify(signal); await enter(signal);
            } catch (error) {
              if (!stopped) setResults(rows => [...rows.filter(r => r.symbol !== symbol), { symbol, error: errorMessage(error) }]);
            }
          }
        } finally { running = false; if (!stopped) { setScanning(""); setNext(nextScanAt(Date.now())); } }
      };
      if (navigator.locks) await navigator.locks.request("sinyallab-signal-scan", { ifAvailable: true }, async lock => { if (lock) await work(); });
      else await work();
    }
    trigger.current = () => { void scan(true); };
    const initial = setTimeout(() => { setNext(nextScanAt(Date.now())); if (enabled) void scan(); }, 0);
    const interval = setInterval(() => { if (enabled) void scan(); }, 30000);
    const resume = () => { if (document.visibilityState === "visible" && enabled) void scan(); };
    document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; trigger.current = () => {}; clearTimeout(initial); clearInterval(interval); document.removeEventListener("visibilitychange", resume); };
  }, [enabled, autoEntry, mode]);
  async function requestPermission() {
    if (!("Notification" in window)) { setPermission("unsupported"); return; }
    try { setPermission(await Notification.requestPermission()); }
    catch { setNote("Izin notifikasi perangkat gagal. Notifikasi di panel tetap aktif."); }
  }
  return <section className="panel signal-monitor" aria-label="Pemantau sinyal">
    <div className="panel-heading">
      <div><h2>Pemantau sinyal LONG / SHORT</h2><p>{enabled ? "Aktif otomatis" : "Dijeda"} · BTC, ETH, SOL, BNB, XRP · candle 15 menit</p></div>
      <span className={`badge ${enabled ? "green" : ""}`}>{scanning && enabled ? `Analisis ${scanning}` : enabled ? "MEMANTAU" : "JEDA"}</span>
    </div>
    <div className="monitor-body">
      <p>{mode === "TECHNICAL" ? "Mode teknikal tanpa AI: kandidat yang lolos tren, volume, breakout dan risiko dapat dibuka sebagai simulasi." : aiReady ? "Analisis teknikal + review AI aktif (mengikuti kuota harian)." : "Review AI belum tersedia. Mode ini menunggu konfirmasi AI sebelum entry."}</p>
      <p>Pemantauan berjalan selama aplikasi terbuka; tab tertidur atau ditutup dapat menghentikannya. Entry otomatis hanya simulasi, bukan order exchange. WAIT tidak dipaksa menjadi entry.</p>
      <p>Auto-close SL/TP paper: {autoExit ? "AKTIF" : "JEDA"}. Diperiksa tiap 60 detik selama aplikasi terbuka, terpisah dari jeda entry. Fill memakai harga terbaru, bukan jaminan harga stop/target; sentuhan harga di antara pemeriksaan bisa terlewat. Jeda tidak membatalkan permintaan yang sudah terkirim.</p>
      <button onClick={() => { const value = !autoExit; save("sinyallab-auto-paper-exit", value ? "on" : "off"); setAutoExit(value); }}>{autoExit ? "Jeda auto-close paper" : "Aktifkan auto-close paper"}</button>
      {exitNote && <p role="status">{exitNote}</p>}
      <p role="status">{autoEntry && enabled ? `Entry paper otomatis AKTIF — ${mode === "TECHNICAL" ? "setelah lolos analisis teknikal" : "setelah konfirmasi AI"}. Server memeriksa ulang harga dan risiko sebelum entry.` : "Entry paper otomatis dijeda (memerlukan pemantauan aktif)."}</p>
      <div className="monitor-actions">
        <button disabled={enabled === null} onClick={() => { const value = !enabled; save(preference, value ? "on" : "off"); setEnabled(value); setScanning(""); }}>{enabled ? "Jeda pemantauan" : "Aktifkan pemantauan"}</button>
        <button disabled={!enabled || !!scanning} onClick={() => trigger.current()}>Scan sinyal sekarang</button>
        <button disabled={enabled === null} onClick={() => { const value = !autoEntry; save(autoPreference, value ? "on" : "off"); setAutoEntry(value); }}>{autoEntry ? "Jeda entry paper otomatis" : "Aktifkan entry paper otomatis"}</button>
        <button disabled={permission === "granted" || permission === "unsupported"} onClick={() => void requestPermission()}>{permission === "granted" ? "Notifikasi perangkat aktif" : "Aktifkan notifikasi perangkat"}</button>
      </div>
      {permission === "denied" && <p>Izin notifikasi diblokir. Ubah izin situs di browser untuk menerima notifikasi perangkat; panel tetap bekerja.</p>}
      {permission === "unsupported" && <p>Browser ini memakai notifikasi di dalam aplikasi.</p>}
      {note && <p role="status">{note}</p>}
      <div aria-live="polite">{Object.entries(entryNotes).map(([symbol, message]) => <p key={symbol}>{message}</p>)}</div>
      {enabled && next && <p className="subtle">Candle berikutnya diperiksa mulai {new Date(next).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Scan gagal dicoba lagi setelah jeda.</p>}
      <div className="signal-alert-list" aria-live="polite" aria-relevant="additions">
        {alerts.filter(s => s.expiresAt > now).map(s => {
          const alert = signalAlert(s, now);
          return alert && <article key={s.id} className={`signal-notification ${s.side === "LONG" ? "signal-long" : "signal-short"}`}>
            <strong>{alert.title}</strong><p>{alert.body}</p><Link href={`/signals/${s.id}`}>Lihat analisis & rencana ↗</Link>
          </article>;
        })}
      </div>
      {!alerts.length && <p className="subtle">Belum ada notifikasi kandidat baru. Hasil WAIT tetap ditampilkan di bawah.</p>}
      {!!results.length && <div className="monitor-results">{LIVE_SYMBOLS.map(symbol => {
        const row = results.find(r => r.symbol === symbol); if (!row) return null;
        const alert = row.signal && signalAlert(row.signal, now);
        const reasons = row.signal?.baseline?.reasons ?? [];
        return <div key={symbol}><strong>{symbol}</strong><span>{row.error ?? (alert ? alert.title : (row.signal && signalProgress(row.signal)) || reasons.map(r => messages[r] ?? r).join(" ") || "WAIT — belum ada persetujuan entry.")}</span>{row.signal && <Link href={`/signals/${row.signal.id}`}>Detail ↗</Link>}</div>;
      })}</div>}
    </div>
  </section>;
}
