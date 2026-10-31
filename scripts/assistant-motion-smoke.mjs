import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.resolve("services/api/tmp/motion-browser/package.json"));
const { chromium } = require("playwright");
const baseURL = process.env.MOTION_TEST_BASE_URL ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname));
const output = path.resolve("services/api/tmp/motion-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.MOTION_BROWSER_CHANNEL ?? "msedge" });
const errors = [];
const quota = {
  today: "2026-10-30", period: { start: "2026-10-26", end: "2026-11-01" },
  max: 500000, spent: 200000, remaining: 300000, percent: 40, level: "green", nextWeekMax: 450000,
  expenses: [{ id: "expense-1", date: "2026-10-29", name: "Synthetic expense", amount: 200000, notes: "Test" }],
  savings: { save: 150000, target: 250000, cycleStart: "2026-10-01", rows: [] },
};
const sub = (name, price) => ({ id: name.replaceAll(" ", "-"), name, price, billingDay: 5, nextBilling: "2026-11-05" });
const link = {
  id: "test-link", slug: "demo", shortUrl: "https://go.example.test/demo", target: "https://example.test/", title: "Synthetic link",
  notes: "", enabled: true, expiresAt: null, clicks: 7, lastClickedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};
const endpoints = {
  "/auth/me": { email: "demo@example.test", role: "main" },
  "/finance/summary": { balance: 1250000 },
  "/finance/cashflow": { points: [{ label: "Sep", income: 500000, outcome: 100000, net: 400000 }, { label: "Oct", income: 200000, outcome: 400000, net: -200000 }] },
  "/finance/transactions": [],
  "/finance/quota": quota,
  "/finance/options": { Category: ["Makan", "Other"], Account: ["Mandiri Debit"] },
  "/finance/subscriptions": { monthly: { items: [sub("Monthly A", 25000), sub("Monthly B", 50000), sub("Free", 0)], total: 75000 }, yearly: { items: [sub("Yearly", 300000)], total: 300000 } },
  "/links/config": { baseUrl: "https://go.example.test" },
  "/links": [link],
  "/links/test-link/stats": { total: 7, bots: 0, daily: [{ key: "2026-10-29", count: 2 }, { key: "2026-10-30", count: 5 }], referrers: [], countries: [], devices: [] },
};
let writes = 0;
let releaseSave;
let failSave = false;
async function context(options = {}) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, ...options });
  await ctx.addCookies([{ name: "pd_session", value: "synthetic-browser-only", url: baseURL }]);
  await ctx.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace("/api/v1", "");
    if (request.method() !== "GET") {
      assert.equal(endpoint, "/finance/transactions");
      writes++;
      await new Promise((resolve) => { releaseSave = resolve; });
      if (failSave) return route.fulfill({ status: 409, json: { error: { code: "duplicate", message: "Synthetic duplicate" } } });
      quota.spent = 250000; quota.remaining = 250000; quota.percent = 50;
      return route.fulfill({ json: { data: { id: "saved-test", ...request.postDataJSON() } } });
    }
    assert.ok(endpoint in endpoints, `Unexpected endpoint: ${endpoint}`);
    return route.fulfill({ json: { data: endpoints[endpoint] } });
  });
  ctx.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return ctx;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready(page) {
  await page.waitForLoadState("networkidle");
  await wait(650);
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
async function screenshot(page, name) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}
try {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.motionSamples = { money: [], quota: [], bars: [] };
    let started = false;
    const observer = new MutationObserver(() => {
      if (started || !document.querySelector(".inline-grid, .motion-quota")) return;
      started = true;
      observer.disconnect();
      const end = performance.now() + 900;
      const sample = () => {
        const money = document.querySelector(".inline-grid [aria-hidden]:last-child");
        if (money) window.motionSamples.money.push(money.textContent);
        const quota = document.querySelector(".motion-quota");
        if (quota) window.motionSamples.quota.push(parseFloat(getComputedStyle(quota).getPropertyValue("--quota-fill")));
        const bar = document.querySelector(".motion-bar");
        if (bar) window.motionSamples.bars.push(getComputedStyle(bar).transform);
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto("/finance");
  await ready(page);
  assert.equal(await page.locator(".inline-grid .sr-only").innerText(), "Rp1.250.000");
  assert.equal(await page.locator(".inline-grid [aria-hidden]").last().innerText(), "Rp1.250.000");
  assert.ok(await page.evaluate(() => window.motionSamples.money.some((v) => v !== "Rp0" && v !== "Rp1.250.000")), "The counter should display intermediate amounts.");
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: "Outcome", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Outcome", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await ready(page);
  // All draws income and outcome as two lines.
  assert.deepEqual(await page.locator(".motion-line").evaluateAll((lines) => lines.map((n) => getComputedStyle(n).strokeDashoffset)), ["0px", "0px"]);
  const groupBy = page.getByRole("combobox", { name: "Group by", exact: true });
  await groupBy.click();
  await page.getByRole("option", { name: "Weekly", exact: true }).click();
  await page.getByRole("listbox", { name: "Group by" }).waitFor({ state: "detached" });
  assert.equal(await groupBy.innerText(), "Weekly");
  assert.equal(await groupBy.evaluate((n) => n === document.activeElement), true);
  // Hover shows a point's amount, a click pins it, a second click removes it.
  const point = page.getByRole("button", { name: "Income Sep: Rp500.000", exact: true });
  const tips = page.locator(".chart-tip");
  await point.hover();
  await tips.first().waitFor();
  assert.equal(await tips.first().innerText(), "Rp500.000");
  await point.click();
  await page.mouse.move(0, 0);
  assert.equal(await point.getAttribute("aria-pressed"), "true");
  assert.equal(await tips.count(), 1);
  await point.click();
  assert.equal(await point.getAttribute("aria-pressed"), "false");
  assert.equal(await tips.count(), 0);
  await screenshot(page, "finance-390.png");

  await page.goto("/finance/subscriptions");
  await ready(page);
  assert.equal(await page.locator(".inline-grid .sr-only").innerText(), "Rp75.000");
  assert.ok(await page.evaluate(() => window.motionSamples.bars.some((v) => v !== "none" && v !== "matrix(1, 0, 0, 1, 0, 0)")), "Subscription bars should grow from their baseline.");
  await page.getByRole("button", { name: "Yearly", exact: true }).click();
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await page.getByRole("button", { name: "Yearly", exact: true }).click();
  await ready(page);
  assert.equal(await page.locator(".inline-grid .sr-only").innerText(), "Rp300.000");
  await page.getByRole("button", { name: "Monthly", exact: true }).click();
  await ready(page);
  assert.equal(await page.locator(".motion-bar").last().evaluate((n) => n.getBBox().height), 0);
  await screenshot(page, "subscriptions-390.png");

  await page.goto("/finance/quota");
  await ready(page);
  const bar = page.getByRole("progressbar");
  assert.ok(await page.evaluate(() => window.motionSamples.quota.some((v) => v > 0 && v < 40)), "Quota should animate toward its final fill.");
  assert.equal(await bar.getAttribute("aria-valuenow"), "40");
  assert.equal(await bar.evaluate((n) => getComputedStyle(n).getPropertyValue("--quota-fill").trim()), "40%");
  await screenshot(page, "quota-390.png");
  const add = page.getByRole("button", { name: "Add a transaction" });
  await add.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await page.locator("main").evaluate((n) => n.inert), true);
  assert.equal(await page.getByLabel("Name", { exact: true }).evaluate((n) => n === document.activeElement), true);
  // A dropdown in the sheet: Escape closes only the list, picks never close the sheet.
  const category = dialog.getByRole("combobox", { name: "Category", exact: true });
  const categories = page.getByRole("listbox", { name: "Category" });
  await category.click();
  await categories.waitFor();
  await page.keyboard.press("Escape");
  await categories.waitFor({ state: "detached" });
  assert.ok(await dialog.isVisible());
  assert.equal(await category.evaluate((n) => n === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await categories.waitFor({ state: "detached" });
  assert.equal(await category.innerText(), "Other");
  await category.click();
  await page.getByRole("option", { name: "Makan", exact: true }).click();
  await categories.waitFor({ state: "detached" });
  assert.ok(await dialog.isVisible());
  assert.equal(await category.innerText(), "Makan");
  // The active filter comes before Name in the form. Shift-Tab from the first control wraps.
  await dialog.getByRole("button", { name: "Expense", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await dialog.getByRole("button", { name: "Save", exact: true }).evaluate((n) => n === document.activeElement), true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await add.evaluate((n) => n === document.activeElement), true);
  assert.equal(await page.locator("main").evaluate((n) => n.inert), false);

  // A close followed by a fresh opening must not inherit an old exit timer.
  await add.click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await add.click();
  await wait(250);
  assert.ok(await dialog.isVisible());
  await page.getByLabel("Name", { exact: true }).fill("Synthetic transaction");
  await page.getByLabel("Amount", { exact: true }).fill("50000");
  failSave = true;
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
  await page.keyboard.press("Escape");
  assert.ok(await dialog.isVisible());
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.equal(writes, 1);
  releaseSave();
  await page.getByRole("alert").waitFor();
  failSave = false;
  await page.getByRole("button", { name: "Save it again as a separate transaction" }).click();
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
  assert.equal(writes, 2);
  releaseSave();
  await dialog.waitFor({ state: "detached" });
  await ready(page);
  assert.ok(await page.getByRole("status").isVisible());
  assert.equal(await bar.getAttribute("aria-valuenow"), "50");
  assert.equal(await add.evaluate((n) => n === document.activeElement), true);

  await add.click();
  await dialog.waitFor();
  await wait(300);
  await screenshot(page, "transaction-390.png");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("main").evaluate((n) => n.inert), false);
  // Switching preference during an exit must finish cleanup immediately.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await add.click();
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("main").evaluate((n) => n.inert), false);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.goto("/links");
  await ready(page);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.getByRole("heading", { name: "Last 30 days" }).waitFor();
  await ready(page);
  assert.equal(await page.locator(".motion-bar").count(), 2);
  await screenshot(page, "links-390.png");

  for (const width of [320, 390, 480, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/finance/quota");
    await ready(page);
    await noOverflow(page);
  }
  Object.assign(quota, { spent: 625000, remaining: -125000, percent: 125, level: "red" });
  await page.goto("/finance/quota");
  await ready(page);
  assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
  assert.equal(await page.locator(".inline-grid .sr-only").innerText(), "-Rp125.000");
  assert.equal(await page.getByRole("progressbar").evaluate((n) => getComputedStyle(n).getPropertyValue("--quota-fill").trim()), "100%");
  Object.assign(quota, { spent: 0, remaining: 500000, percent: 0, level: "empty" });
  await page.goto("/finance/quota");
  await ready(page);
  assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "0");
  assert.equal(await page.getByRole("progressbar").evaluate((n) => getComputedStyle(n).getPropertyValue("--quota-fill").trim()), "0%");
  await page.goto("/");
  await ready(page);
  const tile = page.locator('a[href="/finance"]');
  await tile.hover();
  await wait(180);
  assert.equal(await tile.evaluate((n) => getComputedStyle(n).transform), "matrix(1, 0, 0, 1, 0, -2)");
  await screenshot(page, "hub-1440.png");
  const reduced = await context({ reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto("/finance");
  await reducedPage.locator(".inline-grid").waitFor();
  assert.equal(await reducedPage.locator(".inline-grid [aria-hidden]").last().innerText(), "Rp1.250.000");
  assert.equal(await reducedPage.locator(".motion-panel").evaluate((n) => getComputedStyle(n).animationName), "none");
  await reducedPage.goto("/finance/quota");
  await ready(reducedPage);
  await reducedPage.getByRole("button", { name: "Add a transaction" }).click();
  await reducedPage.getByRole("dialog").waitFor();
  await reducedPage.keyboard.press("Escape");
  await reducedPage.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("Assistant motion passed: amounts, charts, filters, quota, modal lifecycle, reduced motion, Links and responsive widths. All API traffic was mocked.");
} finally {
  await browser.close();
}
