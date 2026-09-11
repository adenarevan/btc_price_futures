"use client";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "./api";
function PasswordInput({ label, name }: { label: string; name: string }) {
  const [show, setShow] = useState(false);
  return (
    <label>
      {label}
      <span className="password-input">
        <input
          name={name}
          type={show ? "text" : "password"}
          required
          maxLength={128}
          autoComplete={
            name === "newPassword" || name === "confirmPassword"
              ? "new-password"
              : "current-password"
          }
        />
        <button
          type="button"
          className="plain"
          onClick={() => setShow(!show)}
          aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
        >
          {show ? "Tutup" : "Lihat"}
        </button>
      </span>
    </label>
  );
}
export function LoginForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{ mustChangePassword: boolean }>(
        "auth/login",
        "POST",
        { username: form.get("username"), password: form.get("password") },
      );
      window.location.assign(
        result.mustChangePassword ? "/account/password" : "/dashboard",
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="auth-form">
      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          maxLength={100}
          placeholder="Username akun"
        />
      </label>
      <PasswordInput label="Password" name="password" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Memverifikasi…" : "Masuk workspace"} <span>↗</span>
      </button>
      <p className="form-note">
        Akses khusus pemilik. Akun dibuat melalui bootstrap privat.
      </p>
    </form>
  );
}
export function PasswordForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("auth/password", "POST", {
        currentPassword: f.get("currentPassword"),
        newPassword: f.get("newPassword"),
        confirmPassword: f.get("confirmPassword"),
      });
      window.location.assign("/login");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <PasswordInput label="Password saat ini" name="currentPassword" />
      <PasswordInput label="Password baru" name="newPassword" />
      <PasswordInput label="Konfirmasi password baru" name="confirmPassword" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Menyimpan…" : "Ganti password dan logout"}
      </button>
    </form>
  );
}
