import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// Install the optional browser dependency in the ignored API tmp directory.
const require = createRequire(
  path.resolve("services/api/tmp/meeting-browser/package.json"),
);
const { chromium } = require("playwright");
const baseURL = process.env.MEETING_TEST_BASE_URL ?? "http://localhost:3100";
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname),
  "Run against a local test server only.",
);
const output = path.resolve("services/api/tmp/meeting-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEETING_CHROMIUM_PATH
    ? { executablePath: process.env.MEETING_CHROMIUM_PATH }
    : {}),
});
const errors = [];
const contexts = [];
async function context(options = {}) {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  contexts.push(ctx);
  ctx.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
  });
  return ctx;
}
async function json(response, status = 200) {
  assert.equal(
    response.status(),
    status,
    `${response.url()}: ${await response.text()}`,
  );
  return (await response.json()).data;
}
async function visible(locator) {
  await locator.waitFor({ state: "visible" });
}
/** Picks an option from the custom Select combobox and waits for its list to close. */
async function chooseOption(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.getByRole("listbox", { name: label }).waitFor({ state: "detached" });
}
async function settled(page) {
  await page.waitForLoadState("networkidle");
}
async function screenshot(page, name) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  assert.ok(
    sizes.page <= sizes.viewport + 1,
    `Page overflow at ${sizes.viewport}px: ${sizes.page}px`,
  );
}
async function edit(page, current = false) {
  await page
    .locator(".m-event-actions")
    .getByRole("button", {
      name: current ? "Edit your availability" : "Add your availability",
      exact: true,
    })
    .click();
  await visible(page.getByLabel("Your name", { exact: true }));
}
async function dragRectangle(page, fromDay, fromRow, toDay, toRow) {
  const from = page.locator(
    `button[data-day="${fromDay}"][data-row="${fromRow}"]`,
  );
  const to = page.locator(`button[data-day="${toDay}"][data-row="${toRow}"]`);
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(),
    b = await to.boundingBox();
  assert.ok(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

let pollId;
try {
  const visitor = await context();
  const demo = await visitor.newPage();
  for (const width of [320, 390, 480, 1440]) {
    await demo.setViewportSize({ width, height: 900 });
    await demo.goto("/meeting/availability/demo");
    await settled(demo);
    await visible(
      demo.getByRole("heading", {
        level: 1,
        name: "Product & design catch-up",
      }),
    );
    await noOverflow(demo);
    await screenshot(demo, `${width}-demo.png`);
    await demo.goto("/meeting/availability");
    await settled(demo);
    await noOverflow(demo);
    await screenshot(demo, `${width}-create.png`);
  }
  console.log(
    "PASS: public demo and creation pages at 320, 390, 480, 1440px; no page overflow",
  );
  const gate = await visitor.newPage();
  await gate.goto("/finance");
  assert.ok(
    new URL(gate.url()).pathname === "/login",
    "Finance lost its session gate",
  );
  await gate.close();

  // UI interactions work in the demo without accounts or a running API.
  await demo.goto("/meeting/availability/demo");
  await settled(demo);
  await edit(demo);
  await demo.getByLabel("Your name", { exact: true }).fill("Demo Guest");
  await dragRectangle(demo, 0, 0, 1, 3);
  assert.equal(
    await demo.locator(".m-slot-selected").count(),
    8,
    "Rectangle drag must select 2 days × 4 intervals",
  );
  const first = demo.locator('button[data-day="0"][data-row="0"]');
  await first.focus();
  await first.press("Space");
  assert.equal(
    await demo.locator(".m-slot-selected").count(),
    7,
    "Keyboard Space must toggle the slot",
  );
  await first.press("Space");
  await first.press("ArrowDown");
  assert.equal(
    await demo
      .locator('button[data-day="0"][data-row="1"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await demo
    .getByRole("button", { name: "Save availability", exact: true })
    .click();
  await visible(
    demo.getByRole("status").filter({ hasText: "Jawaban demo ditambahkan" }),
  );
  assert.equal(await demo.locator(".m-participant").count(), 6);
  await chooseOption(demo, "Display time zone", "New York");
  assert.match(await demo.locator(".m-grid-footer").innerText(), /New York/);
  const recs = demo.locator(".m-recommendation-main");
  assert.ok((await recs.count()) > 0);
  await recs.first().click();
  await demo
    .getByRole("button", { name: "Confirm this time", exact: true })
    .click();
  await visible(demo.getByRole("dialog"));
  await demo.keyboard.press("Escape");
  assert.equal(
    await demo.getByRole("dialog").count(),
    0,
    "Escape must dismiss the native dialog",
  );
  assert.equal(
    await demo
      .getByRole("button", { name: "Confirm this time", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "Dialog must restore focus",
  );
  console.log(
    "PASS: rectangle drag, keyboard toggles/navigation, demo save, time zones, dialog dismissal/focus",
  );

  // A repeated DST hour must appear after the complete first hour, not interleaved.
  const dst = await visitor.newPage();
  const dstSlots = Array.from({ length: 20 }, (_, i) =>
    new Date(Date.parse("2026-11-01T04:00:00Z") + i * 900000)
      .toISOString()
      .replace(".000Z", "Z"),
  );
  await dst.route("**/api/v1/meeting/polls/qa-dst", (route) =>
    route.fulfill({
      json: {
        data: {
          id: "qa-dst", title: "DST test", description: "",
          timezone: "America/New_York", dates: ["2026-11-01"],
          startHour: 0, endHour: 4, duration: 60,
          slots: dstSlots, participants: [], recommendations: [],
          finalizedStart: null, createdAt: "2026-10-01T00:00:00Z",
        },
      },
    }),
  );
  await dst.goto("/meeting/availability/qa-dst");
  await chooseOption(dst, "Display time zone", "New York");
  const renderedSlots = await dst.locator("button[data-slot]").evaluateAll((cells) =>
    cells.map((cell) => cell.dataset.slot),
  );
  assert.deepEqual(renderedSlots, dstSlots, "Repeated DST hours must stay in chronological order");
  assert.match(await dst.locator('button[data-slot="2026-11-01T05:00:00Z"]').getAttribute("aria-label"), /GMT-4/);
  assert.match(await dst.locator('button[data-slot="2026-11-01T06:00:00Z"]').getAttribute("aria-label"), /GMT-5/);
  await dst.close();
  console.log("PASS: repeated DST hours stay chronological and expose distinct offsets");

  const owner = await context();
  const config = await json(await owner.request.get("/api/v1/auth/config"));
  assert.equal(
    config.devLogin,
    true,
    "Full browser smoke requires AUTH_DEV_LOGIN=true and SYNC_MODE=off on a test database",
  );
  await json(
    await owner.request.post("/api/v1/auth/dev-login", {
      data: { email: "scheduling@example.test" },
      headers: { Origin: baseURL },
    }),
  );
  const ownerPage = await owner.newPage();
  await ownerPage.goto("/meeting/availability");
  await settled(ownerPage);
  await visible(
    ownerPage.getByRole("button", { name: "Create poll & get a link" }),
  );
  const title = `Meeting browser QA ${Date.now()} ${"日程".repeat(10)}`;
  await ownerPage.getByLabel("What’s the occasion?").fill(title);
  await ownerPage
    .getByLabel("Meeting description")
    .fill("Synthetic, scheduling; test.\nNo external invitations.");
  await ownerPage
    .getByRole("button", { name: "Create poll & get a link" })
    .click();
  await ownerPage.waitForURL(/\/meeting\/availability\/[a-f0-9]+$/);
  await visible(ownerPage.getByRole("heading", { level: 1, name: title }));
  pollId = new URL(ownerPage.url()).pathname.split("/").pop();
  const invitation = `/meeting/availability/${pollId}`;
  const quarterZone = await context({ timezoneId: "Asia/Kathmandu" });
  const quarterPage = await quarterZone.newPage();
  await quarterPage.goto(invitation);
  await settled(quarterPage);
  assert.equal(
    await quarterPage
      .getByRole("combobox", { name: "Display time zone", exact: true })
      .innerText(),
    await quarterPage.evaluate(() =>
      Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " "),
    ),
    "Preserve browser-detected zones outside the shortcut list",
  );
  assert.match(
    await quarterPage.locator(".m-time-heading").innerText(),
    /GMT\+5:45/,
  );
  await quarterPage.close();
  const guest = await context();
  const guestPage = await guest.newPage();
  await guestPage.goto(invitation);
  await settled(guestPage);
  await visible(guestPage.getByRole("heading", { level: 1, name: title }));
  assert.equal(
    await guestPage
      .getByRole("button", { name: "Confirm this time", exact: true })
      .count(),
    0,
  );
  await edit(guestPage);
  await guestPage.getByLabel("Your name", { exact: true }).fill("Ayu Test");
  await dragRectangle(guestPage, 0, 0, 1, 3);
  await guestPage
    .getByRole("button", { name: "Save availability", exact: true })
    .click();
  await visible(
    guestPage.getByRole("status").filter({ hasText: "Jawaban tersimpan" }),
  );
  await guestPage.reload();
  await settled(guestPage);
  await edit(guestPage, true);
  assert.equal(
    await guestPage.locator(".m-slot-selected").count(),
    8,
    "Saved availability must survive reload",
  );
  await guestPage
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await guestPage
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await visible(
    guestPage.getByRole("status").filter({ hasText: "Jawaban tersimpan" }),
  );
  let data = await json(
    await guest.request.get(`/api/v1/meeting/polls/${pollId}`),
  );
  assert.deepEqual(
    data.participants[0].slots,
    [],
    "Guests can explicitly submit no availability",
  );
  await edit(guestPage, true);
  await dragRectangle(guestPage, 0, 0, 0, 3);
  await guestPage
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await visible(
    guestPage.getByRole("status").filter({ hasText: "Jawaban tersimpan" }),
  );

  const mobile = await context({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(invitation);
  await settled(mobilePage);
  await edit(mobilePage);
  await mobilePage.getByLabel("Your name", { exact: true }).fill("Raka Test");
  for (let row = 0; row < 4; row++)
    await mobilePage.locator(`button[data-day="0"][data-row="${row}"]`).tap();
  assert.equal(
    await mobilePage.locator(".m-slot-selected").count(),
    4,
    "Touch taps must select independently",
  );
  await mobilePage
    .getByRole("button", { name: "Save availability", exact: true })
    .tap();
  await visible(
    mobilePage.getByRole("status").filter({ hasText: "Jawaban tersimpan" }),
  );
  await noOverflow(mobilePage);
  data = await json(await guest.request.get(`/api/v1/meeting/polls/${pollId}`));
  assert.equal(data.participants.length, 2);
  assert.equal(data.recommendations[0].count, 2);
  const forged = await mobile.request.patch(
    `/api/v1/meeting/polls/${pollId}/responses/${data.participants.find((p) => p.name === "Ayu Test").id}`,
    { data: { name: "Forged", slots: [], version: 1 } },
  );
  assert.equal(forged.status(), 403);
  const blockedStorage = await context();
  await blockedStorage.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage unavailable", "SecurityError");
    };
  });
  const blockedPage = await blockedStorage.newPage();
  let blockedWrites = 0;
  blockedPage.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/responses"))
      blockedWrites++;
  });
  await blockedPage.goto(invitation);
  await settled(blockedPage);
  await edit(blockedPage);
  await blockedPage
    .getByLabel("Your name", { exact: true })
    .fill("Storage unavailable guest");
  await blockedPage
    .getByRole("button", { name: "Save availability", exact: true })
    .click();
  await visible(
    blockedPage
      .getByRole("alert")
      .filter({ hasText: "Aktifkan penyimpanan browser" }),
  );
  assert.equal(
    blockedWrites,
    0,
    "Do not create an uneditable guest when key storage fails",
  );
  await blockedPage.close();
  await edit(guestPage, true);
  await guestPage
    .getByLabel("Your name", { exact: true })
    .fill("Offline draft");
  await guest.setOffline(true);
  await visible(
    guestPage.getByRole("status").filter({ hasText: "sedang offline" }),
  );
  assert.equal(
    await guestPage
      .getByRole("button", { name: "Save changes", exact: true })
      .isDisabled(),
    true,
  );
  await guest.setOffline(false);
  await guestPage.waitForFunction(
    () => !document.querySelector(".m-grid-footer button")?.disabled,
  );
  await guestPage.getByLabel("Your name", { exact: true }).fill("Ayu Test");
  await guestPage
    .getByRole("button", { name: "Group availability", exact: true })
    .click();
  console.log(
    "PASS: owner create, guest save/edit/reload, explicit unavailable response, mobile touch, edit keys, blocked storage, offline recovery",
  );

  const secondTab = await guest.newPage();
  await secondTab.goto(invitation);
  await settled(secondTab);
  await edit(secondTab, true);
  await edit(guestPage, true);
  await guestPage.getByLabel("Your name", { exact: true }).fill("Ayu Updated");
  await guestPage
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await visible(
    guestPage.getByRole("status").filter({ hasText: "Jawaban tersimpan" }),
  );
  await secondTab.getByLabel("Your name", { exact: true }).fill("Stale edit");
  await secondTab
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await visible(
    secondTab.getByRole("alert").filter({ hasText: "another tab" }),
  );
  await secondTab
    .getByRole("button", { name: "Load saved response", exact: true })
    .click();
  assert.equal(
    await secondTab.getByLabel("Your name", { exact: true }).inputValue(),
    "Ayu Updated",
  );
  await secondTab.close();
  console.log(
    "PASS: stale tab cannot overwrite a newer response; explicit reload recovers it",
  );

  await ownerPage.reload();
  await settled(ownerPage);
  const choices = ownerPage.locator(".m-recommendation-main");
  assert.ok((await choices.count()) > 0);
  await choices.first().click();
  await ownerPage
    .getByRole("button", { name: "Confirm this time", exact: true })
    .click();
  await visible(ownerPage.getByRole("dialog"));
  await ownerPage
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm this time", exact: true })
    .click();
  await visible(
    ownerPage
      .getByRole("heading", { name: "IT’S A DATE", exact: true })
      .or(ownerPage.locator(".m-final-banner")),
  );
  const downloadPromise = ownerPage.waitForEvent("download");
  await ownerPage
    .getByRole("button", { name: "Add to calendar", exact: true })
    .click();
  const download = await downloadPromise;
  const file = path.join(output, "meeting.ics");
  await download.saveAs(file);
  const ics = await readFile(file, "utf8");
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(ics, /DTEND:\d{8}T\d{6}Z/);
  assert.ok(
    ics.includes(
      "DESCRIPTION:Synthetic\\, scheduling\\; test.\\nNo external invitations.",
    ),
    "ICS must escape commas, semicolons, and newlines",
  );
  assert.ok(
    ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
    "ICS lines must be folded at 75 octets",
  );
  await guestPage.reload();
  await settled(guestPage);
  await visible(guestPage.locator(".m-final-banner"));
  const closed = await mobile.request.post(
    `/api/v1/meeting/polls/${pollId}/responses`,
    { data: { name: "Late guest", slots: [] } },
  );
  assert.equal(closed.status(), 409);
  await ownerPage
    .getByRole("button", { name: "Reopen poll", exact: true })
    .click();
  await visible(
    ownerPage.getByRole("status").filter({ hasText: "Poll dibuka kembali" }),
  );
  data = await json(await guest.request.get(`/api/v1/meeting/polls/${pollId}`));
  assert.equal(data.finalizedStart, null);
  console.log(
    "PASS: owner confirmation, closed response protection, valid UTC calendar download, reopen",
  );

  const failure = await visitor.newPage();
  await failure.route("**/api/v1/meeting/polls/qa-unavailable", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "Unavailable" },
      }),
    }),
  );
  await failure.goto("/meeting/availability/qa-unavailable");
  await visible(
    failure.getByRole("button", { name: "Try again", exact: true }),
  );
  await failure.unroute("**/api/v1/meeting/polls/qa-unavailable");
  await failure.getByRole("button", { name: "Try again", exact: true }).click();
  await visible(
    failure.getByRole("alert").filter({ hasText: "tidak ditemukan" }),
  );
  console.log(
    "PASS: server error, retry, not-found states; private finance gate preserved",
  );
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  console.log(`All meeting browser checks passed. Screenshots: ${output}`);
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  if (pollId)
    console.log(
      "Synthetic browser poll retained in the test database for inspection.",
    );
}
