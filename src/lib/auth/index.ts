import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "../config";
import { getAuth, getDb } from "../firebase/admin";
import { AppError, ConfigurationError, safeError } from "../errors";
import { Timestamp } from "firebase-admin/firestore";
export interface OwnerIdentity {
  uid: string;
  role: "ADMIN";
  passwordChangeRequired: boolean;
  authTime: number;
}
const localRateLimits = new Map<string, { count: number; end: number }>();
export function names() {
  const c = getConfig();
  return {
    session: c.local ? "sinyallab_dev_session" : "__Host-sinyallab_session",
    nonce: c.local ? "sinyallab_dev_nonce" : "__Host-sinyallab_nonce",
  };
}
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: !getConfig().local,
    sameSite: "lax" as const,
    path: "/",
  };
}
function hmac(secret: string, text: string) {
  if (secret.length < 32) throw new AppError("AUTH_NOT_READY", 503);
  return createHmac("sha256", secret).update(text).digest("hex");
}
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export async function verifySession(
  value: string | undefined,
  allowRotation = false,
): Promise<OwnerIdentity> {
  if (!value) throw new AppError("SESSION_EXPIRED", 401);
  const c = getConfig();
  let token;
  try {
    token = await getAuth().verifySessionCookie(value, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SESSION_EXPIRED", 401);
  }
  if (!c.OWNER_UID || token.uid !== c.OWNER_UID)
    throw new AppError("FORBIDDEN", 403);
  const p = (await getDb().doc(`users/${token.uid}`).get()).data();
  if (!p || p.role !== "ADMIN" || p.authSchemaVersion !== 2)
    throw new AppError("FORBIDDEN", 403);
  const rotation = p.passwordChangeRequired !== false;
  if (rotation && !allowRotation)
    throw new AppError("PASSWORD_ROTATION_REQUIRED", 403);
  return {
    uid: token.uid,
    role: "ADMIN",
    passwordChangeRequired: rotation,
    authTime: token.auth_time,
  };
}
export async function guardRequest(req: NextRequest, allowRotation = false) {
  return verifySession(req.cookies.get(names().session)?.value, allowRotation);
}
export async function guardPage(allowRotation = false) {
  try {
    return await verifySession(
      (await cookies()).get(names().session)?.value,
      allowRotation,
    );
  } catch (error) {
    const e = safeError(error);
    if (e.code === "PASSWORD_ROTATION_REQUIRED") redirect("/account/password");
    redirect("/login");
  }
}
export function csrfToken(nonce: string, session: string, issued = Date.now()) {
  return `${issued}.${hmac(getConfig().CSRF_SIGNING_SECRET, JSON.stringify([nonce, session, issued]))}`;
}
export function verifyMutation(req: NextRequest) {
  if (req.headers.get("origin") !== getConfig().APP_ORIGIN)
    throw new AppError("CSRF_INVALID", 403);
  const n = names(),
    nonce = req.cookies.get(n.nonce)?.value,
    token = req.headers.get("x-csrf-token") ?? "",
    issued = Number(token.split(".")[0]);
  if (
    !nonce ||
    !Number.isSafeInteger(issued) ||
    Date.now() - issued > 3600000 ||
    issued > Date.now() + 5000 ||
    !equal(
      token,
      csrfToken(nonce, req.cookies.get(n.session)?.value ?? "", issued),
    )
  )
    throw new AppError("CSRF_INVALID", 403);
}
export async function rateLimit(
  req: NextRequest,
  scope: string,
  perIp = 5,
  global = 60,
  windowMs = 900000,
) {
  const c = getConfig();
  const ip =
    process.env.VERCEL === "1"
      ? (req.headers.get("x-vercel-forwarded-for") ?? "unknown")
      : "local-or-untrusted";
  const id = hmac(c.RATE_LIMIT_HMAC_SECRET, `${scope}:${ip}`),
    now = Date.now();
  if (c.local) {
    const keys = [`${scope}:${id}`, `${scope}:global`],
      limits = [perIp, global],
      values = keys.map((key) => {
        const current = localRateLimits.get(key);
        return current && current.end > now
          ? current
          : { count: 0, end: now + windowMs };
      });
    if (values.some((value, index) => value.count >= limits[index]!))
      throw new AppError("LOGIN_RATE_LIMITED", 429, true);
    values.forEach((value, index) =>
      localRateLimits.set(keys[index]!, {
        count: value.count + 1,
        end: value.end,
      }),
    );
    return;
  }
  const db = getDb();
  const refs = [
    db.doc(`authRateLimits/${id}`),
    db.doc(`authRateLimits/global-${scope}`),
  ];
  try {
    await db.runTransaction(async (tx) => {
      const docs = await tx.getAll(...refs);
      const values = docs.map((d) => {
        const v = d.data();
        return v && Number(v.end) > now
          ? { count: Number(v.count), end: Number(v.end) }
          : { count: 0, end: now + windowMs };
      });
      if (values[0]!.count >= perIp || values[1]!.count >= global)
        throw new AppError("LOGIN_RATE_LIMITED", 429, true);
      values.forEach((v, i) =>
        tx.set(refs[i]!, {
          count: v.count + 1,
          end: v.end,
          expiresAt: Timestamp.fromMillis(v.end),
        }),
      );
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AUTH_PROVIDER_UNAVAILABLE", 503, true);
  }
}
export async function passwordVerify(password: string) {
  const c = getConfig();
  if (!c.ADMIN_AUTH_EMAIL || !c.FIREBASE_WEB_API_KEY || !c.OWNER_UID)
    throw new AppError("AUTH_NOT_READY", 503);
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";
  let response: Response;
  try {
    response = await fetch(
      `${base}/accounts:signInWithPassword?key=${encodeURIComponent(c.FIREBASE_WEB_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: c.ADMIN_AUTH_EMAIL,
          password,
          returnSecureToken: true,
        }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
  } catch {
    throw new AppError("AUTH_PROVIDER_UNAVAILABLE", 503, true);
  }
  if (!response.ok)
    throw new AppError(
      response.status >= 500
        ? "AUTH_PROVIDER_UNAVAILABLE"
        : "INVALID_CREDENTIALS",
      response.status >= 500 ? 503 : 401,
    );
  const data = z.object({ idToken: z.string() }).parse(await response.json());
  const token = await getAuth().verifyIdToken(data.idToken, true);
  if (
    token.uid !== c.OWNER_UID ||
    token.firebase.sign_in_provider !== "password" ||
    Math.abs(Date.now() / 1000 - token.auth_time) > 300
  )
    throw new AppError("INVALID_CREDENTIALS", 401);
  return { idToken: data.idToken, uid: token.uid };
}
export function passwordPolicy(
  current: string,
  next: string,
  confirmation: string,
) {
  if (
    next !== confirmation ||
    next === current ||
    next.length < 15 ||
    next.length > 128 ||
    /^(password|qwerty|admin|123456|letmein|iloveyou)[\W\d]*$/i.test(next) ||
    new Set(next.toLowerCase()).size < 6
  )
    throw new AppError("PASSWORD_POLICY", 400);
}
export async function authHandler(req: NextRequest, action: string) {
  try {
    if (action === "csrf" && req.method === "GET") {
      await rateLimit(req, "csrf", 60, 300, 60000);
      const n = names(),
        nonce =
          req.cookies.get(n.nonce)?.value ?? randomBytes(32).toString("hex");
      const response = NextResponse.json(
        {
          data: {
            token: csrfToken(nonce, req.cookies.get(n.session)?.value ?? ""),
          },
          meta: { generatedAt: Date.now() },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(n.nonce, nonce, {
        ...cookieOptions(),
        maxAge: 28800,
      });
      return response;
    }
    if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED", 405);
    verifyMutation(req);
    let response: NextResponse;
    if (action === "login") {
      await rateLimit(req, "login");
      const body = z
        .object({
          username: z.string().max(100),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(await req.json());
      // Run password verification for unknown usernames too, avoiding a fast user enumeration branch.
      const verified = await passwordVerify(body.password);
      if (body.username.trim().toLowerCase() !== "admin")
        throw new AppError("INVALID_CREDENTIALS", 401);
      const profile = (await getDb().doc(`users/${verified.uid}`).get()).data();
      if (profile?.role !== "ADMIN" || profile.authSchemaVersion !== 2)
        throw new AppError("INVALID_CREDENTIALS", 401);
      const session = await getAuth().createSessionCookie(verified.idToken, {
        expiresIn: getConfig().SESSION_MAX_AGE_SECONDS * 1000,
      });
      response = NextResponse.json({
        data: { mustChangePassword: profile.passwordChangeRequired !== false },
      });
      response.cookies.set(names().session, session, {
        ...cookieOptions(),
        maxAge: getConfig().SESSION_MAX_AGE_SECONDS,
      });
      response.cookies.set(names().nonce, randomBytes(32).toString("hex"), {
        ...cookieOptions(),
        maxAge: 28800,
      });
    } else if (action === "logout") {
      const owner = await guardRequest(req, true);
      await getAuth().revokeRefreshTokens(owner.uid);
      response = NextResponse.json({ data: { loggedOut: true } });
      response.cookies.set(names().session, "", {
        ...cookieOptions(),
        maxAge: 0,
      });
      response.cookies.set(names().nonce, "", {
        ...cookieOptions(),
        maxAge: 0,
      });
    } else if (action === "password") {
      const owner = await guardRequest(req, true);
      await rateLimit(req, "password");
      const body = z
        .object({
          currentPassword: z.string().max(128),
          newPassword: z.string().max(128),
          confirmPassword: z.string().max(128),
        })
        .strict()
        .parse(await req.json());
      passwordPolicy(
        body.currentPassword,
        body.newPassword,
        body.confirmPassword,
      );
      await passwordVerify(body.currentPassword);
      const ref = getDb().doc(`users/${owner.uid}`);
      await ref.update({ passwordChangeRequired: true });
      await getAuth().updateUser(owner.uid, { password: body.newPassword });
      await getAuth().revokeRefreshTokens(owner.uid);
      await ref.update({
        passwordChangeRequired: false,
        passwordChangedAt: Timestamp.now(),
      });
      response = NextResponse.json({ data: { loginRequired: true } });
      response.cookies.set(names().session, "", {
        ...cookieOptions(),
        maxAge: 0,
      });
      response.cookies.set(names().nonce, "", {
        ...cookieOptions(),
        maxAge: 0,
      });
    } else throw new AppError("NOT_FOUND", 404);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const e = safeError(error);
    return NextResponse.json(
      { error: { code: e.code, message: e instanceof ConfigurationError ? "Konfigurasi server belum valid. Periksa environment variable yang disebutkan lalu redeploy." : e.code, retryable: e.retryable,
        ...(e instanceof ConfigurationError ? { fields: e.fields } : {}),
      } },
      {
        status: e.status,
        headers: {
          "Cache-Control": "no-store",
          ...(e.status === 429 ? { "Retry-After": "900" } : {}),
        },
      },
    );
  }
}
