import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tagSegment, tagPath, tagIdFromPath, tagIdFromHash } from '../../sources/lib/tag-route.mjs';
import { generateTagPages, loadTagSnapshot } from '../generate-tag-pages.mjs';

test('tag URLs are readable and only the numeric ID controls selection', () => {
  assert.equal(tagPath(492, 'Indie'), '/tags/492-indie/');
  assert.equal(tagPath(122, 'Point & Click', '/steam-tags/'), '/steam-tags/tags/122-point-click/');
  assert.equal(tagSegment(12, '  Игры / 日本語 + VR  '), '12-игры-日本語-vr');
  assert.equal(tagPath(12, 'Игры'), '/tags/12-%D0%B8%D0%B3%D1%80%D1%8B/');
  for (const url of ['/tags/492-indie/', '/tags/492-old-name/', '/tags/492/', '/steam-tags/tags/492-%E6%97%A5/']) assert.equal(tagIdFromPath(url), 492);
  for (const url of ['/tags/0-indie/', '/tags/492evil/', '/tags/492/a/', '/tags/9007199254740992-x/', '/tags/']) assert.equal(tagIdFromPath(url), null);
  assert.equal(tagIdFromHash('#492'), 492);
  for (const hash of ['#492other', '#0', '#-3', '#9007199254740992']) assert.equal(tagIdFromHash(hash), null);
  assert.throws(() => tagPath(-1, 'Indie'));
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tag-pages-test-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const source = path.join(dir, 'input'), root = path.join(dir, 'site');
  const manifest = {schemaVersion: 2, snapshotId: 'test', basePath: 'releases/test', generatedAt: '2026-11-01T00:00:00.000Z', coverage: {}, artifacts: {}};
  const summary = {schemaVersion: 2, snapshotId: 'test', generatedAt: manifest.generatedAt, gameCount: 100, baseline: {h250: 0.2}, tags: [
    {id: 492, name: 'Indie', count: 80, rated: 30, releases365: 5, medianReviews: 21, hitRates: {h250: 0.25}, love: 0.8},
    {id: 12, name: 'Игры & "<script>"', count: 1, rated: 1, releases365: 0, medianReviews: 1, hitRates: {h250: 0}, love: 0.9},
    {id: 13, name: 'No observations', count: 0, rated: 0, releases365: 0, medianReviews: 0, hitRates: {h250: 0}, love: null},
  ]};
  const write = async () => {
    const bytes = Buffer.from(JSON.stringify(summary));
    manifest.artifacts['tags-summary.json'] = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    for (const tag of summary.tags) manifest.artifacts[`tags/${tag.id}.json`] = {};
    await fs.mkdir(path.join(source, manifest.basePath), {recursive: true});
    await fs.writeFile(path.join(source, manifest.basePath, 'tags-summary.json'), bytes);
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  };
  await write();
  return {source, root, summary, manifest, write};
}

test('static pages, routing catalog and browser manifest use the same immutable snapshot', async t => {
  const f = await fixture(t);
  const directory = await generateTagPages(f);
  assert.equal(directory.tags.length, 3);
  const html = await fs.readFile(path.join(f.root, '_tag_pages/tag-492.html'), 'utf8');
  const front = JSON.parse(html.slice(4, -5));
  assert.equal(front.permalink, '/tags/492-indie/');
  assert.equal(front.tag.rateLabel, '25.0%');
  assert.equal(front.tag.loveLabel, '80.0%');
  assert.match(front.description, /80 tracked games/);
  assert.equal(directory.tags.find(t => t.id === 12).loveLabel, 'Not enough data');
  assert.equal(directory.tags.find(t => t.id === 13).rateLabel, 'Not available');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'assets/tag-pages-manifest.json'))), f.manifest);
  const catalog = JSON.parse(await fs.readFile(path.join(f.root, 'assets/tag-pages.json')));
  assert.equal(catalog.snapshotId, 'test');
  assert.equal(catalog.tags.find(t => t.id === 12).path, tagPath(12, f.summary.tags[1].name));
});

test('failed or mixed CDN inputs cannot overwrite previously generated pages', async t => {
  const f = await fixture(t);
  await generateTagPages(f);
  const file = path.join(f.root, '_tag_pages/tag-492.html');
  const original = await fs.readFile(file, 'utf8');
  await fs.appendFile(path.join(f.source, f.manifest.basePath, 'tags-summary.json'), ' ');
  await assert.rejects(generateTagPages(f), /checksum/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  f.summary.snapshotId = 'different';
  await f.write();
  await assert.rejects(loadTagSnapshot(f.source), /snapshot/);
  f.summary.snapshotId = 'test'; f.summary.tags[1].id = 492;
  await f.write();
  await assert.rejects(loadTagSnapshot(f.source), /Invalid tag summary/);
});

test('regeneration removes obsolete generated pages, preserving unrelated files', async t => {
  const f = await fixture(t);
  await generateTagPages(f);
  await fs.writeFile(path.join(f.root, '_tag_pages/notes.txt'), 'keep');
  f.summary.tags.splice(1);
  await f.write();
  await generateTagPages(f);
  assert.deepEqual((await fs.readdir(path.join(f.root, '_tag_pages'))).sort(), ['notes.txt', 'tag-492.html']);
});
