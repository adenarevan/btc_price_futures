# SinyalLab Futures

Aplikasi latihan futures USDT dengan saldo paper. Kontrak: BTC, ETH, SOL, BNB, XRP.

## Cara mencoba

1. Buka `http://localhost:3000/dashboard` dan login memakai akun pemilik.
2. Di **Latihan paper trade**, pilih coin dan arah. LONG menguji kenaikan harga; SHORT menguji penurunan harga.
3. Klik **Lihat perkiraan trade**. Baca entry, stop/target alert, jumlah kontrak, margin, risiko dan perkiraan hasil di target.
4. Klik **Konfirmasi simulasi** untuk membuka posisi. Harga dan ukuran diperiksa ulang saat konfirmasi.
5. Posisi muncul di dashboard dan menu **Posisi paper**. Estimasi P&L mengikuti harga live secara otomatis. Klik **Refresh risiko** untuk memperbarui settlement funding dan pemeriksaan model. Klik **Tutup LONG/SHORT** lalu konfirmasi untuk mencatat hasil bersih.

Harga market watch memakai WebSocket publik Binance USD-M: mark price `@1s` dan bid/ask `@bookTicker`. Harga, estimasi equity dan estimasi P&L bergerak otomatis di dashboard serta Posisi paper; hijau berarti naik/positif, merah turun/negatif. Tampilan LIVE hanya muncul ketika kedua jenis harga masih segar. Jika koneksi gagal, aplikasi mencoba sambung ulang dan memakai REST tiap 10 detik sebagai cadangan; data yang lebih tua dari 15 detik ditandai tertunda. Koneksi dijeda ketika tab disembunyikan. Pembaruan tampilan tidak mengubah ledger; settlement funding dan pemeriksaan model memakai **Refresh risiko**. Auto-close paper memeriksa stop/target setiap 60 detik saat aplikasi terbuka; dapat dijeda secara terpisah. Batasnya satu posisi per coin dan dua posisi terbuka total.

Rute stream mengikuti [dokumentasi pemisahan endpoint Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice): `/market` untuk mark price, `/public` untuk book ticker. Tidak memerlukan API key exchange.

Latihan manual `manual-experiment-v2` menghitung target 2R setelah asumsi fee, slippage dan cadangan funding, dengan batas risiko akun tetap berlaku. Angka target adalah skenario perhitungan, bukan prediksi hasil. Strategi otomatis tetap mengikuti filter PRD dan dapat menghasilkan WAIT. Alasan WAIT ditampilkan langsung. Review AI memerlukan konfigurasi OpenAI yang aktif; latihan manual tidak memerlukannya.

## Notifikasi sinyal

Pemantau di workspace aktif saat aplikasi dibuka (bisa dijeda). Lima kontrak dianalisis saat mulai, lalu setelah candle 15 menit tertutup dengan jeda 10 detik; timer browser dapat terlambat ketika tab berada di background. Hasil gagal dicoba ulang dengan jeda minimal satu menit. Satu tab memegang giliran scan, hasil per candle dan notifikasi terakhir disimpan lokal untuk menghindari duplikasi.

Mode teknikal aktif bila `AI_ENABLED=false` atau opsi review AI di pengaturan dimatikan. Kandidat yang lolos seluruh filter diberi status `TECHNICAL_CONFIRMED` dan notifikasi LONG/SHORT. Entry paper otomatis aktif secara default di mode teknikal selama pemantauan berjalan; dapat dijeda lewat **Jeda entry paper otomatis** (preferensi disimpan di browser). Kandidat valid langsung dikirim ke endpoint paper dengan leverage rencana dan kunci idempotensi tetap per sinyal. Server tetap memeriksa ulang harga, expiry, saldo, risiko dan posisi; WAIT, sinyal manual, kedaluwarsa, atau terpakai tidak dibuka otomatis. Status berhasil hanya ditampilkan setelah respons sukses; timeout tidak dianggap transaksi gagal maupun sukses dan data dimuat ulang. Jeda mencegah permintaan berikutnya, bukan membatalkan permintaan yang sudah terkirim. Mode AI tetap memerlukan review CONFIRM dan konfirmasi entry manual. Fitur ini tidak mengirim order exchange dan tidak berjalan 24 jam saat browser ditutup. Auto-close paper aktif secara default, terpisah dari jeda entry. Endpoint positions/auto-exit memakai autentikasi, CSRF dan account lease yang sama; quote fresh LONG bid / SHORT ask memicu penutupan dengan slippage/fee/funding, bukan fill tepat pada stop/target. Pemeriksaan 60 detik dapat melewatkan sentuhan harga dan berhenti saat tab ditutup; status POSITION_UNVERIFIED bukan bukti exit berhasil. Alasan AUTO_EXIT_STOP atau AUTO_EXIT_TARGET disimpan. Tidak ada agent/token AI untuk exit. Hasil WAIT lama tidak diubah; analisis baru memakai identitas konfirmasi v2. Angka rasio volume dan ambang breakout ditampilkan untuk menjelaskan setup yang belum lolos. Parameter volume 1,5× dan batas risiko belum diubah; kualitas/profitabilitas strategi belum terbukti.

Klik **Aktifkan notifikasi perangkat** untuk meminta izin browser. Jika izin ditolak atau fitur tidak didukung, notifikasi di panel tetap tersedia. Pemantauan ini berjalan ketika aplikasi terbuka, bukan push server setelah semua tab ditutup. Aturan izin mengikuti [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).

Uji UI notifikasi dengan `npx tsx scripts/check-workspace.ts --alerts`; respons analisis diganti fixture di browser uji dan tidak menghabiskan kuota AI.

## Menjalankan lokal

Gunakan Node 22 sesuai `package.json`. Konfigurasi lokal ada di `.env.local`, dengan nama variabel pada `.env.example`. Jangan memasukkan kredensial ke source atau membagikan file tersebut.

```powershell
npm run dev
```

Jalankan hanya satu server pada port yang dipakai. Untuk production lokal, hentikan server production sebelum mengganti hasil build:

```powershell
npm run build
npm start
```

Setelah penggantian build, muat ulang browser agar memakai aset terbaru.

## Pemeriksaan

### Login di Vercel

Environment variable harus memiliki **nilai**, bukan sekadar nama. Production memakai `APP_ORIGIN=https://btc-price-futures.vercel.app`, `ADMIN_USERNAME=admin`, `SESSION_MAX_AGE_SECONDS=28800`, `DEMO_MODE=false`, `AUTOMATION_ENABLED=false`, dan `AI_ENABLED=false`. Nilai Firebase, UID pemilik, email admin, serta dua secret CSRF/rate limit diisi privat di pengaturan Vercel. Secret minimal 32 karakter. Jangan mengunggah `.env.local`; `.vercelignore` mengecualikan berkas environment dan key.

Perubahan environment berlaku pada deployment baru: redeploy setelah menyimpan. Preview dengan domain berbeda memerlukan `APP_ORIGIN` yang cocok; konfigurasi Production tidak otomatis memperbaiki Preview.

`GET /api/auth/csrf` yang sehat merespons 200. Kesalahan konfigurasi kini merespons `SERVER_CONFIG_INVALID` (503) dengan **nama variabel saja**, tanpa nilainya. Nilai opsional kosong memakai default; domain production tetap wajib benar. `npx tsx scripts/config-readiness.ts <file-env> --vercel` memeriksa konfigurasi tanpa mencetak secret.

### Tes lokal

```powershell
npm run typecheck
npm test
npm run auth:readiness
npx tsx scripts/check-paper.ts
npx tsx scripts/check-workspace.ts
npx tsx scripts/check-workspace.ts --live
```

`check-paper.ts` membaca akun dan pasar untuk menguji rencana tanpa membuka posisi. `check-workspace.ts` hanya untuk lokal: membuat sesi uji pemilik berumur lima menit di memori melalui kredensial admin yang sudah dikonfigurasi, lalu memeriksa harga, preview, halaman workspace dan layout HP. Tidak menampilkan token atau mengirim transaksi paper. Memerlukan Chromium Playwright lokal. Tes service memakai penyimpanan terisolasi; kelulusan tes bukan bukti profit strategi atau pengujian transaksi Firestore menyeluruh.
# btc_price_futures
