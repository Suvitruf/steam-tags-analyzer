// Vendor shared code so either project can be built outside this monorepo.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url);
const names = [
  "audit-client.js",
  "links.js",
  "panel.js",
  "panel.css",
  "protocol.js",
  'local-policy.js',
  'local-runner.js',
];
const replacements = [
  [
    "This saved audit needs a newer extension version.",
    "This saved audit needs a newer userscript version.",
  ],
  [
    "The extension could not load the audit.",
    "The userscript could not load the audit.",
  ],
  [
    "Try again, or reload this Steam page if the extension was updated.",
    "Try again, or reload this Steam page if the userscript was updated.",
  ],
];
for (const name of names) {
  let source = await fs.readFile(
    new URL(`extension/src/${name}`, root),
    "utf8",
  );
  if (name === "panel.js")
    for (const [from, to] of replacements) {
      assert.ok(
        source.includes(from),
        "Panel copy changed; review userscript wording",
      );
      source = source.replace(from, to);
    }
  const generated =
    `/* Synced from extension/src/${name}. Update with npm run sync:shared. */\n` +
    source;
  const target = new URL(`../src/shared/${name}`, import.meta.url);
  if (process.argv.includes("--check"))
    assert.equal(
      await fs.readFile(target, "utf8"),
      generated,
      `Run npm --prefix userscript run sync:shared (${name})`,
    );
  else await fs.writeFile(target, generated);
}
const engine = await fs.readFile(new URL('extension/src/generated/audit-worker.js', root), 'utf8');
const engineTarget = new URL('../src/shared/audit-worker.js', import.meta.url);
if (process.argv.includes('--check')) assert.equal(await fs.readFile(engineTarget, 'utf8'), engine, 'Run sync:shared for the audit engine');
else await fs.writeFile(engineTarget, engine);
