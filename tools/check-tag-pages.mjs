import fs from 'node:fs';
import path from 'node:path';
import { tagIdFromPath } from '../sources/lib/tag-route.mjs';

const root = path.resolve('_site');
const base = (process.env.SITE_BASE_PATH ?? '').replace(/\/$/, '');
const directory = JSON.parse(fs.readFileSync(path.join(root, 'assets/tag-pages.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/tag-pages-manifest.json')));
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const index = fs.readFileSync(path.join(root, 'tags/index.html'), 'utf8');
const escape = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const errors = [];
if (!directory.tags.length || directory.snapshotId !== manifest.snapshotId) errors.push('Missing or mixed tag-page snapshot');
for (const tag of directory.tags) {
  const file = path.join(root, decodeURIComponent(tag.path), 'index.html');
  if (!fs.existsSync(file)) { errors.push(`Missing static tag page: ${tag.path}`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const pathname = base + tag.path;
  if (tagIdFromPath(tag.path) !== tag.id) errors.push(`Incorrect route ID: ${tag.path}`);
  if (!html.includes(`<h1>${escape(tag.name)} Steam tag</h1>`) || !html.includes('class="stat-value"')) errors.push(`Missing static tag content: ${tag.path}`);
  if (!html.includes(manifest.generatedAt.slice(0, 10))) errors.push(`Missing snapshot date: ${tag.path}`);
  if (!html.includes(`name="analytics-manifest" content="${base}/assets/tag-pages-manifest.json"`)) errors.push(`Missing pinned manifest: ${tag.path}`);
  if ((html.match(/<title>/g) || []).length !== 1 || (html.match(/name="description"/g) || []).length !== 1) errors.push(`Duplicate/missing page metadata: ${tag.path}`);
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (!canonical || new URL(canonical).pathname !== pathname) errors.push(`Incorrect canonical: ${tag.path}`);
  if (!html.includes('property="og:title"') || !html.includes('property="og:description"')) errors.push(`Missing sharing metadata: ${tag.path}`);
  if (!sitemap.includes(pathname) || !index.includes(`href="${pathname}"`)) errors.push(`Tag missing from sitemap or directory: ${tag.path}`);
}
if (!fs.readFileSync(path.join(root, '404.html'), 'utf8').includes('/assets/js/tag-redirect.js')) errors.push('Missing ID redirect on 404 page');
if (!fs.readFileSync(path.join(root, 'robots.txt'), 'utf8').includes(`${base}/sitemap.xml`)) errors.push('Missing sitemap discovery');
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Verified ${directory.tags.length} static tag pages, metadata, snapshot pinning, directory and sitemap.`);
