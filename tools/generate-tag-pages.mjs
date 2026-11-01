import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tagSegment, tagPath } from '../sources/lib/tag-route.mjs';

export const DEFAULT_SOURCE = 'https://projects.cdn.aapanasik.com/steam-tags/analytics';
const integer = n => Number.isSafeInteger(n) && n >= 0;
const fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
const fmt = n => n.toLocaleString('en-US', {maximumFractionDigits: 1});
const pct = n => `${(n * 100).toFixed(1)}%`;

async function read(source, file) {
  if (!/^https?:\/\//.test(source)) return fs.readFile(path.join(source, file));
  const url = `${source.replace(/\/$/, '')}/${file}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30000), cache: 'no-cache'});
      if (!response.ok) throw new Error(`Tag page input unavailable: HTTP ${response.status} (${file})`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export async function loadTagSnapshot(source) {
  const manifest = JSON.parse(await read(source, 'manifest.json'));
  if (manifest.schemaVersion !== 2 || typeof manifest.snapshotId !== 'string'
      || !/^releases\/[\w-]+$/.test(manifest.basePath) || !Number.isFinite(Date.parse(manifest.generatedAt))
      || !manifest.coverage || !manifest.artifacts?.['tags-summary.json']) throw new Error('Invalid tag-page manifest');
  const body = await read(source, `${manifest.basePath}/tags-summary.json`);
  const expected = manifest.artifacts['tags-summary.json'];
  if (body.length !== expected.bytes || createHash('sha256').update(body).digest('hex') !== expected.sha256) throw new Error('Tag summary checksum mismatch');
  const summary = JSON.parse(body);
  if (summary.snapshotId !== manifest.snapshotId || summary.schemaVersion !== manifest.schemaVersion
      || summary.generatedAt !== manifest.generatedAt || !integer(summary.gameCount)
      || !fraction(summary.baseline?.h250) || !Array.isArray(summary.tags) || !summary.tags.length) throw new Error('Invalid tag summary snapshot');
  const ids = new Set();
  for (const tag of summary.tags) {
    if (!integer(tag.id) || tag.id === 0 || ids.has(tag.id) || typeof tag.name !== 'string' || !tag.name.trim()
        || !integer(tag.count) || tag.count > summary.gameCount || !integer(tag.rated) || tag.rated > tag.count
        || !integer(tag.releases365) || tag.releases365 > tag.count || !Number.isFinite(tag.medianReviews) || tag.medianReviews < 0
        || !fraction(tag.hitRates?.h250) || (tag.love !== null && !fraction(tag.love))
        || !manifest.artifacts[`tags/${tag.id}.json`]) throw new Error(`Invalid tag summary: ${tag.id}`);
    ids.add(tag.id);
  }
  return {manifest, summary};
}

export async function generateTagPages({source = DEFAULT_SOURCE, root = process.cwd()} = {}) {
  // Validate the complete input before replacing any generated files. A CDN
  // failure fails the build; previously deployed pages remain available.
  const {manifest, summary} = await loadTagSnapshot(source);
  const tags = summary.tags.map(tag => ({
    ...tag, path: tagPath(tag.id, tag.name),
    gamesLabel: fmt(tag.count), releasesLabel: fmt(tag.releases365), medianLabel: fmt(tag.medianReviews),
    rateLabel: tag.count ? pct(tag.hitRates.h250) : 'Not available',
    loveLabel: tag.rated >= 30 && tag.love !== null ? pct(tag.love) : 'Not enough data',
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const directory = {snapshotId: manifest.snapshotId, generatedAt: manifest.generatedAt, tags};
  const pages = path.join(root, '_tag_pages');
  await fs.mkdir(pages, {recursive: true});
  // This directory is build output; leave unrelated files alone.
  for (const name of await fs.readdir(pages)) if (/^tag-\d+\.html$/.test(name)) await fs.unlink(path.join(pages, name));
  for (const tag of tags) {
    const frontMatter = {
      layout: 'tag', tag_page: true, title: `${tag.name} Steam games: tag statistics`,
      seo: {type: 'WebPage'}, last_modified_at: manifest.generatedAt,
      description: `${tag.name} on Steam: ${tag.gamesLabel} tracked games, ${tag.medianLabel} median reviews${tag.count ? `, and ${tag.rateLabel} reaching 250+ reviews` : ''}. Explore the tag's games, review distribution and related tags.`,
      permalink: `/tags/${tagSegment(tag.id, tag.name)}/`,
      tag, snapshot_date: manifest.generatedAt.slice(0, 10),
      baseline_label: pct(summary.baseline.h250), catalog_games_label: fmt(summary.gameCount),
    };
    // JSON is valid YAML; quoting all strings also keeps tag names out of
    // Liquid source and prevents punctuation from changing front matter.
    await fs.writeFile(path.join(pages, `tag-${tag.id}.html`), `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n`);
  }
  await fs.mkdir(path.join(root, '_data'), {recursive: true});
  await fs.mkdir(path.join(root, 'assets'), {recursive: true});
  await fs.writeFile(path.join(root, '_data/tag_pages.json'), JSON.stringify(directory));
  await fs.writeFile(path.join(root, 'assets/tag-pages.json'), JSON.stringify({
    snapshotId: manifest.snapshotId, generatedAt: manifest.generatedAt,
    tags: tags.map(({id, name, path}) => ({id, name, path})),
  }));
  await fs.writeFile(path.join(root, 'assets/tag-pages-manifest.json'), JSON.stringify(manifest));
  console.log(`Generated ${tags.length} static tag pages from ${manifest.snapshotId}.`);
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  await generateTagPages({root, source: process.env.TAG_PAGES_SOURCE || process.env.VITE_ANALYTICS_BASE || DEFAULT_SOURCE});
}
