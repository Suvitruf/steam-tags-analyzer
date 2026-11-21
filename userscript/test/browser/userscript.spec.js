import { test, expect } from "@playwright/test";
import { fixture } from "../fixture.mjs";
import { harness, visit } from "./manager.mjs";
import { MANIFEST_URL } from "../../src/shared/audit-client.js";
const host = "#steam-tag-analyzer-extension";
for (const kind of ["violentmonkey", "tampermonkey"])
  test.describe(kind, () => {
    let h, page;
    test.beforeEach(async () => {
      h = await harness(kind, await fixture());
      page = await h.launch();
    });
    test.afterEach(async () => {
      await h?.close();
    });
    const open = async () => {
      await page.locator(host).locator(".launch").click();
    };
    const status = () => page.locator(host).getByRole("status");
    for (const workers of [false, true]) test(`local audit warns, cancels and retries (${workers ? 'worker' : 'isolated fallback'})`, async () => {
      const live = 'https://steam-tags-api.aapanasik.com/app/30?fresh=1';
      h.paused.add(live);
      await visit(page, 30, { calculate: true, workers });
      await open();
      await expect(status()).toHaveText('No saved audit yet for this game.');
      await expect(page.locator(host)).toContainText('If the model is not cached, about 67 MB will be downloaded');
      expect(h.requests).toHaveLength(2);
      await page.locator(host).getByRole('button', { name: 'Run audit here', exact: true }).click();
      await expect.poll(() => h.requests.some(r => r.url === live)).toBe(true);
      await page.locator(host).getByRole('button', { name: 'Cancel audit', exact: true }).click();
      await expect(status()).toContainText('Audit cancelled');
      h.paused.delete(live);
      h.extraFiles.set(live, Buffer.from(JSON.stringify({ type: 'dlc' })));
      await page.locator(host).getByRole('button', { name: 'Run audit here again', exact: true }).click();
      await expect(status()).toContainText('Steam reports this page as "dlc".');
      expect(h.requests.filter(r => r.url === live)).toHaveLength(2);
      expect(h.requests.some(r => /\.onnx|\.wasm/.test(r.url))).toBe(false);

      // A Coming soon game can be audited before release. Pause at the first
      // pack request to prove it passed eligibility without a heavy download.
      const core = new URL(h.fixture.manifest.core.path, MANIFEST_URL).href;
      h.paused.add(core);
      h.extraFiles.set(live, Buffer.from(JSON.stringify({
        type: 'game', coming_soon: true, name: 'Upcoming game',
        short_description: 'A cozy desktop companion.', tags: [{ tagid: 1 }],
      })));
      await page.locator(host).getByRole('button', { name: 'Run audit here again', exact: true }).click();
      await expect.poll(() => h.requests.some(r => r.url === core)).toBe(true);
      await page.locator(host).getByRole('button', { name: 'Cancel audit', exact: true }).click();
      await expect(status()).toContainText('Audit cancelled');
      expect(h.requests.some(r => /\.onnx|\.wasm/.test(r.url))).toBe(false);
    });
    test("installed script uses real GM requests/storage across tabs and offline", async () => {
      await visit(page);
      await expect(page.locator(host)).toBeVisible();
      expect(h.requests).toEqual([]);
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      await expect(page.locator(host)).toHaveAttribute(
        "data-distribution",
        "userscript",
      );
      await expect(page.locator(host).locator(".tags li")).toHaveCount(7);
      await expect(page.locator(host)).toContainText(
        "Tags observed 2026-11-15",
      );
      await expect(page.locator(host)).toContainText(
        "may differ from the current Steam page",
      );
      expect(h.requests).toHaveLength(3);
      expect(
        h.requests.every((r) => !r.headers.cookie && !r.headers.referer),
      ).toBe(true);
      await page.reload();
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      expect(h.requests).toHaveLength(4);
      expect(h.requests.at(-1).url).toBe(MANIFEST_URL);
      await page.close();
      page = await h.context.newPage();
      await visit(page);
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      expect(h.requests).toHaveLength(5);
      h.mode = "offline";
      await page
        .locator(host)
        .getByRole("button", { name: "Reload saved audit" })
        .click();
      await expect(status()).toHaveText("Saved offline copy");
    });
    test("saved audits survive a browser restart", async () => {
      test.skip(
        kind === "tampermonkey",
        "Unpacked Tampermonkey 5.4.1 stops injecting even minimal scripts after restart in this harness; see README validation limits.",
      );
      await visit(page);
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      expect(h.requests).toHaveLength(3);
      await h.waitForStoredAudits();
      await h.context.close();
      page = await h.launch(false);
      await visit(page);
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      expect(h.requests).toHaveLength(4);
      expect(h.requests.at(-1).url).toBe(MANIFEST_URL);
    });
    test("missing, incompatible and corrupt results fall back; temporary failures can be retried", async () => {
      await visit(page, 30);
      await open();
      await expect(status()).toHaveText("No saved audit yet for this game.");
      expect(h.requests).toHaveLength(2);
      await expect(
        page
          .locator(host)
          .getByRole("link", { name: "Open full audit", exact: true }),
      ).toHaveAttribute("href", /appid=30$/);
      h.fixture.manifest.audits["gte-base"].revision = "future";
      await visit(page);
      await open();
      await expect(status()).toHaveText(
        "This saved audit needs a newer userscript version.",
      );
      h.fixture = await fixture();
      h.mode = "failure";
      await page.reload();
      await open();
      await expect(status()).toHaveText("The saved audit could not be loaded.");
      h.mode = "normal";
      const url =
        "https://projects.cdn.aapanasik.com/steam-tags/inference/" +
        h.fixture.index.apps[10].path;
      const original = h.fixture.files.get(url);
      h.fixture.files.set(url, Buffer.from("corrupt"));
      await page
        .locator(host)
        .getByRole("button", { name: "Retry saved audit" })
        .click();
      await expect(status()).toHaveText("The saved audit could not be loaded.");
      h.fixture.files.set(url, original);
      await page
        .locator(host)
        .getByRole("button", { name: "Retry saved audit" })
        .click();
      await expect(status()).toHaveText("Saved audit loaded");
      await expect(
        page
          .locator(host)
          .getByRole("link", { name: "Check current Steam page" }),
      ).toHaveAttribute("href", /appid=10&live=1$/);
      expect(
        h.requests.every(
          (r) => r.url === MANIFEST_URL || r.url.includes("/audits/"),
        ),
      ).toBe(true);
    });
    test("late markup, hostile text, restrictive CSP, keyboard and narrow layout work", async () => {
      h.fixture.saved.audit.app.name = '<img src=x onerror="alert(1)">';
      h.fixture.saved.audit.tags[0].tag = h.fixture.saved.audit.app.name;
      h.fixture.publish();
      await page.setViewportSize({ width: 390, height: 844 });
      await visit(page, 10, { late: true });
      await expect(page.locator(host)).toHaveCount(0);
      await page.evaluate(() => {
        const div = document.createElement("div");
        div.className = "glance_tags_ctn";
        document.querySelector("main").append(div);
      });
      await open();
      await expect(status()).toHaveText("Saved audit loaded");
      await expect(page.locator(host)).toContainText(
        h.fixture.saved.audit.app.name,
      );
      await expect(page.locator(host).locator("img")).toHaveCount(0);
      expect(
        await page
          .locator("#steam-original")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      ).toBe("rgb(255, 0, 0)");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator(host).locator(".tags summary").first().click();
      await expect(page.locator(host).locator(".reason").first()).toBeVisible();
      await page
        .locator(host)
        .getByRole("button", { name: "Close tag audit" })
        .focus();
      await page.keyboard.press("Escape");
      await expect(page.locator(host).locator(".panel")).toBeHidden();
      await expect(page.locator(host).locator(".launch")).toBeFocused();
      await page.goto("https://store.steampowered.com/sub/10/");
      await expect(page.locator(host)).toHaveCount(0);
    });
    test("an existing extension panel is preserved without duplicate controls or requests", async () => {
      await visit(page, 10, { existing: true });
      await expect(page.locator(host)).toHaveCount(1);
      await expect(page.locator(host)).toHaveText("Existing extension panel");
      // Wait for this manager's script delivery, using its already-tested app-page path.
      await page.waitForLoadState("load");
      expect(h.requests).toHaveLength(0);
      await expect(page.locator(host).locator(".launch")).toHaveCount(0);
    });
  });
