import { guardPage } from "@/lib/auth";
import { PasswordForm } from "@/components/auth-forms";
export default async function PasswordPage() {
  await guardPage(true);
  return (
    <main className="password-page">
      <section className="panel">
        <div className="eyebrow">KEAMANAN AKUN</div>
        <h1>Ganti password</h1>
        <p>
          Verifikasi password saat ini, lalu gunakan password baru minimal 15
          karakter. Semua sesi akan dicabut setelah perubahan.
        </p>
        <PasswordForm />
      </section>
    </main>
  );
}
