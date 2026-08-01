import assert from "node:assert/strict";
import { test } from "node:test";

const playwright = await import("playwright").catch(() => null);
const baseUrl = process.env.BROWSER_BASE_URL;

if (!playwright) {
  test("browser smoke suite", { skip: "Playwright is not installed in this environment" }, () => {});
} else if (!baseUrl) {
  test("browser smoke suite", { skip: "Set BROWSER_BASE_URL to a running Worker URL" }, () => {});
} else {
  test("landing page renders at desktop and mobile widths", async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await assert.doesNotReject(() => page.locator(".landing-card").waitFor());
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator(".landing-card").count(), 1);
      assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  });

  test("admin login and dashboard interactions work", async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
      await page.locator("#loginForm").waitFor();
      const password = process.env.BROWSER_ADMIN_PASSWORD;
      if (!password) return;
      await page.locator("#password").fill(password);
      await page.locator("#loginForm button[type=submit]").click();
      await page.locator("#app:not(.hidden)").waitFor();
      assert.equal(await page.locator("#dnsRows").count(), 1);
      assert.equal(await page.locator(".ui-history-panel").count(), 1);
      await page.locator("#theme").click();
      assert.equal(await page.locator("body.light").count(), 1);
    } finally {
      await browser.close();
    }
  });
}
