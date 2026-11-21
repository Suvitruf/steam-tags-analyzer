import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scriptFile = new URL(
  "../../dist/steam-tag-audit.user.js",
  import.meta.url,
);

export async function harness(kind, fixture) {
  const managerDir =
    process.env[
      kind === "tampermonkey" ? "TAMPERMONKEY_DIR" : "VIOLENTMONKEY_DIR"
    ] ??
    fileURLToPath(new URL(`../../.test-managers/${kind}`, import.meta.url));
  await fs.access(path.join(managerDir, "manifest.json")).catch(() => {
    throw new Error(
      `Run npm run test:setup, or provide the unpacked ${kind} directory through its environment variable`,
    );
  });
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "steam-tag-userscript-"),
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(temp, "key.pem"),
      "-out",
      path.join(temp, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=projects.cdn.aapanasik.com",
    ],
    { stdio: "ignore" },
  );
  const state = { fixture, mode: "normal", requests: [], context: null, extraFiles: new Map(), paused: new Set() };
  const server = https.createServer(
    {
      key: await fs.readFile(path.join(temp, "key.pem")),
      cert: await fs.readFile(path.join(temp, "cert.pem")),
    },
    (req, res) => {
      state.requests.push({
        url: `https://${req.headers.host}${req.url}`,
        headers: req.headers,
      });
      if (state.mode === "offline") {
        req.socket.destroy();
        return;
      }
      if (state.mode === "failure") {
        res.writeHead(503);
        res.end();
        return;
      }
      const url = `https://${req.headers.host}${req.url}`;
      if (state.paused.has(url)) return;
      const body = state.extraFiles.get(url) ?? (req.url.endsWith("/manifest.json")
        ? Buffer.from(JSON.stringify(state.fixture.manifest))
        : state.fixture.files.get(url));
      res.writeHead(body ? 200 : 404, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body ?? "");
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const manifest = JSON.parse(
    await fs.readFile(path.join(managerDir, "manifest.json"), "utf8"),
  );
  state.version = manifest.version;
  state.launch = async (install = true) => {
    state.context = await chromium.launchPersistentContext(
      path.join(temp, "profile"),
      {
        headless: true,
        channel: "chromium",
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {}),
        args: [
          `--disable-extensions-except=${managerDir}`,
          `--load-extension=${managerDir}`,
          `--host-resolver-rules=MAP projects.cdn.aapanasik.com 127.0.0.1:${port}, MAP steam-tags-api.aapanasik.com 127.0.0.1:${port}, MAP cdn.jsdelivr.net 127.0.0.1:${port}`,
          "--ignore-certificate-errors",
        ],
      },
    );
    const context = state.context;
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    // Chromium reloads unpacked managers on each automated launch. Ensure its
    // userscript permission before opening Steam, including on profile reuse.
    const settings = await context.newPage();
    await settings.goto("chrome://extensions/");
    await settings.evaluate(async (id) => {
      await chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      });
      await chrome.developerPrivate.updateExtensionConfiguration({
        extensionId: id,
        userScriptsAccess: true,
      });
    }, id);
    await settings.close();
    if (install) {
      const options = await context.newPage();
      const optionsPath = manifest.options_ui?.page ?? manifest.options_page;
      await options.goto(`chrome-extension://${id}/${optionsPath}`);
      const code = await fs.readFile(scriptFile, "utf8");
      const result = await options.evaluate(
        async ({ kind, code }) => {
          if (kind === "violentmonkey") {
            const result = await chrome.runtime.sendMessage({
              cmd: "ParseScript",
              data: { code, config: { enabled: 1 } },
            });
            return {
              ok: !result?.errors && !!result?.update,
              errors: result?.errors,
            };
          }
          const result = await chrome.runtime.sendMessage({
            method: "saveScript",
            uuid: "new-user-script",
            code,
            new_script: true,
            reload: true,
          });
          return {
            ok: result?.installed === true || !!result?.items,
            error: result?.error,
          };
        },
        { kind, code },
      );
      if (!result.ok)
        throw new Error(
          `Manager installation failed: ${JSON.stringify(result)}`,
        );
      await options.close();
    }
    // Managers restore script registrations asynchronously after a restart.
    // Opening the first Steam tab before that point would miss document-idle.
    await expect
      .poll(
        () =>
          worker.evaluate(
            async () => (await chrome.userScripts.getScripts()).length,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
    state.page = await context.newPage();
    return state.page;
  };
  state.close = async () => {
    await state.context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  };
  state.waitForStoredAudits = async () => {
    const worker = state.context.serviceWorkers()[0];
    // GM.setValue can acknowledge an in-memory update before the manager's
    // debounced write to browser storage. Wait for that write before shutdown.
    await expect
      .poll(
        () =>
          worker.evaluate(async () => {
            function count(value) {
              if (!value || typeof value !== "object") return 0;
              return Object.entries(value).reduce(
                (sum, [key, child]) =>
                  sum +
                  (key.startsWith("steam-tag-audit:v1:") ? 1 : count(child)),
                0,
              );
            }
            return count(await chrome.storage.local.get(null));
          }),
        { timeout: 10000 },
      )
      .toBeGreaterThanOrEqual(3);
  };
  return state;
}

export async function visit(
  page,
  appid = 10,
  { late = false, existing = false, calculate = false, workers = false } = {},
) {
  await page.route("https://store.steampowered.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; connect-src 'none'" + (calculate ? "; script-src 'self' 'unsafe-eval'; frame-src 'self'" : '') + (workers ? '; worker-src blob:' : ''),
      },
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#182b3d;color:white;font:14px Arial}main{max-width:340px}button{background:red;color:white}</style></head><body><main><button id="steam-original">Steam button</button>${late ? "" : '<div class="glance_tags_ctn">Steam tags</div>'}${existing ? '<div id="steam-tag-analyzer-extension">Existing extension panel</div>' : ""}</main></body></html>`,
    }),
  );
  await page.goto(`https://store.steampowered.com/app/${appid}/Fixture/`);
}
