export class ApiError extends Error {
  constructor(public code: string, public fields: string[] = []) {
    super(code);
  }
}
export const messages: Record<string, string> = {
  SERVER_CONFIG_INVALID: "Konfigurasi server Vercel belum valid. Perbaiki environment variable lalu redeploy.",
  INPUT_INVALID: "Data yang dikirim belum sesuai format. Periksa isian dan coba lagi.",
  AUTH_NOT_READY:
    "Firebase dan akun admin belum dikonfigurasi. Jalankan bootstrap privat sesuai README.",
  ACCOUNT_NOT_READY:
    "Akun simulasi belum diinisialisasi. Jalankan bootstrap privat.",
  INVALID_CREDENTIALS: "Username atau password tidak sesuai.",
  PASSWORD_ROTATION_REQUIRED:
    "Ganti password awal sebelum mengakses workspace.",
  CSRF_INVALID: "Token keamanan kedaluwarsa. Coba kirim kembali.",
  LOGIN_RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.",
  ANALYSIS_RATE_LIMITED: "Batas 5 analisis per menit tercapai. Pemantau mencoba lagi setelah satu menit.",
  AI_QUOTA: "Kuota review AI hari ini habis. Analisis teknikal tetap tersedia.",
  AUTH_PROVIDER_UNAVAILABLE: "Layanan autentikasi belum tersedia.",
  SERVICE_UNAVAILABLE:
    "Layanan belum tersedia. Periksa konfigurasi dan koneksi.",
  PASSWORD_POLICY:
    "Gunakan password baru 15–128 karakter yang tidak umum dan cocok dengan konfirmasi.",
  PROVIDER_UNAVAILABLE:
    "Data futures tidak dapat diakses dari lokasi ini. Coba lagi setelah layanan tersedia.",
  DATA_STALE: "Data harga terlalu lama. Refresh sebelum melanjutkan.",
  FUNDING_PENDING: "Settlement funding belum lengkap.",
  POSITION_DATA_STALE: "Data risiko posisi terbuka perlu diperbarui. Klik Refresh risiko, lalu hitung ulang perkiraan trade.",
  SIGNAL_EXPIRED: "Kandidat sudah kedaluwarsa. Analisis candle berikutnya.",
  RUN_IN_PROGRESS: "Operasi masih berjalan. Tunggu lalu refresh hasil.",
  PRICE_MOVED: "Harga bergeser melebihi batas 0,3%. Analisis kembali.",
  RISK_REJECTED:
    "Setup belum lolos pemeriksaan risiko. Periksa rincian rencana sebelum mencoba lagi.",
  POSITION_LIMIT_REACHED: "Sudah ada 2 posisi terbuka. Tutup salah satunya di menu Posisi paper sebelum membuka posisi baru.",
  SYMBOL_POSITION_EXISTS: "Coin ini sudah memiliki posisi terbuka. Lihat atau tutup posisi tersebut di menu Posisi paper.",
  NET_RR_TOO_LOW: "Target bersih setelah fee, slippage, dan cadangan funding terlalu kecil dibanding risiko. Setup ini belum layak dibuka.",
  POSITION_SIZE_REJECTED: "Ukuran yang diizinkan saldo dan batas risiko berada di luar batas kontrak. Periksa collateral dan posisi terbuka di dashboard.",
  INVALID_TRADE_LEVELS: "Harga stop atau target tidak valid untuk arah yang dipilih. Hitung ulang preview dari harga terbaru.",
  MARGIN_BUFFER_REJECTED: "Jarak stop terhadap batas margin terlalu sempit. Setup ditolak oleh model margin.",
  ACCOUNT_REVIEW_REQUIRED: "Akun simulasi perlu diperiksa karena ada defisit model. Lihat Posisi paper dan Jurnal.",
  FUNDING_COST_RISK: "Entry ditunda: terlalu dekat waktu funding atau biaya funding melampaui cadangan. Coba setelah settlement funding selesai.",
  INSUFFICIENT_COLLATERAL: "Collateral tersedia belum cukup untuk margin dan biaya posisi ini.",
  PROVIDER_RATE_LIMITED: "Penyedia harga sedang membatasi permintaan. Tunggu sebentar lalu muat ulang harga.",
  VOLUME_FILTER: "Volume candle belum mencapai 1,5× rata-rata 20 candle sebelumnya. Belum ada sinyal entry.",
  TREND_BREAKOUT_FILTER: "Tren dan penembusan harga belum searah. Tunggu candle 15 menit berikutnya.",
  EXTENDED_PRICE: "Harga sudah terlalu jauh dari pemicu. Tunggu setup berikutnya.",
  SPREAD_RISK: "Selisih bid dan ask terlalu lebar untuk entry.",
  REQUEST_TIMEOUT: "Permintaan terlalu lama. Muat ulang data untuk memeriksa hasil sebelum mengulang transaksi.",
  AI_DISABLED: "Review AI atau entry sedang dimatikan.",
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    const csrf = await fetch("/api/auth/csrf", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const json = await csrf.json();
    if (!csrf.ok) throw new ApiError(json.error?.code ?? "SERVICE_UNAVAILABLE", Array.isArray(json.error?.fields) ? json.error.fields.filter((f: unknown) => typeof f === "string" && /^[A-Z_]+$/.test(f)) : []);
    headers["X-CSRF-Token"] = json.data.token;
    headers["Content-Type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
  }
  const response = await fetch(`/api/${path}`, {
    method,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (!response.ok) {
    if (json.error?.code === "SESSION_EXPIRED" && path !== "auth/login")
      window.location.assign("/login");
    if (json.error?.code === "PASSWORD_ROTATION_REQUIRED")
      window.location.assign("/account/password");
    throw new ApiError(json.error?.code ?? "SERVICE_UNAVAILABLE", Array.isArray(json.error?.fields) ? json.error.fields.filter((f: unknown) => typeof f === "string" && /^[A-Z_]+$/.test(f)) : []);
  }
  return json.data as T;
}
export const errorMessage = (e: unknown) =>
  e instanceof ApiError
    ? (messages[e.code] ?? e.code) + (e.code === "SERVER_CONFIG_INVALID" && e.fields.length ? ` Variabel: ${e.fields.join(", ")}.` : "")
    : e instanceof Error && e.name === "TimeoutError"
      ? messages.REQUEST_TIMEOUT!
    : "Koneksi terputus. Periksa hasil tersimpan sebelum mengulang transaksi.";
