import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";
import { releaseMetadata } from './release.mjs';
const root = new URL("../", import.meta.url);
const check = process.argv.includes('--check');
const { version } = JSON.parse(
  await fs.readFile(new URL("package.json", root), "utf8"),
);
const metadata = releaseMetadata(
  await fs.readFile(new URL('metadata.txt', root), 'utf8'), version,
  JSON.parse(await fs.readFile(new URL('release.json', root), 'utf8')),
);
const notices = await fs.readFile(new URL('THIRD_PARTY_NOTICES.txt', root), 'utf8');
const noticeFile = 'steam-tag-audit.user.js.LEGAL.txt';
const workerNotices = new Set();
if (!check) await fs.mkdir(new URL("dist/", root), { recursive: true });
const result = await build({
  absWorkingDir: fileURLToPath(root),
  tsconfig: fileURLToPath(new URL('tsconfig.json', root)),
  entryPoints: [fileURLToPath(new URL("src/main.js", root))],
  outfile: fileURLToPath(new URL("dist/steam-tag-audit.user.js", root)),
  banner: { js: metadata.trimEnd() + `\n// Third-party notices: ${noticeFile} (distributed alongside this script).` },
  write: false,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox120"],
  loader: { ".css": "text" },
  legalComments: "external",
  plugins: [{ name: 'bundled-worker-text', setup(b) {
    b.onLoad({ filter: /shared\/audit-worker\.js$/ }, async ({ path }) => {
      // This worker is embedded as text, so the outer build cannot extract its
      // comments. Use the JS parser to keep notices out of the string too.
      const worker = await transform(await fs.readFile(path, 'utf8'), {
        legalComments: 'external', minifyWhitespace: true,
      });
      if (worker.legalComments) workerNotices.add(worker.legalComments.trim());
      return { contents: worker.code, loader: 'text' };
    });
  } }],
  logLevel: check ? 'silent' : 'info',
});
const external = result.outputFiles.filter(file => file.path.endsWith('.LEGAL.txt'));
const texts = new Set([notices.trim(), ...workerNotices, ...external.map(file => file.text.trim())]);
const outputs = new Map([
  [fileURLToPath(new URL(`dist/${noticeFile}`, root)), [...texts].filter(Boolean).join('\n\n') + '\n'],
  [fileURLToPath(new URL('dist/steam-tag-audit.meta.js', root)), metadata],
]);
for (const file of result.outputFiles) {
  if (!file.path.endsWith('.LEGAL.txt')) outputs.set(file.path, file.text);
}
for (const [path, content] of outputs) {
  if (check) {
    const existing = await fs.readFile(path, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing !== content) throw new Error(`Generated file is stale or missing: ${path}. Run npm run build and include dist/ in the change.`);
  } else await fs.writeFile(path, content);
}
if (check) console.log('Verified userscript, update metadata and companion notices match the sources.');
