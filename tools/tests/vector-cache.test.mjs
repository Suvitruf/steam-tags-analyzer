import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the shipped loader and the recommender's cache together. Synthetic
// vectors need no model download, private database or production connection.
const bundled = await build({
  stdin: {
    contents: `
      export { loadGameVectors, GAME_VECTOR_CACHE } from './sources/lib/llm/game-knn';
      export { getCachedGameVectors } from './sources/lib/recommendation/engine';
      export { setInferenceStore } from './sources/lib/inference/store';
      export { gameVectorsUrl } from './sources/lib/config';
    `,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_ANALYTICS_BASE': 'undefined',
    'import.meta.env.VITE_STEAM_PROXY_URL': 'undefined',
    'import.meta.env.VITE_INFERENCE_MANIFEST_URL': 'undefined',
  },
  plugins: [{
    name: 'no-sql-on-pack-path',
    setup(b) {
      b.onResolve({ filter: /(?:^|\/)client$/ }, args => {
        if (args.path.endsWith('/db/client') || (args.path === './client' && args.resolveDir.endsWith('/db'))) {
          return { path: 'sql', namespace: 'fixture' };
        }
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export function query() { throw new Error('The pack path must not query SQL'); }
        export const queryOne = query;
        export const loadDatabase = query;
      ` }));
    },
  }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function blob(setId, appid = 620) {
  const bytes = new Uint8Array(96), view = new DataView(bytes.buffer);
  bytes.set([0x47, 0x56, 0x45, 0x43]);
  view.setUint32(4, 2, true); view.setUint32(8, 1, true);
  view.setUint32(12, 4, true); view.setUint32(16, 0, true);
  view.setFloat32(20, 127, true); bytes.set(new TextEncoder().encode(setId), 24);
  view.setUint32(88, appid, true); bytes.set([127, 0, 0, 0], 92);
  return bytes;
}

const a = blob('set-a'), b = blob('set-b');
const identityA = { setId: 'set-a', sha256: hash(a) };
const identityB = { setId: 'set-b', sha256: hash(b) };
const urlA = 'https://cdn.example/data/set-a/game-vectors-gte-base.bin';
const urlB = 'https://cdn.example/data/set-b/game-vectors-gte-base.bin';

async function environment(t, run) {
  const originalFetch = globalThis.fetch;
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const buckets = new Map(), files = new Map([[urlA, a], [urlB, b]]), requests = [];
  const state = { denied: false, failWrites: false };
  const entries = (name = api.GAME_VECTOR_CACHE) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
    has: async name => buckets.has(name),
    open: async name => {
      if (state.denied) throw new Error('storage denied');
      const data = entries(name);
      return {
        match: async key => data.get(key)?.clone(),
        put: async (key, response) => {
          if (state.failWrites) throw new Error('quota');
          data.set(key, response.clone());
        },
        delete: async key => data.delete(typeof key === 'string' ? key : key.url),
        keys: async () => [...data.keys()].map(url => new Request(url)),
      };
    },
  } });
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    const bytes = files.get(url);
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  // Storage failures are intentional fixtures; assertions check the fallback.
  t.mock.method(console, 'warn', () => {});
  try { await run({ entries, files, requests, state }); }
  finally {
    api.setInferenceStore(null);
    globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
}

test('verified vectors load offline without fetch or download progress', t => environment(t, async ({ requests }) => {
  await api.loadGameVectors(urlA, undefined, identityA);
  assert.deepEqual(requests, [urlA]);
  globalThis.fetch = async () => { throw new Error('Unexpected network access'); };
  let progress = 0;
  const hit = await api.loadGameVectors(urlA, () => progress++, identityA);
  assert.equal(hit.setId, 'set-a'); assert.equal(hit.appids[0], 620);
  assert.equal(progress, 0);
}));

test('corrupt cache is repaired and replacing a set retains other models', t => environment(t, async ({ entries, requests }) => {
  entries().set(urlA, new Response('corrupt'));
  await api.loadGameVectors(urlA, undefined, identityA);
  assert.deepEqual(requests, [urlA]);
  assert.equal(hash(new Uint8Array(await entries().get(urlA).arrayBuffer())), identityA.sha256);
  const mini = 'https://cdn.example/data/mini/game-vectors-minilm.bin';
  entries().set(mini, new Response('another model'));
  await api.loadGameVectors(urlB, undefined, identityB);
  assert.ok(!entries().has(urlA)); assert.ok(entries().has(urlB)); assert.ok(entries().has(mini));
}));

test('wrong network hashes and model-set IDs never enter the cache', t => environment(t, async ({ entries }) => {
  await assert.rejects(api.loadGameVectors(urlB, undefined, identityA), /integrity/);
  assert.ok(!entries().has(urlB));
  await assert.rejects(api.loadGameVectors(urlB, undefined, { ...identityB, setId: 'wrong' }), /model set/);
  assert.ok(!entries().has(urlB));
}));

test('legacy cache migrates without a download and survives failed writes', t => environment(t, async ({ entries, state }) => {
  const legacy = entries('steam-tags-local-runtime-v1');
  legacy.set(urlA, new Response(a));
  globalThis.fetch = async () => { throw new Error('Migration must not download'); };
  await api.loadGameVectors(urlA, undefined, identityA);
  assert.ok(entries().has(urlA)); assert.ok(!legacy.has(urlA));
  entries().delete(urlA); legacy.set(urlA, new Response(a));
  state.failWrites = true;
  await api.loadGameVectors(urlA, undefined, identityA);
  assert.ok(legacy.has(urlA));
  assert.ok(!entries().has(urlA));
}));

test('storage denial, quota and absent Cache API preserve network loading', t => environment(t, async ({ state, requests }) => {
  state.denied = true;
  assert.equal((await api.loadGameVectors(urlA, undefined, identityA)).setId, 'set-a');
  state.denied = false; state.failWrites = true;
  assert.equal((await api.loadGameVectors(urlA, undefined, identityA)).setId, 'set-a');
  Reflect.deleteProperty(globalThis, 'caches');
  assert.equal((await api.loadGameVectors(urlA, undefined, identityA)).setId, 'set-a');
  assert.equal(requests.length, 3);
}));

test('unfingerprinted legacy files retain HTTP freshness', t => environment(t, async ({ entries, requests }) => {
  await api.loadGameVectors(urlA);
  await api.loadGameVectors(urlA);
  assert.equal(requests.length, 2);
  assert.ok(!entries().has(urlA));
}));

test('recommender shares downloads, rejects stale fingerprints and retries failures', t => environment(t, async ({ files, requests, entries }) => {
  const model = 'gte-base';
  const select = identity => api.setInferenceStore({ manifest: { models: {
    [model]: { row: { set_id: identity.setId, vectors_sha256: identity.sha256 } },
  } } });
  const firstUrl = api.gameVectorsUrl(model, identityA.setId);
  const secondUrl = api.gameVectorsUrl(model, identityB.setId);
  files.set(firstUrl, a); files.set(secondUrl, b);
  select(identityA);
  const first = api.getCachedGameVectors(model), concurrent = api.getCachedGameVectors(model);
  assert.strictEqual(first, concurrent);
  assert.equal((await first).setId, 'set-a');
  assert.deepEqual(requests, [firstUrl]);
  assert.ok(entries().has(firstUrl), 'recommender must pass the fingerprint to the persistent cache');

  select(identityB);
  assert.equal((await api.getCachedGameVectors(model)).setId, 'set-b');
  assert.deepEqual(requests, [firstUrl, secondUrl]);

  // A changed fingerprint at the same URL must not reuse the previous promise.
  const changed = blob('set-b', 730);
  select({ ...identityB, sha256: hash(changed) });
  await assert.rejects(api.getCachedGameVectors(model), /integrity/);
  assert.ok(!entries().has(secondUrl));
  files.set(secondUrl, changed);
  assert.equal((await api.getCachedGameVectors(model)).appids[0], 730);
  assert.deepEqual(requests, [firstUrl, secondUrl, secondUrl, secondUrl]);
}));
