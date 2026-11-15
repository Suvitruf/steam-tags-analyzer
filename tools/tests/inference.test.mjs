import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Public-client tests are self-contained: no private pipeline, datasets,
// encoder files or network. Only SQL is stubbed, to catch accidental queries
// on the pack path; the real loader, query facade and hash checks run below.
const bundled = await build({
  stdin: {
    contents: `
      export * from './sources/lib/inference/format';
      export * from './sources/lib/inference/loader';
      export * from './sources/lib/inference/store';
      export * from './sources/lib/db/queries';
      export { centroidsFingerprint, tagStatsFingerprint, readModelSet } from './sources/lib/matched-set';
      export { auditGame, classifyTag } from './sources/lib/recommendation/audit';
      export { renderTagRow } from './sources/lib/audit/ui';
      export * from './sources/lib/audit/precomputed';
      export { loadRanker } from './sources/lib/scoring/ranker';
      export { GAME_VECTOR_MODELS } from './sources/lib/config';
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
const BASE = 'https://inference.example.test/';
const MODEL = 'gte-base';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

function fixture() {
  const files = new Map();
  const file = (folder, body) => {
    const sha256 = hash(body), compressed = gzipSync(body);
    const ref = { path: `${folder}/${sha256}.gz`, sha256, bytes: body.length, gzipBytes: compressed.length };
    files.set(new URL(ref.path, BASE).href, compressed);
    return ref;
  };
  const tags = [
    { tag_id: 1, name: 'Roguelike', normalized_name: 'roguelike', is_active: 1 },
    { tag_id: 2, name: 'Deckbuilder', normalized_name: 'deckbuilder', is_active: 1 },
    { tag_id: 3, name: 'Old tag', normalized_name: 'old tag', is_active: 0 },
    { tag_id: 4, name: 'Unmodeled tag', normalized_name: 'unmodeled tag', is_active: 1 },
  ];
  const core = file('snapshots', api.encodePack({
    kind: 'core', tags, names: ['Alpha', 'Beta', 'Quiet'], dates: ['2026-11-01', '2026-11-02'],
    segments: [{ segment_id: 100, main_tag_id: 1, main_tag_name: 'Roguelike', release_year: null, price_bucket: null, game_count: 2 }],
    scores: [[100, 2, 2.5, 0.8, 2, 1, 0.5, 1]], removed: { 3: '2026-01-01' },
    gameCount: 3, tagCount: 5, topCount: 2,
  }, {
    appids: bytes(new Uint32Array([10, 20, 30])), offsets: bytes(new Uint32Array([0, 3, 5, 5])),
    tags: bytes(new Uint16Array([0, 1, 2, 0, 1])), ranks: new Uint8Array([1, 3, 2, 255, 1]),
    reviews: bytes(new Float64Array([1000, 100, NaN])), observed: bytes(new Uint32Array([1, 2, 0])),
    topSegments: bytes(new Uint32Array([100, 100])), topApps: bytes(new Uint32Array([0, 1])),
  }));
  // Taxonomy can add an active tag before the next model rebuild. Conversely,
  // the model file still contains a centroid for a now-inactive tag.
  const modelTags = tags.slice(0, 3);
  const stats = modelTags.map((t, i) => ({ tag_id: t.tag_id, game_count: i + 1, avg_rank: 2.5, idf: i === 2 ? null : 1.1, top1_rate: 0.3 }));
  const statsBytes = Buffer.alloc(3 * 36);
  for (const [i, r] of stats.entries()) {
    statsBytes.writeUInt32LE(r.tag_id, i * 36); statsBytes.writeBigInt64LE(BigInt(r.game_count), i * 36 + 4);
    [r.avg_rank, r.idf, r.top1_rate].forEach((v, j) => statsBytes.writeDoubleLE(v ?? NaN, i * 36 + 12 + j * 8));
  }
  const embeddings = bytes(new Float32Array([1, 0, 0, 1, 0.5, 0.5]));
  const centroidBytes = Buffer.concat(modelTags.map((t, i) => {
    const id = Buffer.alloc(4); id.writeUInt32LE(t.tag_id);
    return Buffer.concat([id, embeddings.subarray(i * 8, i * 8 + 8)]);
  }));
  const row = {
    model_name: MODEL, set_id: 'gte-base-test', created_at: '2026-11-01',
    centroids_sha256: hash(centroidBytes), tag_stats_sha256: hash(statsBytes),
    ranker_sha256: 'a'.repeat(64), vectors_sha256: 'b'.repeat(64), encoder_sha256: 'c'.repeat(64),
    encoder_probe: JSON.stringify({ text: 'probe', embedding: [1, 0] }), notes: null,
  };
  const model = file(`sets/${row.set_id}`, api.encodePack({
    kind: 'model', model: MODEL, setId: row.set_id, stats,
    centroids: modelTags.map((t, i) => ({ tagId: t.tag_id, offset: i * 8, length: 8 })),
  }, { embeddings }));
  const apps = [10, 20, 30].map((appid, i) => ({
    appid, name: ['Alpha', 'Beta', 'Quiet'][i], type: 'game', is_released: 1,
    short_description: `Description ${appid}`, categories: 'Single-player', genres: 'Indie',
    release_date: '2024-01-01', price_usd: 999, developer: null, publisher: null,
  }));
  const details = Array.from({ length: 256 }, (_, bucket) => file('details',
    Buffer.from(JSON.stringify(apps.filter(a => api.detailBucket(a.appid) === bucket)))));
  const manifest = { version: 1, core, models: { [MODEL]: { row, file: model } }, details };
  return { files, manifest, apps };
}

async function environment(run) {
  const f = fixture(), originalFetch = globalThis.fetch, originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const entries = new Map(), requests = [];
  const storage = {
    async match(url) { return entries.get(url)?.clone(); },
    async put(url, response) { entries.set(url, response.clone()); },
    async delete(request) { return entries.delete(typeof request === 'string' ? request : request.url); },
    async keys() { return [...entries.keys()].map(url => new Request(url)); },
  };
  const network = async input => {
    const url = String(input); requests.push(url);
    if (url === BASE + 'manifest.json') return Response.json(f.manifest);
    const body = f.files.get(url);
    return body ? new Response(body, { headers: { 'Content-Length': String(body.length) } }) : new Response('', { status: 404 });
  };
  globalThis.fetch = network;
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => storage } });
  try { await run({ ...f, requests, entries, network }); }
  finally {
    api.setInferenceStore(null); globalThis.fetch = originalFetch;
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
}

test('pack queries preserve ranks, nulls, taxonomy, exemplars and matched-set fingerprints without SQL', () => environment(async ({ manifest, apps, requests }) => {
  const store = await api.loadInference(BASE + 'manifest.json');
  assert.equal(store.details.size, 0);
  assert.equal(api.getAppById(10).short_description, null);
  assert.deepEqual(api.getAllTags().map(t => t.tag_id), [2, 1, 4]);
  assert.deepEqual(api.getAppTags(10).map(t => [t.tag_id, t.rank]), [[1, 1], [3, 2], [2, 3]]);
  assert.deepEqual(api.getAppTags(20).map(t => [t.tag_id, t.rank]), [[1, null], [2, 1]]);
  assert.equal(api.getAppById(999), null);
  assert.equal(api.getAppTagsCollectedAt(10), '2026-11-01');
  assert.equal(api.getAppTagsCollectedAt(30), null);
  assert.deepEqual(api.getRetiredTags([1, 3]), [{ tag_id: 3, name: 'Old tag', removed_at: '2026-01-01' }]);
  assert.equal(api.getGameInfoForApps([30]).get(30).reviews, 0);
  assert.equal(api.getAppTagsForApps([10, 10, 30, 999]).size, 1);
  assert.equal(api.findSegment(1, 'free').segment_id, 100);
  assert.equal(api.getTagScoresForSegment(100)[0].success_lift, 2.5);
  assert.equal(api.findTagByName(' ROGUELIKE ').tag_id, 1);
  assert.deepEqual(api.searchApps('A%').map(a => a.name), ['Alpha', 'Beta']);
  assert.deepEqual(api.getTagsByIds([3, 1, 3]).map(t => t.tag_id), [1, 3]);
  assert.deepEqual(api.getExemplarGamesForTags(100, [2], 2, { nearAppids: [20] }).games.get(2).map(a => a.appid), [20, 10]);
  assert.deepEqual(api.getExemplarGamesForTags(100, [2], 3, { excludeAppid: 10 }).games.get(2).map(a => a.appid), [20]);
  assert.deepEqual(api.getCompetitorTagOverlap([10, 20, 10]).map(t => [t.tag_id, t.overlap_count, t.avg_rank]), [[1, 2, 1], [2, 2, 2], [3, 1, 2]]);
  await api.loadInferenceModel(MODEL);
  assert.deepEqual(api.getAllTagEmbeddings(MODEL).map(t => t.tagId), [1, 2]);
  assert.equal(api.getTagStats([3]).get(3).idf, null);
  assert.equal(await api.centroidsFingerprint(MODEL), manifest.models[MODEL].row.centroids_sha256);
  assert.equal(await api.tagStatsFingerprint(), manifest.models[MODEL].row.tag_stats_sha256);
  assert.deepEqual(api.readModelSet(MODEL), manifest.models[MODEL].row);
  assert.ok(!requests.some(url => url.includes('/details/')));
  assert.deepEqual(await api.loadAppById(10), apps[0]);
  assert.equal(requests.filter(url => url.includes('/details/')).length, 1);
}));

test('real engine audits covered, retired, unmodeled and unknown tags independently on the pack path', () => environment(async ({ files }) => {
  await api.loadInference(BASE + 'manifest.json');
  await api.loadInferenceModel(MODEL);
  files.set(BASE + 'ranker.json', Buffer.from(JSON.stringify({ trees: [{ v: 0 }], feature_names: [] })));
  await api.loadRanker(BASE + 'ranker.json');
  const hadVectors = api.GAME_VECTOR_MODELS.delete(MODEL);
  try {
    const audit = await api.auditGame({
      appid: 10, queryEmbedding: new Float32Array([1, 0]),
      live: { name: 'Coverage fixture', short_description: 'Explore a mysterious world.', tagIds: [1, 3, 4, 999] },
    }, undefined, MODEL);
    assert.deepEqual(audit.tags.map(t => [t.tagId, t.taxonomyActive, t.embeddingAvailable, t.bucket]), [
      [1, true, true, 'identity'], [3, false, false, 'retired'],
      [4, true, false, 'unassessed'], [999, null, false, 'unassessed'],
    ]);
    assert.equal(audit.counts.unassessed, 2);
    assert.equal(audit.counts.retired, 1);
    assert.deepEqual(audit.orderNotes, []);
    assert.match(audit.tags[2].reason, /active.*model does not cover/);
    assert.match(audit.tags[3].reason, /not in the dataset's taxonomy/);
  } finally {
    if (hadVectors) api.GAME_VECTOR_MODELS.add(MODEL);
  }
}));

test('missing coverage preserves independent evidence and renders no false similarity or retirement claim', () => {
  const tag = {
    tagId: 4, tag: 'Unmodeled tag', rank: 1, similarity: 0, similarityRank: 0,
    neighborVote: 0, neighborShare: 0, intent: 0, taxonomyActive: true, embeddingAvailable: false,
  };
  const ctx = { retrievalCutoff: 0.6, prevalence: new Map(), neighborEvidenceAvailable: true };
  const unavailable = { ...ctx, neighborEvidenceAvailable: false };
  for (const context of [ctx, unavailable]) {
    assert.equal(api.classifyTag(tag, context).bucket, 'unassessed');
    assert.equal(api.classifyTag({ ...tag, taxonomyActive: null }, context).bucket, 'unassessed');
    assert.equal(api.classifyTag({ ...tag, taxonomyActive: false }, context).bucket, 'retired');
    assert.equal(api.classifyTag({ ...tag, intent: 1 }, context).bucket, 'identity');
    assert.equal(api.classifyTag({ ...tag, tag: 'Multiplayer' }, { ...context, categories: new Set(['multi-player']) }).bucket, 'feature');
    assert.equal(api.classifyTag({ ...tag, tag: 'Classic' }, context).bucket, 'neutral');
    assert.equal(api.classifyTag(tag, { ...context, prevalence: new Map([[4, 0.5]]) }).bucket, 'neutral');
    assert.equal(api.classifyTag({ ...tag, similarityRank: 1 }, context).bucket, 'unassessed');
  }
  assert.equal(api.classifyTag({ ...tag, neighborShare: 0.8 }, ctx).bucket, 'identity');
  assert.equal(api.classifyTag({ ...tag, neighborShare: 0.8 }, unavailable).bucket, 'unassessed');
  const covered = { ...tag, embeddingAvailable: true, similarity: 0.4, similarityRank: 200 };
  assert.equal(api.classifyTag(covered, ctx).bucket, 'suspicious');
  assert.equal(api.classifyTag(covered, unavailable).bucket, 'weak');

  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '' } });
  try {
    const hostile = { ...tag, tag: '<img src=x onerror="alert(1)">' };
    const html = api.renderTagRow({ ...hostile, ...api.classifyTag(hostile, ctx) }, true);
    assert.match(html, /Not assessed/);
    assert.match(html, /similarity unavailable/);
    assert.match(html, /class="tag-name-link"/);
    assert.doesNotMatch(html, /similarity 0\.00|<img|onerror="/);
    const unknown = { ...hostile, taxonomyActive: null };
    assert.doesNotMatch(api.renderTagRow({ ...unknown, ...api.classifyTag(unknown, ctx) }, true), /tag-name-link/);
    const retired = { ...tag, taxonomyActive: false };
    assert.doesNotMatch(api.renderTagRow({ ...retired, ...api.classifyTag(retired, ctx) }, true), /tag-name-link/);
  } finally {
    for (const [key, descriptor] of [['document', originalDocument], ['location', originalLocation]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('cache survives reload and offline use, repairs bad entries and retries missing files', () => environment(async ({ manifest, apps, entries, requests, network }) => {
  await api.loadInference(BASE + 'manifest.json'); await api.loadInferenceModel(MODEL); await api.loadAppById(10);
  const before = requests.length;
  await api.loadInference(BASE + 'manifest.json'); await api.loadInferenceModel(MODEL); await api.loadAppById(10);
  assert.deepEqual(requests.slice(before), [BASE + 'manifest.json']);
  const coreUrl = new URL(manifest.core.path, BASE).href;
  entries.set(coreUrl, new Response('broken'));
  await api.loadInference(BASE + 'manifest.json');
  assert.equal(requests.at(-1), coreUrl);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await api.loadInference(BASE + 'manifest.json'); await api.loadInferenceModel(MODEL);
  assert.deepEqual(await api.loadAppById(10), apps[0]);
  await assert.rejects(api.loadAppById(20), /offline/);
  globalThis.fetch = network;
  assert.deepEqual(await api.loadAppById(20), apps[1], 'a failed detail request remains retryable');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => { throw new Error('storage denied'); } } });
  await api.loadInference(BASE + 'manifest.json'); await api.loadInferenceModel(MODEL);
  assert.equal(api.getAppTags(10).length, 3);
}));

test('corrupt or incomplete published packs fail; only an absent manifest permits the SQL fallback', () => environment(async ({ manifest, files, entries, network }) => {
  const url = BASE + 'manifest.json';
  const store = await api.loadInference(url);
  globalThis.fetch = async () => new Response('', { status: 404 });
  await assert.rejects(api.loadInference(url), api.InferenceManifestUnavailable);
  globalThis.fetch = network;
  const coreUrl = new URL(manifest.core.path, BASE).href, original = files.get(coreUrl);
  entries.delete(coreUrl); files.delete(coreUrl);
  await assert.rejects(api.loadInference(url), error => error instanceof Error && !(error instanceof api.InferenceManifestUnavailable));
  assert.equal(api.inferenceStore(), store, 'failed loads never install a partial snapshot');
  files.set(coreUrl, Buffer.from('corrupt'));
  await assert.rejects(api.loadInference(url), /integrity/);
  files.set(coreUrl, original);
  assert.throws(() => api.validateManifest({ ...manifest, version: 2 }), /Unsupported/);
  assert.throws(() => api.validateManifest({ ...manifest, core: { ...manifest.core, path: '../data' } }), /reference/);
  const valid = api.encodePack({ kind: 'model' }, {});
  assert.throws(() => api.decodePack(valid.subarray(0, 10)), /Truncated/);
  new DataView(valid.buffer).setUint32(4, 2, true);
  assert.throws(() => api.decodePack(valid), /Unsupported/);
}));

// Build the saved envelope from the real public engine, using the same small
// fixture as the pack tests. No private exporter or artifacts are required.
async function readyAudit({ manifest, files, entries, requests }) {
  await api.loadInference(BASE + 'manifest.json');
  await api.loadInferenceModel(MODEL);
  files.set(BASE + 'ranker.json', Buffer.from(JSON.stringify({ trees: [{ v: 0 }], feature_names: [] })));
  await api.loadRanker(BASE + 'ranker.json');
  const hadVectors = api.GAME_VECTOR_MODELS.delete(MODEL);
  let audit;
  try {
    audit = JSON.parse(JSON.stringify(await api.auditGame({ appid: 10, queryEmbedding: new Float32Array([1, 0]) }, undefined, MODEL)));
  } finally { if (hadVectors) api.GAME_VECTOR_MODELS.add(MODEL); }
  const file = value => {
    const body = Buffer.from(JSON.stringify(value)), sha256 = hash(body), compressed = gzipSync(body);
    const ref = { path: `audits/${sha256}.gz`, sha256, bytes: body.length, gzipBytes: compressed.length };
    files.set(BASE + ref.path, compressed);
    return ref;
  };
  const metadata = {
    version: 1, revision: api.AUDIT_REVISION, model: MODEL,
    setId: manifest.models[MODEL].row.set_id, snapshot: await api.auditSnapshot(manifest, MODEL),
    generatedAt: '2026-11-15T12:00:00Z',
  };
  const saved = { ...metadata, audit }, index = { ...metadata, apps: { 10: file(saved) } };
  const publish = value => { manifest.audits = { [MODEL]: { revision: api.AUDIT_REVISION, file: file(value) } }; };
  publish(index);
  entries.clear(); requests.length = 0; api.setInferenceStore(null);
  return { saved, index, file, publish };
}

test('ready audits match the real engine without loading data, reuse cache and work offline or without storage', () => environment(async env => {
  const { saved } = await readyAudit(env), url = BASE + 'manifest.json';
  env.entries.set(BASE + 'audits/obsolete.gz', new Response('old snapshot'));
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
  assert.equal(api.inferenceStore(), null, 'a hit must not initialize the inference store');
  assert.equal(env.requests.length, 3, 'only manifest, index and selected audit');
  assert.ok(env.requests.every(u => u === url || u.startsWith(BASE + 'audits/')));
  assert.equal(env.entries.has(BASE + 'audits/obsolete.gz'), false, 'old snapshot entries are pruned');
  const before = env.requests.length;
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
  assert.deepEqual(env.requests.slice(before), [url]);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
  globalThis.fetch = env.network;
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => { throw new Error('storage denied'); } } });
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
}));

test('ready audits reject incompatible snapshots, revisions, models and malformed indexes', () => environment(async env => {
  const { index, publish } = await readyAudit(env), url = BASE + 'manifest.json';
  const original = structuredClone(env.manifest);
  assert.equal(await api.loadPrecomputedAudit(20, MODEL, url), null);
  assert.equal(await api.loadPrecomputedAudit(10, 'minilm', url), null);
  assert.equal(await api.loadPrecomputedAudit(-1, MODEL, url), null);
  for (const change of [
    m => { delete m.audits; },
    m => { m.audits[MODEL].revision = 'future'; },
    m => { m.audits[MODEL].file.path = '../unexpected'; },
    m => { m.core.sha256 = 'f'.repeat(64); m.core.path = `snapshots/${m.core.sha256}.gz`; },
    m => { m.details[0] = m.details.find(r => r.sha256 !== m.details[0].sha256); },
    m => { m.models[MODEL].row.notes = 'thin_signal_sim=0.1'; },
    m => { m.models[MODEL].file.sha256 = 'f'.repeat(64); m.models[MODEL].file.path = `sets/${m.models[MODEL].row.set_id}/${'f'.repeat(64)}.gz`; },
  ]) {
    Object.assign(env.manifest, structuredClone(original)); change(env.manifest);
    assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null);
  }
  Object.assign(env.manifest, structuredClone(original));
  for (const change of [
    i => { i.version = 2; }, i => { i.revision = 'future'; },
    i => { i.setId = 'another-set'; }, i => { i.model = 'minilm'; },
    i => { i.generatedAt = 'invalid'; }, i => { i.apps = []; },
    i => { i.apps['010'] = i.apps[10]; }, i => { i.apps[10].bytes = 0; },
  ]) {
    const bad = structuredClone(index); change(bad); publish(bad);
    assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null);
  }
  publish(index);
  assert.ok(await api.loadPrecomputedAudit(10, MODEL, url), 'valid data recovers after incompatible results');
}));

test('ready audits repair corrupt cache, reject damaged or invalid results and fall back on network failure', () => environment(async env => {
  const { saved, index, file, publish } = await readyAudit(env), url = BASE + 'manifest.json';
  const resultUrl = BASE + index.apps[10].path;
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
  env.entries.set(resultUrl, new Response('damaged cache'));
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
  assert.equal(env.requests.at(-1), resultUrl);
  const original = env.files.get(resultUrl);
  env.entries.delete(resultUrl); env.files.set(resultUrl, Buffer.from('damaged network body'));
  assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null);
  env.files.set(resultUrl, original);
  for (const change of [
    s => { s.audit.app.appid = 20; }, s => { s.audit.app.live = true; },
    s => { s.audit.tags[0].similarity = null; }, s => { s.audit.counts.identity = 999; },
    s => { s.audit.signal = null; }, s => { s.audit.tags.push(s.audit.tags[0]); },
    s => { s.version = 2; }, s => { s.model = 'minilm'; },
    s => { s.setId = 'another-set'; }, s => { s.generatedAt = '2026-11-16T12:00:00Z'; },
  ]) {
    const bad = structuredClone(saved); change(bad);
    publish({ ...index, apps: { 10: file(bad) } });
    assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null, 'a valid hash cannot excuse invalid contents');
  }
  publish(index); env.entries.clear();
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null);
  globalThis.fetch = async () => { throw new DOMException('Timeout', 'TimeoutError'); };
  assert.equal(await api.loadPrecomputedAudit(10, MODEL, url), null);
  globalThis.fetch = env.network;
  assert.deepEqual(await api.loadPrecomputedAudit(10, MODEL, url), saved);
}));
