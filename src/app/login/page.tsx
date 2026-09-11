import { LoginForm } from "@/components/auth-forms";
import Link from "next/link";
export default function Login() {
  return (
    <main className="login-page">
      <div className="login-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="orbit orbit-three" />
        <div className="art-cross">+</div>
        <div className="art-caption">
          OBSERVE. TEST. UNDERSTAND.
          <br />
          <span>BTC · ETH · SOL · BNB · XRP</span>
        </div>
      </div>
      <section className="login-panel">
        <Link className="brand" href="/login">
          <span className="brand-icon">
            S<span>↗</span>
          </span>
          <span>
            SinyalLab<span className="brand-sub">FUTURES RESEARCH</span>
          </span>
        </Link>
        <div className="login-copy">
          <div className="eyebrow">
            WORKSPACE PRIVAT <span className="dot" />
          </div>
          <h1>
            Keputusan dimulai
            <br />
            dari bukti.
          </h1>
          <p>
            Masuk untuk meninjau kandidat, memahami risiko, dan mencatat hasil
            simulasi.
          </p>
          <LoginForm />
        </div>
        <footer className="login-footer">
          <span className="badge">SIMULASI</span>
          <span>Tanpa order exchange · Tanpa saldo riil</span>
        </footer>
      </section>
    </main>
  );
}
