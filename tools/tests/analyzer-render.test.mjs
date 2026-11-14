// Run the real result builders against hostile Steam names and lookup errors.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

globalThis.document = { querySelector: () => null };
globalThis.location = { search: '?threshold=250&gameType=paid' };

const result = await build({
  entryPoints: [new URL('../../sources/lib/ui/results.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
  define: { 'import.meta.env.DEV': 'false' },
});
const { renderResultsHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);

const PAYLOAD = `<img src=x onerror="alert(1)">'"&`;
const ESCAPED = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&quot;&amp;';
const tag = (name, extra = {}) => ({
  tag: name, tagId: 7, score: 0.5, relevance: 0.6, successLift: 1.5, confidence: 0.8,
  explanation: `because ${PAYLOAD}`, exemplarGames: [{ appid: 10, name: PAYLOAD }], ...extra,
});
const output = {
  primaryTags: [tag(`Tag ${PAYLOAD}`)],
  secondaryTags: [tag('Plain', { exemplarGames: [] })],
  avoidTags: [tag('Avoid', { exemplarGames: [] })],
  segment: { segment_id: 1, main_tag_id: 7, main_tag_name: `Seg ${PAYLOAD}`, game_count: 42, release_year: null, price_bucket: null },
  segmentInferred: true,
  analyzedApp: { appid: 1, name: PAYLOAD },
  currentTagIds: [7],
  similarGames: [{ appid: 2, name: PAYLOAD, similarity: 0.9, reviews: 1500 }],
  neighborEvidenceAvailable: true,
};

const html = renderResultsHtml(output);
assert.doesNotMatch(html, /<img/, 'raw payload leaked into element context');
assert.doesNotMatch(html, /onerror="/, 'raw payload leaked into an attribute');
// Game name, segment name, tag name, three explanations, exemplar, the segment
// name again in the exemplar note's title, similar game.
const sites = html.split(ESCAPED).length - 1;
assert.equal(sites, 9, `expected the escaped payload at 9 sites, found ${sites}`);
// Attribute values stay balanced: every href/title closes on its own quote.
for (const m of html.matchAll(/(href|title)="([^"]*)"/g)) {
  assert.doesNotMatch(m[2], /[<>"]/, `unescaped character inside ${m[1]}: ${m[2]}`);
}
assert.match(html, /href="https:\/\/store\.steampowered\.com\/app\/10\/"/);
assert.match(html, /href="\/tags\/7-tag-img-src-x-onerror-alert-1\/\?threshold=250&amp;gameType=paid"/);
assert.match(html, /already using/);
// Evidence caveats replace the old confidence percentage.
assert.doesNotMatch(html, /Confidence:/);
assert.match(html, /inferred from the description/);
assert.match(html, /Small segment \(42 games\)/);
assert.doesNotMatch(html, /% match/);
const withCompetitors = renderResultsHtml({ ...output, competitors: [
  { appid: 10, name: PAYLOAD, tagIds: [7], source: 'dataset' },
  { appid: 20, name: 'Live game', tagIds: [7, 8], source: 'live' },
  { appid: 30, name: PAYLOAD, tagIds: [], source: 'unavailable', issue: PAYLOAD },
] });
assert.match(withCompetitors, /2 of 3 games included/);
assert.match(withCompetitors, /Shared-tag percentages use only included games/);
assert.match(withCompetitors, /Not counted:/);
assert.match(withCompetitors, /\(Steam\)/);
assert.doesNotMatch(withCompetitors, /<img|onerror="/);
assert.match(renderResultsHtml({ ...output, competitors: [
  { appid: 30, name: 'Missing', tagIds: [], source: 'unavailable', issue: 'No tags' },
] }), /No competitor bonus was applied/);
console.log('Analyzer render escaping checks passed.');
