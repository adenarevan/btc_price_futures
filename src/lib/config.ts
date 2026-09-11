import { z } from "zod";
import { ConfigurationError } from "./errors";
const schema = z.object({
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  ADMIN_USERNAME: z.literal("admin").default("admin"),
  ADMIN_AUTH_EMAIL: z.string().default(""),
  FIREBASE_WEB_API_KEY: z.string().default(""),
  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  OWNER_UID: z.string().default(""),
  CSRF_SIGNING_SECRET: z.string().default(""),
  RATE_LIMIT_HMAC_SECRET: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-5-mini-2025-08-07"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  AI_ENABLED: z.enum(["true", "false"]).default("true"),
  AUTOMATION_ENABLED: z.enum(["false"]).default("false"),
  SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(28800)
    .default(28800),
});
export function getConfig() {
  if (typeof window !== "undefined")
    throw new Error("Server configuration accessed in browser");
  const env = { ...process.env };
  // Hosting dashboards can save empty values. Optional settings should then
  // use their declared defaults, not coerce an empty session lifetime to zero.
  for (const key of ["APP_ORIGIN", "ADMIN_USERNAME", "SESSION_MAX_AGE_SECONDS", "DEMO_MODE", "AI_ENABLED", "AUTOMATION_ENABLED", "OPENAI_MODEL"]) {
    const value = env[key]?.trim();
    if (!value) delete env[key];
    else env[key] = value;
  }
  if (env.VERCEL === "1" && !env.APP_ORIGIN)
    throw new ConfigurationError(["APP_ORIGIN"]);
  const result = schema.safeParse(env);
  if (!result.success)
    throw new ConfigurationError([...new Set(result.error.issues.map(issue => String(issue.path[0])))]);
  const c = result.data;
  const origin = new URL(c.APP_ORIGIN);
  if (c.APP_ORIGIN !== origin.origin && c.APP_ORIGIN !== `${origin.origin}/`)
    throw new ConfigurationError(["APP_ORIGIN"]);
  c.APP_ORIGIN = origin.origin;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!local && origin.protocol !== "https:") || (env.VERCEL === "1" && local))
    throw new ConfigurationError(["APP_ORIGIN"]);
  if (
    c.DEMO_MODE === "true" &&
    (process.env.NODE_ENV === "production" ||
      !local ||
      !process.env.FIRESTORE_EMULATOR_HOST ||
      !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      !c.FIREBASE_PROJECT_ID.startsWith("demo-"))
  )
    throw new ConfigurationError(["DEMO_MODE"]);
  return { ...c, local, demo: c.DEMO_MODE === "true" };
}
