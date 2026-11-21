import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { releaseMetadata } from '../tools/release.mjs';

const template = await fs.readFile(new URL('../metadata.txt', import.meta.url), 'utf8');
const config = JSON.parse(await fs.readFile(new URL('../release.json', import.meta.url), 'utf8'));
const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
test('public installation and update metadata retain the existing script identity', () => {
  const header = releaseMetadata(template, version, config);
  const field = name => header.match(new RegExp(`^// @${name} +(.+)$`, 'm'))?.[1];
  assert.equal(field('name'), 'Steam Tag Analyzer — Audit');
  assert.equal(field('namespace'), 'https://steam-tags-analyzer.apanasik.com/');
  assert.equal(field('version'), version);
  assert.equal(field('downloadURL'), `${config.rawBase}steam-tag-audit.user.js`);
  assert.equal(field('updateURL'), `${config.rawBase}steam-tag-audit.meta.js`);
  assert.equal(field('supportURL'), config.supportUrl);
  assert.ok(!header.includes('{{'));
  assert.ok(header.split('\n').every(line => line === '' || line.startsWith('//')));
  assert.equal(releaseMetadata(template.replace(/\r?\n/g, '\r\n'), version, config), header);
});
test('changing the release prefix relocates both download files without source changes', () => {
  const changed = releaseMetadata(template, '1.2.3', { ...config, rawBase:'https://example.org/project/userscript/dist/' });
  assert.match(changed, /@downloadURL\s+https:\/\/example.org\/project\/userscript\/dist\/steam-tag-audit.user.js/);
  assert.match(changed, /@updateURL\s+https:\/\/example.org\/project\/userscript\/dist\/steam-tag-audit.meta.js/);
  assert.throws(() => releaseMetadata(template, version, {...config,rawBase:'https://example.org/no-slash'}));
  assert.throws(() => releaseMetadata(template, version, {...config,rawBase:'http://example.org/'}));
  assert.throws(() => releaseMetadata(template, version, {...config,supportUrl:'https://example.org/?query=1'}));
});
