import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../../src/lib/config";
import { ConfigurationError, safeError } from "../../src/lib/errors";
import { authHandler } from "../../src/lib/auth";
import { NextRequest } from "next/server";
afterEach(() => vi.unstubAllEnvs());
describe("production configuration validation", () => {
  it("treats blank optional values as defaults", () => {
    for (const key of ["SESSION_MAX_AGE_SECONDS", "ADMIN_USERNAME", "AI_ENABLED", "AUTOMATION_ENABLED", "DEMO_MODE"]) vi.stubEnv(key, "  ");
    vi.stubEnv("APP_ORIGIN", "https://example.vercel.app/");
    vi.stubEnv("VERCEL", "1");
    expect(getConfig()).toMatchObject({ APP_ORIGIN: "https://example.vercel.app", SESSION_MAX_AGE_SECONDS: 28800, local: false, AUTOMATION_ENABLED: "false" });
  });
  it.each(["", "http://localhost:3000", "https://example.vercel.app/path", "https://user:secret@example.vercel.app", "https://example.vercel.app?secret=1"])("rejects an unsafe production origin", origin => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("APP_ORIGIN", origin);
    expect(() => getConfig()).toThrow("SERVER_CONFIG_INVALID");
  });
  it("never classifies invalid env as invalid user input or includes its values", async () => {
    vi.stubEnv("APP_ORIGIN", "https://example.vercel.app");
    vi.stubEnv("SESSION_MAX_AGE_SECONDS", "private-bad-setting");
    const response = await authHandler(new NextRequest("https://example.vercel.app/api/auth/csrf"), "csrf");
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("SERVER_CONFIG_INVALID");
    expect(body.error.fields).toContain("SESSION_MAX_AGE_SECONDS");
    expect(JSON.stringify(body)).not.toContain("private-bad-setting");
    expect(safeError(new ConfigurationError(["ADMIN_USERNAME"])).status).toBe(503);
  });
});
