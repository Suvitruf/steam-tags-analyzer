import { detailBucket, type FileRef, type PackManifest } from './format';
import { fetchBytes, FetchError, type ByteProgress } from '../fetch-progress';
import { InferenceStore, inferenceStore, setInferenceStore } from './store';

const CACHE = 'steam-tags-inference-v1';
let active: { store: InferenceStore; base: string } | null = null;
const pending = new Map<string, Promise<void>>();
export class InferenceManifestUnavailable extends FetchError {}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function validateManifest(value: unknown): PackManifest {
  const m = value as PackManifest;
  const ref = (r: FileRef) => {
    if (!r || !/^(snapshots|sets\/[a-zA-Z0-9_-]+|details)\/[a-f0-9]{64}\.gz$/.test(r.path) ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || !r.path.endsWith(`/${r.sha256}.gz`) ||
        !Number.isSafeInteger(r.bytes) || r.bytes <= 0 || !Number.isSafeInteger(r.gzipBytes) || r.gzipBytes <= 0) throw new Error('Invalid inference file reference');
  };
  if (!m || m.version !== 1 || !m.models || typeof m.models !== 'object' || Array.isArray(m.models) ||
      !Object.keys(m.models).length || !Array.isArray(m.details) || m.details.length !== 256) throw new Error('Unsupported inference manifest');
  ref(m.core); if (!m.core.path.startsWith('snapshots/')) throw new Error('Invalid inference core path');
  for (const [key, model] of Object.entries(m.models)) {
    ref(model?.file);
    if (!model.row || model.row.model_name !== key || !/^[a-zA-Z0-9_-]+$/.test(model.row.set_id) ||
        !model.file.path.startsWith(`sets/${model.row.set_id}/`)) throw new Error('Invalid inference model reference');
    for (const field of ['centroids_sha256', 'tag_stats_sha256', 'ranker_sha256', 'vectors_sha256', 'encoder_sha256'] as const) {
      if (!/^[a-f0-9]{64}$/.test(model.row[field])) throw new Error('Invalid inference model fingerprint');
    }
  }
  for (const r of m.details) { ref(r); if (!r.path.startsWith('details/')) throw new Error('Invalid inference detail path'); }
  const stats = new Set(Object.values(m.models).map(m => m.row.tag_stats_sha256));
  if (stats.size !== 1) throw new Error('Inference model sets disagree on tag_stats');
  return m;
}

async function cache(): Promise<Cache | null> {
  try { return typeof caches === 'undefined' ? null : await caches.open(CACHE); } catch { return null; }
}

async function file(base: string, ref: FileRef, onProgress?: ByteProgress): Promise<Uint8Array> {
  const url = new URL(ref.path, base).href, storage = await cache();
  const valid = async (bytes: Uint8Array) => bytes.length === ref.bytes && await sha256(bytes) === ref.sha256;
  try {
    const cached = await storage?.match(url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (await valid(bytes)) return bytes;
      await storage?.delete(url);
    }
  } catch { /* Cache API unavailable or corrupt: read and verify the network copy. */ }
  const bytes = await fetchBytes(url, onProgress, 'inference data');
  if (!await valid(bytes)) throw new Error(`Inference file integrity check failed: ${ref.path}`);
  // Store verified, decoded bytes. Cache API has no HTTP per-entry size cap.
  try { await storage?.put(url, new Response(new Uint8Array(bytes))); } catch { /* Storage quota/private mode: HTTP cache still works. */ }
  return bytes;
}

export async function loadInference(url: string, onProgress?: ByteProgress): Promise<InferenceStore> {
  const storage = await cache();
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
  } catch (error) {
    // Offline/network failure: reuse only a previously validated pointer.
    // Its content-addressed children still undergo their normal hash checks.
    const saved = await storage?.match(url);
    if (!saved) throw error;
    response = saved;
  }
  if (response.status === 403 || response.status === 404) throw new InferenceManifestUnavailable('Inference manifest is not published yet', response.status);
  if (!response.ok) throw new FetchError(`Inference manifest returned HTTP ${response.status}`, response.status);
  const manifest = validateManifest(await response.json());
  const base = new URL('.', url).href;
  const store = new InferenceStore(manifest, await file(base, manifest.core, onProgress));
  active = { store, base }; pending.clear(); setInferenceStore(store);
  // Bound disk growth across nightly snapshots. A tab keeps its own pinned
  // manifest; immutable URLs remain fetchable even if another tab evicts one.
  const allowed = new Set([url, ...[manifest.core, ...manifest.details, ...Object.values(manifest.models).map(m => m.file)].map(r => new URL(r.path, base).href)]);
  try {
    if (storage) {
      await storage.put(url, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
      for (const request of await storage.keys()) if (!allowed.has(request.url)) await storage.delete(request);
    }
  } catch { /* Cache pruning cannot prevent analysis. */ }
  return store;
}

function once(key: string, load: () => Promise<void>): Promise<void> {
  let p = pending.get(key);
  if (!p) { p = load(); pending.set(key, p); p.catch(() => pending.delete(key)); }
  return p;
}

export async function loadInferenceModel(key: string, onProgress?: ByteProgress): Promise<void> {
  const store = inferenceStore();
  if (!store || store.models.has(key)) return;
  if (!active || active.store !== store) throw new Error('Inference loader is not initialized');
  const { base } = active, model = store.manifest.models[key];
  if (!model) throw new Error(`No inference data for model ${key}`);
  await once(`model:${key}`, async () => { store.addModel(key, await file(base, model.file, onProgress)); });
}

export async function loadInferenceDetails(appid: number): Promise<void> {
  const store = inferenceStore();
  if (!store || !store.appIndex.has(appid) || store.details.has(appid)) return;
  if (!active || active.store !== store) throw new Error('Inference loader is not initialized');
  const { base } = active, bucket = detailBucket(appid);
  await once(`details:${bucket}`, async () => {
    const data = JSON.parse(new TextDecoder().decode(await file(base, store.manifest.details[bucket])));
    if (!Array.isArray(data)) throw new Error('Invalid inference details');
    const seen = new Set<number>();
    for (const app of data) {
      if (!app || !store.appIndex.has(app.appid) || detailBucket(app.appid) !== bucket || seen.has(app.appid) ||
          typeof app.name !== 'string' || app.type !== 'game' || app.is_released !== 1 ||
          (app.short_description !== null && typeof app.short_description !== 'string') ||
          (app.categories !== null && typeof app.categories !== 'string')) throw new Error('Invalid inference app details');
      seen.add(app.appid);
    }
    if (!seen.has(appid)) throw new Error(`Inference details missing App ID ${appid}`);
    for (const app of data) store.details.set(app.appid, app);
  });
  if (!store.details.has(appid)) throw new Error(`Inference details missing App ID ${appid}`);
}
