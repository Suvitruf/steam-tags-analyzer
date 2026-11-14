import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the shipped resolver and Worker client without downloaded databases
// or model files. Only the two local-data queries are replaced by fixture rows.
const bundled = await build({
  entryPoints: [new URL('../../sources/lib/recommendation/competitors.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
  define: {
    'import.meta.env.VITE_ANALYTICS_BASE': 'undefined',
    'import.meta.env.VITE_STEAM_PROXY_URL': JSON.stringify('https://steam.example.test'),
  },
  plugins: [{
    name: 'local-competitor-fixture',
    setup(b) {
      b.onResolve({ filter: /\/db\/queries$/ }, () => ({ path: 'queries', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        const tags = new Map([[10, [1, 2]], [20, [1, 3]]]);
        export const getAppTagsForApps = ids => new Map(ids.map(id =>
          [id, (tags.get(id) || []).map((tag_id, i) => ({tag_id, rank: i + 1}))]));
        export const getGameInfoForApps = ids => new Map(ids.filter(id => id <= 40).map(id =>
          [id, {name: 'Dataset ' + id, reviews: 10}]));
      ` }));
    },
  }],
});
const { parseCompetitorAppids, resolveCompetitors, competitorOverlap } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('competitor IDs are strict and deduplicated', () => {
  assert.deepEqual(parseCompetitorAppids('10, 20, 10'), [10, 20]);
  assert.deepEqual(parseCompetitorAppids(' '), []);
  for (const bad of ['10oops', '10,', '10,,20', '-1', '0', '1.5', '1e3', '4294967296']) {
    assert.throws(() => parseCompetitorAppids(bad), /positive whole numbers/);
  }
});

test('local/live evidence excludes failed, empty and duplicate votes; failed lookups retry', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  let active = 0, peak = 0, recovered = false;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://steam.example.test/app/'));
    const id = Number(String(url).split('/').at(-1));
    requested.push(id);
    peak = Math.max(peak, ++active);
    try {
      if (id === 900) {
        return await new Promise((_, reject) => options.signal.addEventListener('abort',
          () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 1));
      if (id === 404 || id === 503) return new Response('', { status: id });
      const tags = id === 40 && !recovered ? [] : [1, 3, 3, 0, -1, 1.5];
      return Response.json({ name: 'Steam ' + id, tags: tags.map(tagid => ({ tagid })), coming_soon: true });
    } finally {
      active--;
    }
  };
  try {
    const local = await resolveCompetitors([10, 20, 10]);
    assert.deepEqual(requested, []);
    assert.equal(local.length, 2);
    assert.equal(competitorOverlap(local).get(1), 1);
    assert.equal(competitorOverlap(local).get(2), 0.5);
    const mixed = await resolveCompetitors([10, 20, 30, 30, 404, 503, 40, 900], { timeoutMs: 50 });
    assert.deepEqual(mixed.map(c => c.appid), [10, 20, 30, 404, 503, 40, 900]);
    assert.equal(peak, 3);
    assert.ok(!requested.includes(10) && !requested.includes(20));
    assert.equal(requested.filter(id => id === 30).length, 1);
    assert.equal(mixed[2].source, 'live');
    assert.deepEqual(mixed[2].tagIds, [1, 3]);
    assert.match(mixed[3].issue, /no Steam store page/);
    assert.match(mixed[4].issue, /try again/);
    assert.match(mixed[5].issue, /no tags/);
    assert.match(mixed[6].issue, /timed out/);
    const overlap = competitorOverlap(mixed);
    assert.equal(overlap.get(1), 1);
    assert.equal(overlap.get(2), 1 / 3);
    assert.equal(overlap.get(3), 2 / 3);
    assert.deepEqual(competitorOverlap([...mixed, mixed[2]]), overlap);
    assert.equal(competitorOverlap(mixed.slice(3)).size, 0);
    recovered = true;
    assert.equal((await resolveCompetitors([40]))[0].source, 'live');
    const before = requested.length;
    const disabled = await resolveCompetitors([10, 30], { lookup: null });
    assert.equal(requested.length, before);
    assert.match(disabled[1].issue, /not configured/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
