import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('_site');
const base = (process.env.SITE_BASE_PATH ?? '').replace(/\/$/, '');
const routes = [
  '', 'analyzer', 'audit', 'tags', 'benchmarks', 'compare', 'lifecycle',
  'features', 'prices', 'combos', 'map', 'timing', 'trends', 'trending',
  'momentum', 'upcoming', 'publishers', 'tag-changes', 'coverage',
];
const errors = [];
const exists = file => fs.existsSync(file) && fs.statSync(file).isFile();

const routeCache = new Map();
function resolveRoute(relative) {
  if (routeCache.has(relative)) return routeCache.get(relative);
  const file = path.resolve(root, relative || '.');
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  const result = [file, file + '.html', path.join(file, 'index.html')].find(exists) ?? null;
  routeCache.set(relative, result);
  return result;
}

for (const route of routes) {
  if (!resolveRoute(route)) errors.push(`Missing page: /${route}`);
}
for (const asset of ['assets/css/style.css', 'assets/js/app.js', 'assets/js/analytics.js', 'assets/js/sql-wasm.wasm']) {
  if (!exists(path.join(root, asset))) errors.push(`Missing asset: ${asset}`);
}
const workers = path.join(root, 'assets/js/assets');
if (!fs.existsSync(workers) || !fs.readdirSync(workers).some(name => /^embed-worker-.*\.js$/.test(name))) {
  errors.push('Missing embedding Web Worker');
}

let htmlCount = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) {
      errors.push(`Unexpected symbolic link: ${relative}`);
      continue;
    }
    const privateDirectory = /^(sources|scripts|worker|models|data|node_modules|tools|vendor|docs|eval|\.github|\.agents|\.claude|\.codex)\//;
    const privateFile = /^(README\.md|CLAUDE\.md|AGENTS\.md|Gemfile.*|package.*\.json|\.env.*)$/;
    if (privateDirectory.test(relative) || privateFile.test(relative) || /\.(db|onnx)(\.|$)/.test(relative)) {
      errors.push(`Non-site file in output: ${relative}`);
    }
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    htmlCount++;
    const html = fs.readFileSync(absolute, 'utf8');
    const ids = new Set();
    for (const [, id] of html.matchAll(/\sid=["']([^"']+)["']/g)) {
      if (ids.has(id)) errors.push(`${relative}: duplicate HTML id: ${id}`);
      ids.add(id);
    }
    const pageUrl = new URL(`${base}/${relative}`, 'https://site.invalid');
    for (const [, raw] of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      if (raw.startsWith('#') || /^(?:https?:|mailto:|data:|javascript:|\/\/)/.test(raw)) continue;
      const url = new URL(raw.replaceAll('&amp;', '&'), pageUrl);
      if (!url.pathname.startsWith(base + '/') && url.pathname !== base) {
        errors.push(`${relative}: link escapes site prefix: ${raw}`);
        continue;
      }
      if (!resolveRoute(decodeURIComponent(url.pathname.slice(base.length)).replace(/^\//, ''))) {
        errors.push(`${relative}: missing local target: ${raw}`);
      }
    }
  }
}

if (fs.existsSync(root)) walk(root);
else errors.push('Missing _site directory; run the build first.');

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Verified ${htmlCount} HTML pages, ${routes.length} routes, unique IDs, local links, browser assets, and publication exclusions under ${base}/.`);
}
