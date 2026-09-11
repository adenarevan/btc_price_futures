# SinyalLab Futures

Aplikasi latihan futures USDT dengan saldo paper. Kontrak: BTC, ETH, SOL, BNB, XRP.

## Cara mencoba

1. Buka `http://localhost:3000/dashboard` dan login memakai akun pemilik.
2. Di **Latihan paper trade**, pilih coin dan arah. LONG menguji kenaikan harga; SHORT menguji penurunan harga.
3. Klik **Lihat perkiraan trade**. Baca entry, stop/target alert, jumlah kontrak, margin, risiko dan perkiraan hasil di target.
4. Klik **Konfirmasi simulasi** untuk membuka posisi. Harga dan ukuran diperiksa ulang saat konfirmasi.
5. Posisi muncul di dashboard dan menu **Posisi paper**. Estimasi P&L mengikuti harga live secara otomatis. Klik **Refresh risiko** untuk memperbarui settlement funding dan pemeriksaan model. Klik **Tutup LONG/SHORT** lalu konfirmasi untuk mencatat hasil bersih.

Harga market watch memakai WebSocket publik Binance USD-M: mark price `@1s` dan bid/ask `@bookTicker`. Harga, estimasi equity dan estimasi P&L bergerak otomatis di dashboard serta Posisi paper; hijau berarti naik/positif, merah turun/negatif. Tampilan LIVE hanya muncul ketika kedua jenis harga masih segar. Jika koneksi gagal, aplikasi mencoba sambung ulang dan memakai REST tiap 10 detik sebagai cadangan; data yang lebih tua dari 15 detik ditandai tertunda. Koneksi dijeda ketika tab disembunyikan. Pembaruan tampilan tidak mengubah ledger; settlement funding dan pemeriksaan model memakai **Refresh risiko**. Stop dan target merupakan alert, bukan penutupan otomatis. Batasnya satu posisi per coin dan dua posisi terbuka total.

Rute stream mengikuti [dokumentasi pemisahan endpoint Binance](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice): `/market` untuk mark price, `/public` untuk book ticker. Tidak memerlukan API key exchange.

Latihan manual `manual-experiment-v2` menghitung target 2R setelah asumsi fee, slippage dan cadangan funding, dengan batas risiko akun tetap berlaku. Angka target adalah skenario perhitungan, bukan prediksi hasil. Strategi otomatis tetap mengikuti filter PRD dan dapat menghasilkan WAIT. Alasan WAIT ditampilkan langsung. Review AI memerlukan konfigurasi OpenAI yang aktif; latihan manual tidak memerlukannya.

## Notifikasi sinyal

Pemantau di workspace aktif saat aplikasi dibuka (bisa dijeda). Lima kontrak dianalisis saat mulai, lalu setelah candle 15 menit tertutup dengan jeda 10 detik; timer browser dapat terlambat ketika tab berada di background. Hasil gagal dicoba ulang dengan jeda minimal satu menit. Satu tab memegang giliran scan, hasil per candle dan notifikasi terakhir disimpan lokal untuk menghindari duplikasi.

Kandidat teknikal yang lolos filter mendapatkan notifikasi LONG/SHORT di panel. Review CONFIRM diberi label dikonfirmasi AI; review WAIT tidak menghasilkan notifikasi entry. Kandidat manual, kedaluwarsa atau sudah dipakai tidak diberi notifikasi. Pemantau tidak membuka posisi. Konfigurasi/kuota AI yang belum tersedia tidak menghilangkan kandidat teknikal, tetapi entry strategi tetap memerlukan konfirmasi AI.

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
