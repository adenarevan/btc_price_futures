// Local browser smoke check. Keeps the short-lived test session in memory and
// only reads workspace/preview data; never submits a paper order.
import { chromium, expect } from "@playwright/test";
import { loadEnvironment } from "./private-cli";
import { getConfig } from "../src/lib/config";
import { getAuth } from "../src/lib/firebase/admin";
import { existsSync } from "node:fs";
import { accountingSignal } from "../fixtures/market";

async function main() {
  loadEnvironment();
  const c = getConfig();
  if (!c.local) throw new Error("LOCAL_CHECK_ONLY");
  const production = process.argv.includes("--production");
  const baseUrl = production ? "https://btc-price-futures.vercel.app" : c.APP_ORIGIN;
  const token = await getAuth().createCustomToken(c.OWNER_UID);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(c.FIREBASE_WEB_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, returnSecureToken: true }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("TEST_SESSION_UNAVAILABLE");
  const { idToken } = await response.json() as { idToken: string };
  const session = await getAuth().createSessionCookie(idToken, { expiresIn: 300000 });
  const fallback = "C:/Users/User/AppData/Local/ms-playwright/chromium-1148/chrome-win/chrome.exe";
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { executablePath: fallback }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    // General smoke checks must not start scheduled scans or consume AI quota.
    await context.addInitScript(() => localStorage.setItem("sinyallab-signal-monitor", "off"));
    await context.addInitScript(() => localStorage.setItem("sinyallab-auto-paper-entry", "off"));
    await context.addCookies([{ name: production ? "__Host-sinyallab_session" : "sinyallab_dev_session", value: session, url: baseUrl, httpOnly: true, secure: production, sameSite: "Lax" }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let scans = 0;
    const autoTest = process.argv.includes("--auto-entry");
    const orders: string[] = [];
    if (autoTest) await page.route("**/api/positions", async route => {
      if (route.request().method() !== "POST") return route.continue();
      const { signalId } = route.request().postDataJSON();
      orders.push(signalId);
      expect(route.request().headers()["idempotency-key"]).toBe(`auto-paper-${signalId}`);
      await route.fulfill({ json: { data: { id: `paper-${signalId}`, status: "OPEN" } } });
    });
    if (process.argv.includes("--alerts") || autoTest) {
      await page.route("**/api/analysis", async route => {
        scans++;
        const { symbol } = route.request().postDataJSON();
        const s = accountingSignal(symbol === "ETHUSDT" ? "SHORT" : "LONG");
        s.symbol = symbol; s.id = `alert-test-${symbol}`;
        s.baseline = { decision: s.decision, side: s.side, reasons: [], evidence: {}, plan: s.plan, candleEndAt: s.candleEndAt, expiresAt: s.expiresAt };
        s.decision = "WAIT";
        if (autoTest) { s.decision = s.baseline.decision; s.reviewStatus = "TECHNICAL_CONFIRMED"; }
        if (!["BTCUSDT", "ETHUSDT"].includes(symbol)) { s.plan = null; s.baseline.decision = "WAIT"; s.baseline.reasons = ["VOLUME_FILTER"]; }
        await route.fulfill({ json: { data: s } });
      });
    }
    const dashboardResponse = page.waitForResponse(r => r.url().endsWith("/api/dashboard"));
    await page.goto(`${baseUrl}/dashboard`);
    expect((await dashboardResponse).status()).toBe(200);
    if (process.argv.includes("--technical")) {
      expect((await (await dashboardResponse).json()).data.signalMode).toBe("TECHNICAL");
      await expect(page.getByText("Mode teknikal tanpa AI:", { exact: false })).toBeVisible({ timeout: 20000 });
      console.log("PASS: deployed workspace uses explicit technical confirmation without AI");
    }
    await expect(page.getByRole("heading", { name: "Latihan paper trade" })).toBeVisible({ timeout: 20000 });
    if (process.argv.includes("--auth-only")) {
      const csrf = await context.request.get(`${baseUrl}/api/auth/csrf`);
      expect(csrf.status()).toBe(200);
      expect(typeof (await csrf.json()).data.token).toBe("string");
      if (production) expect(csrf.headers()["set-cookie"]).toContain("__Host-sinyallab_nonce=");
      expect(errors).toEqual([]);
      console.log("PASS: production CSRF endpoint, secure nonce cookie and authenticated workspace/Firebase reads. Password was not changed or supplied.");
      return;
    }
    if (autoTest) {
      await page.getByRole("button", { name: "Aktifkan entry paper otomatis", exact: true }).click();
      await page.getByRole("button", { name: "Aktifkan pemantauan", exact: true }).click();
      await expect(page.getByText("BTCUSDT: entry paper LONG berhasil.", { exact: false })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("ETHUSDT: entry paper SHORT berhasil.", { exact: false })).toBeVisible({ timeout: 20000 });
      await expect(page.locator(".monitor-results > div")).toHaveCount(5);
      expect(orders).toEqual(["alert-test-BTCUSDT", "alert-test-ETHUSDT"]);
      await page.getByRole("button", { name: "Jeda entry paper otomatis", exact: true }).click();
      await expect(page.getByText("Entry paper otomatis dijeda", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Jeda pemantauan", exact: true }).click();
      expect(errors).toEqual([]);
      console.log("PASS: automatic LONG/SHORT paper requests, stable idempotency keys, WAIT exclusion and pause; all orders intercepted, no ledger mutations.");
      return;
    }
    if (process.argv.includes("--alerts")) {
      await page.getByRole("button", { name: "Aktifkan pemantauan", exact: true }).click();
      await expect(page.locator(".signal-notification")).toHaveCount(2, { timeout: 20000 });
      await expect(page.locator(".signal-long")).toContainText("LONG BTCUSDT · kandidat teknikal");
      await expect(page.locator(".signal-short")).toContainText("SHORT ETHUSDT · kandidat teknikal");
      await expect(page.locator(".monitor-results > div")).toHaveCount(5);
      expect(scans).toBe(5);
      await page.getByRole("button", { name: "Jeda pemantauan", exact: true }).click();
      expect(errors).toEqual([]);
      console.log("PASS: five automatic scans, LONG/SHORT in-app notifications, WAIT filtering and pause. Analysis responses are isolated fixtures; no real scans or orders submitted.");
      return;
    }
    await expect(page.getByText("Mark price · Binance Futures")).toHaveCount(5, { timeout: 25000 });
    if (process.argv.includes("--live")) {
      await expect(page.getByTestId("live-feed")).toHaveAttribute("data-status", "LIVE", { timeout: 25000 });
      const at = await page.getByTestId("price-BTCUSDT").getAttribute("data-updated-at");
      await expect(page.getByTestId("price-BTCUSDT")).not.toHaveAttribute("data-updated-at", at!, { timeout: 10000 });
      console.log("PASS: live WebSocket frames automatically update the dashboard");
      if (process.argv.includes("--reconnect")) {
        await context.setOffline(true);
        await expect(page.getByTestId("live-feed")).not.toHaveAttribute("data-status", "LIVE", { timeout: 22000 });
        await context.setOffline(false);
        await expect(page.getByTestId("live-feed")).toHaveAttribute("data-status", "LIVE", { timeout: 45000 });
        expect(errors).toEqual([]);
        console.log("PASS: disconnected prices stop claiming LIVE; automatic reconnect recovers without a reload");
        return;
      }
    }
    await page.getByRole("button", { name: "Lihat perkiraan trade" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("dialog")).toContainText("Perkiraan hasil di target");
    await page.getByRole("button", { name: "Batal", exact: true }).click();
    for (const section of ["positions", "signals", "journal", "evaluation", "settings", "system"]) {
      await page.goto(`${baseUrl}/${section}`);
      await expect(page.getByText("Memuat workspace…")).toHaveCount(0, { timeout: 20000 });
      await expect(page.getByRole("heading", { name: "Workspace belum tersedia" })).toHaveCount(0);
      const alert = page.locator('.error[role="alert"]');
      if (await alert.count()) throw new Error(`${section}: ${await alert.allTextContents()}`);
      console.log(`PASS: ${section}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/dashboard`);
    await expect(page.getByRole("button", { name: "Lihat perkiraan trade" })).toBeVisible({ timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Lihat perkiraan trade" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Konfirmasi simulasi", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Konfirmasi simulasi", exact: true })).toBeInViewport();
    await page.screenshot({ path: "test-results/manual-preview-mobile.png", fullPage: true });
    await page.getByRole("button", { name: "Batal", exact: true }).click();
    expect(errors).toEqual([]);
    console.log("PASS: authenticated dashboard, five live prices, manual preview, six workspace pages, mobile layout. No paper trades submitted.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "BROWSER_CHECK_FAILED"); process.exitCode = 1; });
