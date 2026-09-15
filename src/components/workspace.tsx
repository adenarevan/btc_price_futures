"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { D } from "@/lib/decimal";
import type {
  AccountSummary,
  PaperAccount,
  Position,
  Signal,
  SymbolName,
  TradingSettings,
  TradePlan,
} from "@/lib/domain";
import { api, errorMessage, messages } from "./api";
import { useLiveMarket } from "./use-live-market";
import { SignalMonitor } from "./signal-monitor";
import { signalProgress } from "@/lib/signal-progress";
import type { SignalMode } from "@/lib/signal-policy";
import { fresh, quoteFresh, estimatePositionNet, type LiveQuote } from "@/lib/live-market";
type ManualInput = { symbol: SymbolName; side: "LONG" | "SHORT" };
type Dashboard = {
  account: PaperAccount;
  positions: Position[];
  summary: AccountSummary;
  signals: Signal[];
  settings: TradingSettings;
  usage: { reserved: number };
  demo: boolean;
  aiReady: boolean;
  signalMode: SignalMode;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type RecordData = Record<string, unknown>;
const nav = [
  ["dashboard", "◫", "Ringkasan"],
  ["signals", "⌁", "Sinyal"],
  ["positions", "⇄", "Posisi paper"],
  ["journal", "≡", "Jurnal"],
  ["evaluation", "◎", "Evaluasi"],
  ["settings", "⚙", "Pengaturan"],
  ["system", "⎈", "Sistem"],
] as const;
const titles: Record<string, string> = {
  dashboard: "Ringkasan workspace",
  signals: "Kandidat & keputusan",
  positions: "Posisi paper",
  journal: "Jurnal simulasi",
  evaluation: "Evaluasi strategi",
  settings: "Pengaturan eksperimen",
  system: "Kesehatan sistem",
  "signal-detail": "Detail kandidat",
};
const watchlist: Array<{
  symbol: SymbolName;
  name: string;
  icon: string;
  tone: string;
}> = [
  { symbol: "BTCUSDT", name: "Bitcoin", icon: "₿", tone: "btc" },
  { symbol: "ETHUSDT", name: "Ethereum", icon: "Ξ", tone: "eth" },
  { symbol: "SOLUSDT", name: "Solana", icon: "S", tone: "sol" },
  { symbol: "BNBUSDT", name: "BNB", icon: "◆", tone: "bnb" },
  { symbol: "XRPUSDT", name: "XRP", icon: "X", tone: "xrp" },
];
function money(value: string | null | undefined, places = 2) {
  if (value === undefined || value === null) return "—";
  try {
    const [whole, fraction] = D(value).toFixed(places).split(".");
    return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
  } catch {
    return "—";
  }
}
function when(at: unknown) {
  return typeof at === "number"
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(at)
    : "Belum diperiksa";
}
function Tag({ value }: { value: string }) {
  return (
    <span
      className={`badge ${value.includes("LONG") || value === "ACTIVE" ? "green" : value.includes("SHORT") || value.includes("FAILED") ? "red" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty">
      <span className="empty-icon">◎</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function Metric({
  label,
  value,
  unit = "USDT",
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <article className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-note">{note}</div>
    </article>
  );
}
export function Workspace({ section, id }: { section: string; id?: string }) {
  const { quotes: market, status: streamStatus, error: marketError, refresh: loadMarket } = useLiveMarket(section === "dashboard" || section === "positions");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [signals, setSignals] = useState<Signal[]>([]),
    [positions, setPositions] = useState<Position[]>([]),
    [records, setRecords] = useState<RecordData[]>([]),
    [detail, setDetail] = useState<Signal | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(() => Date.now()),
    [confirm, setConfirm] = useState<{
      kind: "open" | "close" | "manual";
      signal?: Signal;
      position?: Position;
      manual?: { symbol: SymbolName; side: "LONG" | "SHORT" };
      preview?: TradePlan;
      key: string;
    } | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await api<Dashboard>("dashboard");
      setDashboard(d);
      if (section === "signals") {
        const page = await api<Page<Signal>>(
          `signals${filter ? `?decision=${filter}` : ""}`,
        );
        setSignals(page.items);
        setCursor(page.nextCursor);
      } else if (section === "positions") {
        const page = await api<Page<Position>>("positions");
        setPositions(page.items);
        setCursor(page.nextCursor);
      } else if (section === "signal-detail" && id)
        setDetail(await api<Signal>(`signals/${id}`));
      else if (["journal", "evaluation", "system"].includes(section)) {
        const path =
          section === "system"
            ? "system/runs"
            : section === "evaluation"
              ? "evaluations"
              : "journal";
        const page = await api<Page<RecordData>>(path);
        setRecords(page.items);
        setCursor(page.nextCursor);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [section, id, filter]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function action(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function scan(symbol: SymbolName) {
    await action(async () => {
      const result = await api<Signal>("analysis", "POST", { symbol });
      setDetail(result);
    }, "Analisis selesai dan keputusan tersimpan.");
  }
  async function previewManual(manual: ManualInput) {
    await action(async () => {
      const preview = await api<{ plan: TradePlan }>(`manual-positions/preview?symbol=${manual.symbol}&side=${manual.side}`);
      setConfirm({ kind: "manual", manual, preview: preview.plan, key: crypto.randomUUID() });
    }, "Preview siap. Periksa angka sebelum membuka posisi.");
  }
  async function commit() {
    if (!confirm) return;
    const done = await action(
      () =>
        confirm.kind === "open"
          ? api(
              "positions",
              "POST",
              {
                signalId: confirm.signal!.id,
                leverage: confirm.signal!.plan!.leverage,
              },
              confirm.key,
            )
          : confirm.kind === "manual"
            ? api("manual-positions", "POST", confirm.manual, confirm.key)
          : api(
              `positions/${confirm.position!.id}/close`,
              "POST",
              {},
              confirm.key,
            ),
      "Hasil operasi tersimpan. Periksa status posisi dan jurnal.",
    );
    if (done) {
      setConfirm(null);
      if (confirm.kind === "manual" || confirm.kind === "open")
        setNotice("Posisi paper berhasil dibuka. Estimasi P&L mengikuti harga live di dashboard dan Posisi paper.");
    }
  }
  async function more() {
    if (!cursor) return;
    const path =
      section === "signals"
        ? "signals"
        : section === "positions"
          ? "positions"
          : section === "system"
            ? "system/runs"
            : section === "evaluation"
              ? "evaluations"
              : "journal";
    await action(async () => {
      const page = await api<Page<RecordData>>(
        `${path}?cursor=${cursor}${filter ? `&decision=${filter}` : ""}`,
      );
      if (section === "signals")
        setSignals((s) => [...s, ...(page.items as unknown as Signal[])]);
      else if (section === "positions")
        setPositions((s) => [...s, ...(page.items as unknown as Position[])]);
      else setRecords((s) => [...s, ...page.items]);
      setCursor(page.nextCursor);
    }, "Halaman berikutnya dimuat.");
  }
  const summary = dashboard?.summary;
  const liveEquity = summary && dashboard ? dashboard.positions.filter(p => p.status === "OPEN").reduce((equity, p) => {
    const quote = market.find(q => q.symbol === p.symbol);
    return quote?.mark && fresh(quote.markAt, now) ? equity.add(D(quote.mark).sub(p.lastMark).mul(p.qty).mul(p.side === "LONG" ? 1 : -1)) : equity;
  }, D(summary.paperEquity)).toFixed() : undefined;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-icon">
            S<span>↗</span>
          </span>
          <span>
            SinyalLab<span className="brand-sub">FUTURES RESEARCH</span>
          </span>
        </Link>
        <div className="sidebar-label">WORKSPACE</div>
        <nav>
          {nav.map(([href, icon, label]) => (
            <Link
              key={href}
              href={`/${href}`}
              className={
                section === href ||
                (section === "signal-detail" && href === "signals")
                  ? "nav-item active"
                  : "nav-item"
              }
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {href === "positions" && (
                <small>{summary?.positionsCount ?? 0}</small>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="research-note">
            <span className="dot" /> PAPER RESEARCH
            <p>
              Observasi pasar.
              <br />
              Uji asumsi dengan data.
            </p>
            <span className="badge">NOT TESTED</span>
          </div>
          <Link href="/account/password" className="account-link">
            <span className="avatar">A</span>
            <span>
              Admin<small>Akun pemilik</small>
            </span>
            <span>↗</span>
          </Link>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <span className="subtle">Workspace</span>
            <span className="divider">/</span>
            <strong>{titles[section]}</strong>
          </div>
          <div className="topbar-status">
            <span className="dot" />
            <span>Mode manual</span>
            <span className="badge">SIMULASI</span>
            <button
              className="plain"
              onClick={() =>
                void action(async () => {
                  await api("auth/logout", "POST", {});
                  window.location.assign("/login");
                }, "")
              }
              disabled={busy}
            >
              Keluar ↗
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                USDT LINEAR PERPETUAL <span className="tiny-separator">/</span>{" "}
                ISOLATED · ONE WAY
              </div>
              <h1>{titles[section]}</h1>
              <p>
                {section === "dashboard"
                  ? "Amati kandidat, kelola risiko, dan pelajari hasil eksperimen."
                  : "Seluruh keputusan dan hasil berasal dari eksperimen simulasi."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void action(
                    () => api("positions/refresh", "POST", {}),
                    "Pemeriksaan risiko selesai. Periksa status data dan funding.",
                  )
                }
              >
                ↻ Refresh risiko
              </button>
              {section === "dashboard" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void scan("BTCUSDT")}
                >
                  {busy ? "Memproses…" : "Analisis BTCUSDT"} ↗
                </button>
              )}
            </div>
          </div>
          {dashboard?.demo && (
            <div className="notice">
              DEMO · Fixture lokal sintetis. Tidak termasuk bukti evaluasi
              strategi.
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {(section === "dashboard" || section === "positions") && <div className="live-feed-bar" data-testid="live-feed" data-status={streamStatus}>
            <span className={`badge ${streamStatus === "LIVE" ? "green" : ""}`}>{streamStatus === "LIVE" ? "● LIVE" : streamStatus === "POLLING" ? "Pembaruan cadangan · 10 detik" : streamStatus === "PAUSED" ? "Dijeda" : "Menghubungkan harga…"}</span>
            <span>Harga & estimasi P&L otomatis. Funding dan model risiko mengikuti pemeriksaan terakhir.</span>
          </div>}
          {dashboard && <SignalMonitor signals={dashboard.signals} aiReady={dashboard.aiReady} mode={dashboard.signalMode ?? "AI"} now={now}
            onEntry={() => { void load(); }}
            hasPositions={dashboard.positions.some(p => p.status === "OPEN")}
            onSignal={signal => setDashboard(current => current ? { ...current, signals: [signal, ...current.signals.filter(s => s.id !== signal.id)].slice(0, 25) } : current)} />}
          {loading ? (
            <div className="panel loading" aria-live="polite">
              Memuat workspace…
            </div>
          ) : !dashboard ? (
            <section className="panel details-body">
              <h2>Data workspace gagal dimuat</h2>
              <p>Belum ada data yang dapat ditampilkan. Coba muat ulang koneksi.</p>
              <button disabled={busy} onClick={() => { setError(""); void load(); }}>Muat ulang workspace</button>
              <Link href="/login" className="text-link"> Kembali ke login</Link>
            </section>
          ) : section === "dashboard" ? (
            <>
              <div className="metrics">
                <Metric
                  label="Estimasi paper equity"
                  value={money(liveEquity)}
                  note="Mark P&L mengikuti harga terbaru; funding tercatat"
                />
                <Metric
                  label="Collateral tersedia"
                  value={money(summary?.availableCollateral)}
                  note="Tersedia untuk initial margin + fee"
                />
                <Metric
                  label="Initial margin terikat"
                  value={money(summary?.initialMarginLocked)}
                  note="Batas total 20% equity"
                />
                <Metric
                  label="Gross exposure"
                  value={money(summary?.grossExposure)}
                  note={`${summary?.positionsCount ?? 0} dari 2 posisi simulasi`}
                />
              </div>
              <ManualExperiment
                busy={busy}
                settings={dashboard.settings}
                onOpen={(manual) => void previewManual(manual)}
              />
              {!dashboard.aiReady && <p className="notice">{dashboard.signalMode === "TECHNICAL" ? "Mode teknikal tanpa token AI. Kandidat yang lolos semua filter bisa dikonfirmasi untuk membuka posisi paper." : "Mode review AI dipilih, tetapi AI belum tersedia. Kandidat belum dapat disetujui untuk entry strategi."}</p>}
              {!!dashboard.positions.length && (
                <section className="panel">
                  <div className="panel-heading"><h2>Posisi kamu</h2><Link href="/positions">Lihat semua posisi ↗</Link></div>
                  <div className="position-list">{dashboard.positions.map((p) => (
                    <PositionCard key={p.id} p={p} now={now} busy={busy} quote={market.find(q => q.symbol === p.symbol)}
                      onClose={() => setConfirm({ kind: "close", position: p, key: crypto.randomUUID() })} />
                  ))}</div>
                </section>
              )}
              {detail && <section className="panel details-body" role="status">
                <h2>Hasil analisis {detail.symbol}: {detail.decision === "WAIT" ? "Tunggu setup" : detail.decision}</h2>
                <p>{signalReason(detail)}</p>
                <Link href={`/signals/${detail.id}`}>Lihat rincian analisis ↗</Link>
              </section>}
              <div className="dashboard-grid">
                <section className="panel market-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Market watch</h2>
                      <p>Lima kontrak. Satu eksperimen terukur.</p>
                    </div>
                    <Tag value="FUTURES" />
                  </div>
                  <div className="market-cards">
                    {watchlist.map(({ symbol, name, icon, tone }) => {
                      const latest = dashboard?.signals.find(
                          (s) => s.symbol === symbol,
                        ),
                        quote = market.find((q) => q.symbol === symbol),
                        stale = !fresh(quote?.markAt, now);
                      return (
                        <article className="market-card" key={symbol}>
                          <div className="market-title">
                            <span
                              className={`coin ${tone}`}
                            >
                              {icon}
                            </span>
                            <div>
                              <h3>{symbol}</h3>
                              <span>
                                {name} perpetual
                              </span>
                            </div>
                            <span className="subtle">USDT</span>
                          </div>
                          <div className="market-price" data-testid={`price-${symbol}`} data-updated-at={quote?.markAt}>
                            <span key={quote?.mark} className={stale ? "" : `price-tick tick-${quote?.movement ?? "flat"}`}>
                              {money(quote?.mark, symbol === "XRPUSDT" ? 4 : 2)}
                              {!stale && <span className="tick-arrow" aria-label={quote?.movement === "up" ? "Harga naik" : quote?.movement === "down" ? "Harga turun" : "Harga tetap"}>{quote?.movement === "up" ? " ↑" : quote?.movement === "down" ? " ↓" : ""}</span>}
                            </span>
                            <small>{stale ? "Harga tertunda · menghubungkan ulang" : "Mark price · Binance Futures"}</small>
                          </div>
                          <div className="mini-grid">
                            <div>
                              Bid{" "}
                              <strong>{money(quote?.bid, symbol === "XRPUSDT" ? 4 : 2)}</strong>
                            </div>
                            <div>
                              Ask{" "}
                              <strong>{money(quote?.ask, symbol === "XRPUSDT" ? 4 : 2)}</strong>
                            </div>
                          </div>
                          <div className="market-state">
                            <Tag
                              value={latest?.decision ?? "BELUM DIANALISIS"}
                            />
                            <span>{when(latest?.createdAt)}</span>
                          </div>
                          <p className="market-explanation">Update harga: {quote?.markAt ? new Date(quote.markAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) : "menunggu data"} WIB</p>
                          <p className="market-explanation">{latest ? signalReason(latest) : "Klik Analisis untuk memeriksa peluang. Latihan paper bisa dimulai dari panel di atas."}</p>
                          <button
                            disabled={busy}
                            onClick={() => void scan(symbol)}
                          >
                            Analisis {symbol} <span>↗</span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  <div className="panel-foot">
                    <span className="dot muted" /> Harga dan estimasi P&L mengikuti stream. Refresh risiko untuk settlement funding dan pemeriksaan model.
                    <button onClick={() => void loadMarket()}>Muat ulang harga</button>
                  </div>
                  {marketError && <p className="error" role="alert">{marketError}</p>}
                </section>
                <section className="panel process-panel">
                  <div className="panel-heading">
                    <h2>Alur keputusan</h2>
                    <span className="subtle">01 — 04</span>
                  </div>
                  <ol className="process">
                    <li>
                      <span>01</span>
                      <div>
                        <h3>Validasi pasar</h3>
                        <p>Candle tertutup, spread, metadata dan freshness.</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>Strategi & risiko</h3>
                        <p>
                          Breakout / breakdown, sizing dan margin oleh engine.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>Review AI</h3>
                        <p>
                          Konfirmasi kandidat atau WAIT dari fakta tersedia.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>04</span>
                      <div>
                        <h3>Keputusan kamu</h3>
                        <p>Konfirmasi sebelum membuka simulasi.</p>
                      </div>
                    </li>
                  </ol>
                  <div className="quota">
                    <span>Review AI hari ini</span>
                    <strong>
                      {dashboard?.usage.reserved ?? 0}{" "}
                      <small>
                        / {dashboard?.settings.dailyAiReviewLimit ?? 12}
                      </small>
                    </strong>
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Keputusan terbaru</h2>
                    <p>WAIT juga merupakan hasil yang sah.</p>
                  </div>
                  <Link className="text-link" href="/signals">
                    Lihat semua ↗
                  </Link>
                </div>
                <SignalTable items={dashboard?.signals.slice(0, 5) ?? []} />
              </section>
            </>
          ) : section === "signals" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Riwayat sinyal</h2>
                <label className="inline-label">
                  Keputusan
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">Semua</option>
                    <option value="LONG_CANDIDATE">LONG</option>
                    <option value="SHORT_CANDIDATE">SHORT</option>
                    <option value="WAIT">WAIT</option>
                  </select>
                </label>
              </div>
              <SignalTable items={signals} />
            </section>
          ) : section === "signal-detail" && detail ? (
            <SignalDetail
              signal={detail}
              busy={busy}
              onOpen={() =>
                setConfirm({
                  kind: "open",
                  signal: detail,
                  key: crypto.randomUUID(),
                })
              }
            />
          ) : section === "positions" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Posisi & settlement</h2>
                <Tag value="SIMULASI" />
              </div>
              {positions.length ? (
                <div className="position-list">
                  {positions.map((p) => (
                    <PositionCard
                      key={p.id}
                      p={p}
                      quote={market.find(q => q.symbol === p.symbol)}
                      now={now}
                      busy={busy}
                      onClose={() =>
                        setConfirm({
                          kind: "close",
                          position: p,
                          key: crypto.randomUUID(),
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title="Belum ada posisi"
                  description="Analisis kandidat, baca rencana risiko, lalu konfirmasi untuk membuka simulasi."
                />
              )}
            </section>
          ) : section === "settings" && dashboard ? (
            <SettingsForm
              settings={dashboard.settings}
              busy={busy}
              onSave={(changes) =>
                action(
                  () => api("settings", "PATCH", changes),
                  "Pengaturan tersimpan untuk posisi baru.",
                )
              }
            />
          ) : section === "evaluation" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Bukti sebelum kesimpulan</h2>
                <Tag
                  value={
                    records.length
                      ? String(records[0]?.status ?? "INSUFFICIENT_DATA")
                      : "NOT_TESTED"
                  }
                />
              </div>
              <div className="evaluation-intro">
                <span className="empty-icon">◎</span>
                <h2>
                  {records.length
                    ? "Laporan eksperimen tersimpan"
                    : "Strategi belum teruji"}
                </h2>
                <p>
                  Kelulusan teknis aplikasi terpisah dari kelulusan ekonomi
                  strategi. Semua biaya, settlement funding, periode uji, dan
                  versi harus dapat ditelusuri.
                </p>
              </div>
              <div className="gate-grid">
                <div>
                  <strong>180 hari / 100 posisi</strong>
                  <span>Minimum baseline holdout</span>
                </div>
                <div>
                  <strong>60 hari / 30 per arm</strong>
                  <span>Minimum forward baseline + agent</span>
                </div>
                <div>
                  <strong>PF ≥ 1,20 / DD ≤ 10%</strong>
                  <span>Ambang eksperimen internal</span>
                </div>
              </div>
              {records.map((r, i) => (
                <details key={String(r.id ?? i)}>
                  <summary>
                    {String(r.id)} · {String(r.status)}
                  </summary>
                  <pre>{JSON.stringify(r, null, 2)}</pre>
                </details>
              ))}
              <div className="panel-foot">
                Lulus research gate tidak menjamin profit dan tidak mengaktifkan
                uang riil.
              </div>
            </section>
          ) : section === "journal" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Aktivitas & hasil</h2>
                <button
                  onClick={() => {
                    const to = Date.now();
                    window.location.assign(
                      `/api/journal/export?from=${to - 90 * 86400000}&to=${to}`,
                    );
                  }}
                >
                  ↓ Export posisi CSV · 90 hari
                </button>
              </div>
              {records.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu WIB</th>
                        <th>Operasi</th>
                        <th>Referensi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={String(r.id)}>
                          <td>{when(r.createdAt)}</td>
                          <td>{String(r.operation)}</td>
                          <td className="mono">
                            {String(r.positionId ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Jurnal masih kosong"
                  description="Pembukaan, penutupan dan refresh simulasi dicatat di sini."
                />
              )}
            </section>
          ) : section === "system" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Operasional & provenance</h2>
                <Tag value="MANUAL" />
              </div>
              <div className="gate-grid">
                <div>
                  <strong>perp-breakout-v1</strong>
                  <span>Versi strategi</span>
                </div>
                <div>
                  <strong>binance-usdm-public</strong>
                  <span>Data futures publik</span>
                </div>
                <div>
                  <strong>Berita tidak dianalisis</strong>
                  <span>Scope eksperimen</span>
                </div>
              </div>
              {records.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu WIB</th>
                        <th>Simbol</th>
                        <th>Status</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r) => (
                        <tr key={String(r.id)}>
                          <td>{when(r.startedAt)}</td>
                          <td>{String(r.symbol)}</td>
                          <td>
                            <Tag value={String(r.state)} />
                          </td>
                          <td>{String(r.error ?? "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Belum ada run"
                  description="Analisis manual akan mencatat status, sumber dan waktu pemeriksaan."
                />
              )}
            </section>
          ) : null}
          {cursor && (
            <button
              className="load-more"
              disabled={busy}
              onClick={() => void more()}
            >
              Muat berikutnya ↓
            </button>
          )}
          <footer className="workspace-footer">
            <span>
              SIMULASI · Stop/target hanya alert. Tidak ada order perlindungan.
            </span>
            <span>Waktu Asia/Jakarta · v1.2</span>
          </footer>
        </main>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="modal"
          >
            <div className="eyebrow">KONFIRMASI SIMULASI</div>
            <h2 id="confirm-title">
              {confirm.kind === "open"
                ? `Buka ${confirm.signal?.side} simulasi`
                : confirm.kind === "manual"
                  ? `Latihan ${confirm.manual?.side} ${confirm.manual?.symbol}`
                : `Tutup ${confirm.position?.side}`}
            </h2>
            {confirm.kind === "manual" && confirm.preview ? (
              <>
                <PlanFields plan={confirm.preview} />
                <p>Perkiraan hasil di target: +{money(D(confirm.preview.rewardPerUnit).mul(confirm.preview.qty).toFixed())} USDT.
                  Risiko rencana di stop: {money(confirm.preview.plannedRisk)} USDT. Termasuk asumsi biaya dan cadangan funding.</p>
                <p>Angka dihitung ulang dari harga terbaru saat konfirmasi. Stop dan target adalah alert; tutup posisi secara manual.</p>
              </>
            ) : confirm.signal?.plan ? (
              <PlanFields signal={confirm.signal} />
            ) : (
              <p>
                {confirm.position?.symbol} · {confirm.position?.qty} unit. Harga
                penutupan dihitung ulang dari quote terbaru.
              </p>
            )}
            <p className="warning">
              Seluruh saldo adalah simulasi. Stop/target hanya alert dan tidak
              memasang order perlindungan.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setConfirm(null)}>
                Batal
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() => void commit()}
              >
                {busy ? "Memproses…" : "Konfirmasi simulasi"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function ManualExperiment({
  busy,
  onOpen,
  settings,
}: {
  busy: boolean;
  settings: TradingSettings;
  onOpen: (manual: { symbol: SymbolName; side: "LONG" | "SHORT" }) => void;
}) {
  const [symbol, setSymbol] = useState<SymbolName>("SOLUSDT");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  return (
    <section className="panel manual-experiment">
      <div className="panel-heading">
        <div>
          <h2>Latihan paper trade</h2>
          <p>
            Bukan sinyal strategi. Gunakan untuk memahami fee, funding, margin,
            serta P&amp;L tanpa saldo riil.
          </p>
          <p className="cell-note">
            1. Pilih coin dan arah → 2. Lihat perkiraan → 3. Konfirmasi → 4. Pantau dan tutup di Posisi paper.
            Risiko per posisi maksimal {D(settings.riskPerPosition).mul(100).toFixed()}% equity, leverage {settings.defaultLeverage}x.
          </p>
        </div>
        <Tag value="MANUAL_EXPERIMENT" />
      </div>
      <div className="manual-controls">
        <label>
          Kontrak
          <select
            value={symbol}
            onChange={(event) => setSymbol(event.target.value as SymbolName)}
          >
            {watchlist.map((asset) => (
              <option value={asset.symbol} key={asset.symbol}>
                {asset.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arah simulasi
          <select
            value={side}
            onChange={(event) => setSide(event.target.value as "LONG" | "SHORT")}
          >
            <option value="LONG">LONG — uji skenario harga naik</option>
            <option value="SHORT">SHORT — uji skenario harga turun</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={() => onOpen({ symbol, side })}
        >
          {busy ? "Menghitung…" : "Lihat perkiraan trade"} ↗
        </button>
      </div>
    </section>
  );
}
function signalReason(signal: Signal) {
  if (signal.reviewStatus === "MANUAL_EXPERIMENT") return "Latihan manual yang kamu buat.";
  if (signal.reviewStatus === "TECHNICAL_CONFIRMED") return "Lolos tren, breakout, volume dan risiko. Siap ditinjau untuk paper trade tanpa AI.";
  const progress = signalProgress(signal);
  if (progress) return progress;
  const reasons = signal.baseline?.reasons ?? [];
  if (reasons.length) return reasons.map((reason) => messages[reason] ?? reason.replaceAll("_", " ")).join(" ");
  if (signal.decision === "WAIT") return "Belum ada konfirmasi entry. Buka detail untuk melihat hasil pemeriksaan.";
  return "Kandidat ditemukan. Baca detail dan status review sebelum membuka simulasi.";
}
function SignalTable({ items }: { items: Signal[] }) {
  return items.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Kontrak</th>
            <th>Keputusan</th>
            <th>Entry rencana</th>
            <th>Net R:R</th>
            <th>Waktu WIB</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className={s.decision !== "WAIT" && s.plan ? "entry-row" : ""}>
              <td>
                <strong>{s.symbol}</strong>
                <small className="cell-note">PERPETUAL · USDT</small>
              </td>
              <td>
                <Tag value={s.decision} />
                <small className="cell-note">{signalReason(s)}</small>
              </td>
              <td className="mono">{money(s.plan?.entry)}</td>
              <td className="mono">{money(s.plan?.netRR)}</td>
              <td>{when(s.createdAt)}</td>
              <td>
                <Link className="text-link" href={`/signals/${s.id}`}>
                  Detail ↗
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="Belum ada keputusan"
      description="Jalankan analisis manual untuk memeriksa candle terbaru dan menyimpan hasil."
    />
  );
}
function PlanFields({ signal, plan }: { signal?: Signal; plan?: TradePlan }) {
  const p = plan ?? signal?.plan;
  if (!p) return null;
  return (
    <dl className="plan-grid">
      {[
        ["Entry", p.entry],
        ["Stop alert", p.stop],
        ["Target alert", p.target],
        ["Quantity", p.qty],
        ["Notional USDT", p.notional],
        ["Initial margin USDT", p.initialMargin],
        ["Leverage", `${p.leverage}x`],
        ["Net R:R", p.netRR],
        ["Risiko rencana USDT", p.plannedRisk],
        ["Entry fee USDT", p.entryFee],
        ["Slippage per sisi", p.slippageRate],
        ["Funding reserve USDT", p.fundingReserve],
      ].map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{label === "Leverage" ? value : money(value, label?.includes("Quantity") || label?.includes("Slippage") ? 6 : 4)}</dd>
        </div>
      ))}
    </dl>
  );
}
function SignalDetail({
  signal,
  busy,
  onOpen,
}: {
  signal: Signal;
  busy: boolean;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expired = now >= signal.expiresAt;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            {signal.symbol} <Tag value={signal.decision} />
          </h2>
          <p>
            Candle {when(signal.candleEndAt)} · Berlaku hingga{" "}
            {when(signal.expiresAt)}
          </p>
        </div>
        <Tag value={expired ? "EXPIRED" : "FUTURES"} />
      </div>
      <PlanFields signal={signal} />
      <div className="details-body">
        <h3>Fakta engine</h3>
        {Object.entries(signal.baseline?.evidence ?? {}).map(([key, f]) => (
          <p key={key}>
            <strong>{f.description}:</strong> {String(f.value ?? "UNKNOWN")}
          </p>
        ))}
        <p>
          Alasan:{" "}
          {signal.baseline?.reasons.join(", ") || "Filter baseline terpenuhi"}
        </p>
        <h3>{signal.reviewStatus === "TECHNICAL_CONFIRMED" ? "Konfirmasi teknikal · tanpa AI" : `Review AI · ${signal.reviewStatus}`}</h3>
        {signal.reviewProvider && signal.reviewProvider !== "none" && <p>Penyedia: {signal.reviewProvider === "oao" ? "OAO (pihak ketiga)" : "OpenAI"} · model: {signal.reviewModel}</p>}
        <pre>
          {signal.review
            ? JSON.stringify(signal.review, null, 2)
            : signal.reviewStatus === "TECHNICAL_CONFIRMED" ? "Seluruh filter strategi dan rencana risiko lolos. Harga dan batas risiko diperiksa ulang saat membuka posisi." : "Review tidak diminta atau tidak tersedia."}
        </pre>
        <p className="warning">
          Ambang model simulasi; bukan harga likuidasi akun exchange. Model{" "}
          {signal.plan?.marginEstimate.model ?? "—"}, asumsi maintenance{" "}
          {signal.plan?.maintenanceRate ?? "—"}. Ambang:{" "}
          {signal.plan?.marginEstimate.liqApprox ??
            signal.plan?.marginEstimate.status ??
            "—"}
          .
        </p>
        <button
          className="primary"
          disabled={
            busy ||
            expired ||
            signal.decision === "WAIT" ||
            !signal.plan ||
            !!signal.consumedPositionId
          }
          onClick={onOpen}
        >
          Buka {signal.side ?? "posisi"} simulasi ↗
        </button>
      </div>
    </section>
  );
}
function PositionCard({
  p,
  quote,
  now,
  busy,
  onClose,
}: {
  p: Position;
  quote?: LiveQuote | undefined;
  now: number;
  busy: boolean;
  onClose: () => void;
}) {
  const stale = now - p.lastRiskCheckAt > 15000,
    unverified = !p.fundingComplete || stale;
  const live = p.status === "OPEN" && quoteFresh(quote, now),
    bid = D(live ? quote!.bid! : p.lastQuote.bid),
    ask = D(live ? quote!.ask! : p.lastQuote.ask),
    estimatedNet = D(estimatePositionNet(p, bid.toFixed(), ask.toFixed())),
    exitAlert =
      p.side === "LONG"
        ? bid.lte(p.stop) || bid.gte(p.target)
        : ask.gte(p.stop) || ask.lte(p.target);
  return (
    <article className={`position-card ${p.status === "OPEN" ? "entry-active" : ""}`}>
      <div className="panel-heading">
        <h3>
          {p.symbol} <Tag value={p.side} />
        </h3>
        <Tag value={p.status} />
      </div>
      <div className="plan-grid">
        {[
          ["Quantity", p.qty],
          ["Entry", money(p.entry)],
          [live ? "Mark live" : "Mark tersimpan", money(live ? quote!.mark : p.lastMark, p.symbol === "XRPUSDT" ? 4 : 2)],
          [
            "Bid / Ask",
            `${money(bid.toFixed(), p.symbol === "XRPUSDT" ? 4 : 2)} / ${money(ask.toFixed(), p.symbol === "XRPUSDT" ? 4 : 2)}`,
          ],
          ["Margin USDT", money(p.collateral)],
          ["Leverage", `${p.leverage}x`],
          ["Funding net USDT", money(p.fundingNet)],
          [live ? "Estimasi net P&L live (USDT)" : "Net P&L tersimpan / estimasi (USDT)", p.status === "OPEN" ? money(estimatedNet.toFixed()) : money(p.netPnl)],
          [
            "Net P&L terealisasi",
            p.status === "OPEN" ? "Belum ditutup" : money(p.netPnl),
          ],
          ["Stop / Target", `${money(p.stop)} / ${money(p.target)}`],
          [
            "Ambang model",
            p.marginEstimate.liqApprox
              ? money(p.marginEstimate.liqApprox)
              : p.marginEstimate.status,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label?.includes("P&L") && value !== "Belum ditutup" ? (D(p.status === "OPEN" ? estimatedNet : p.netPnl).gte(0) ? "pnl-positive" : "pnl-negative") : ""}>{value}</dd>
          </div>
        ))}
      </div>
      <p className="subtle">
        {p.status === "OPEN" && (live ? "Estimasi P&L mengikuti bid/ask live, fee, slippage, dan funding tercatat. " : "Harga live tertunda. Estimasi memakai snapshot pemeriksaan terakhir. ")}
        Pemeriksaan terakhir: {when(p.lastRiskCheckAt)} ·{" "}
        {p.fundingComplete
          ? "Funding final hingga pemeriksaan terakhir"
          : "FUNDING PENDING"}
      </p>
      {p.status === "OPEN" && (
        <>
          <Tag
            value={
              exitAlert && live
                  ? `EXIT_${p.side}_ALERT`
                  : unverified ? "POSITION_UNVERIFIED" : `HOLD_${p.side}`
            }
          />
          <button disabled={busy} onClick={onClose}>
            Tutup {p.side}
          </button>
        </>
      )}
      <p className="warning">
        Ambang model simulasi; bukan harga likuidasi akun exchange. Asumsi m=
        {p.maintenanceRate}. Stop/target hanya alert.
      </p>
      {p.validityFlags.length > 0 && (
        <p className="subtle">{p.validityFlags.join(" · ")}</p>
      )}
    </article>
  );
}
function SettingsForm({
  settings,
  busy,
  onSave,
}: {
  settings: TradingSettings;
  busy: boolean;
  onSave: (changes: RecordData) => Promise<boolean>;
}) {
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({
          defaultLeverage: Number(f.get("defaultLeverage")),
          feeRate: f.get("feeRate"),
          slippageRate: f.get("slippageRate"),
          aiEnabled: f.get("aiEnabled") === "on",
          dailyAiReviewLimit: Number(f.get("dailyAiReviewLimit")),
        });
      }}
    >
      <div className="panel-heading">
        <h2>Parameter posisi baru</h2>
        <Tag value="VERSIONED" />
      </div>
      <div className="settings-grid">
        <label>
          Leverage default
          <select
            name="defaultLeverage"
            defaultValue={settings.defaultLeverage}
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </select>
        </label>
        <label>
          Fee per sisi (rasio)
          <input
            name="feeRate"
            defaultValue={settings.feeRate}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Slippage per sisi (rasio)
          <input
            name="slippageRate"
            defaultValue={settings.slippageRate}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Kuota review AI per hari UTC
          <input
            name="dailyAiReviewLimit"
            type="number"
            min={1}
            max={12}
            defaultValue={settings.dailyAiReviewLimit}
          />
        </label>
        <label className="checkbox">
          <input
            name="aiEnabled"
            type="checkbox"
            defaultChecked={settings.aiEnabled}
          />{" "}
          Aktifkan review AI dan kandidat baru
        </label>
      </div>
      <div className="details-body">
        <p>
          Risiko per posisi ≤0,5% equity. Total risiko ≤1%. Margin ≤10% per
          posisi / 20% total. Gross notional ≤100% equity.
        </p>
        <p className="subtle">
          Parameter yang tersimpan pada posisi lama tetap berlaku untuk posisi
          tersebut. Mode otomatisasi P1 belum diaktifkan.
        </p>
        <button className="primary" disabled={busy}>
          Simpan pengaturan
        </button>
      </div>
    </form>
  );
}
