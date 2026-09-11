"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="password-page">
      <section className="panel">
        <h1>Workspace belum tersedia</h1>
        <p>
          Koneksi layanan atau konfigurasi perlu diperiksa. Tidak ada transaksi
          yang diasumsikan berhasil.
        </p>
        <button onClick={reset}>Coba lagi</button>
      </section>
    </main>
  );
}
