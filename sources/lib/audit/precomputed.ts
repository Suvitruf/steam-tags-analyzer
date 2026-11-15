import type { FileRef, PackManifest } from '../inference/format';
import type { TagAudit } from '../recommendation/audit';
import { AUDIT_BUCKETS } from '../recommendation/audit';
import { INFERENCE_MANIFEST_URL } from '../config';
import { sha256, validateManifest } from '../inference/loader';

// Bump whenever audit/scoring/intent semantics change, even if the wire shape
// stays the same. Old pages then compute locally instead of showing new rules.
export const AUDIT_REVISION = 'audit-2026-11-15-v1';
const CACHE = 'steam-tags-audits-v1';
export interface AuditIndex {
  version: 1; revision: string; model: string; setId: string;
  snapshot: string; generatedAt: string; apps: Record<string, FileRef>;
}
export interface SavedAudit extends Omit<AuditIndex, 'apps'> { audit: TagAudit }

/** Include descriptions/categories and calibration, not just tag/core hashes. */
export function auditSnapshot(manifest: PackManifest, model: string): Promise<string> {
  const selected = manifest.models[model];
  if (!selected) throw new Error('Audit model is absent from the snapshot');
  return sha256(new TextEncoder().encode(JSON.stringify([
    manifest.version, manifest.core.sha256, selected.file.sha256,
    Object.entries(selected.row).sort(([a], [b]) => a.localeCompare(b)),
    manifest.details.map(ref => ref.sha256),
  ])));
}

export function validAuditRef(value: unknown): value is FileRef {
  const r = value as FileRef;
  return !!r && /^[a-f0-9]{64}$/.test(r.sha256) && r.path === `audits/${r.sha256}.gz` &&
    Number.isSafeInteger(r.bytes) && r.bytes > 0 && r.bytes <= 4_000_000 &&
    Number.isSafeInteger(r.gzipBytes) && r.gzipBytes > 0 && r.gzipBytes <= 4_000_000;
}

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const id = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v > 0 && v <= 0xffffffff;
const string = (v: unknown): v is string => typeof v === 'string';
const nullableString = (v: unknown) => v === null || string(v);
const bool = (v: unknown) => typeof v === 'boolean';
const list = (v: unknown, check: (row: any) => boolean, max = 1000): boolean => Array.isArray(v) && v.length <= max && v.every(check);
const strings = (v: unknown) => list(v, string);

/** Validate everything the renderer uses, before accepting an optional cache hit. */
export function validSavedAudit(value: unknown, index: AuditIndex, appid: number): value is SavedAudit {
  const saved = value as SavedAudit, a = saved?.audit;
  const game = (g: any) => !!g && id(g.appid) && string(g.name);
  const recommendation = (t: any) => !!t && id(t.tagId) && string(t.tag) && string(t.explanation) &&
    ['score', 'relevance', 'successLift', 'confidence'].every(k => number(t[k])) && list(t.exemplarGames, game);
  if (!saved || !['version', 'revision', 'model', 'setId', 'snapshot', 'generatedAt'].every(k =>
    (saved as any)[k] === (index as any)[k]) || !a || a.app?.appid !== appid ||
    !string(a.app.name) || a.app.live !== false || a.app.inDataset !== true || a.app.fetchedAt !== null ||
    !bool(a.featuresKnown) || !nullableString(a.snapshotCollectedAt) || a.liveDiff !== null ||
    !(a.segment === null || (a.segment && string(a.segment.main_tag_name) && number(a.segment.game_count))) ||
    !list(a.tags, t => !!t && id(t.tagId) && string(t.tag) && (number(t.rank) || t.rank === null) &&
      ['similarity', 'similarityRank', 'neighborVote', 'neighborShare', 'intent'].every(k => number(t[k])) &&
      (t.taxonomyActive === null || bool(t.taxonomyActive)) && bool(t.embeddingAvailable) &&
      AUDIT_BUCKETS.includes(t.bucket) && string(t.reason) && strings(t.verifiedBy) && bool(t.featureMissing), 100) || !a.tags.length ||
    !a.counts || !AUDIT_BUCKETS.every(b => a.counts[b] === a.tags.filter(t => t.bucket === b).length) ||
    !list(a.missing, recommendation) || !list(a.missingContradicted, recommendation) || !list(a.avoid, recommendation) ||
    !list(a.similarGames, g => game(g) && number(g.similarity) && number(g.reviews)) ||
    !a.signal || !number(a.signal.topSimilarity) || !bool(a.signal.thin) || !nullableString(a.signal.reason) ||
    !bool(a.signal.neighborEvidenceAvailable) || !strings(a.orderNotes) || !number(a.retrievalCutoff) ||
    ![undefined, 'top', 'segment'].includes(a.exemplarBasis)) return false;
  return new Set(a.tags.map(t => t.tagId)).size === a.tags.length;
}

async function storage(): Promise<Cache | null> {
  try { return typeof caches === 'undefined' ? null : await caches.open(CACHE); } catch { return null; }
}

/** Optional optimization: any miss, unsupported version or failure computes normally. */
export async function loadPrecomputedAudit(appid: number, model: string, url = INFERENCE_MANIFEST_URL): Promise<SavedAudit | null> {
  if (!id(appid)) return null;
  const cache = await storage();
  try {
    let response: Response;
    try { response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(5000) }); }
    catch (error) { const saved = await cache?.match(url); if (!saved) throw error; response = saved; }
    if (!response.ok) return null;
    const manifest = validateManifest(await response.json());
    const pointer = manifest.audits?.[model];
    if (!pointer || pointer.revision !== AUDIT_REVISION || !validAuditRef(pointer.file)) return null;
    const base = new URL('.', url);
    const file = async (ref: FileRef): Promise<unknown> => {
      const target = new URL(ref.path, base).href;
      const valid = async (data: Uint8Array) => data.length === ref.bytes && await sha256(data) === ref.sha256;
      try {
        const saved = await cache?.match(target);
        if (saved) {
          const bytes = new Uint8Array(await saved.arrayBuffer());
          if (await valid(bytes)) return JSON.parse(new TextDecoder().decode(bytes));
          await cache?.delete(target);
        }
      } catch { /* Repair an invalid local entry from the immutable URL. */ }
      const res = await fetch(target, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('Precomputed audit unavailable');
      let data = new Uint8Array(await res.arrayBuffer());
      if (data[0] === 0x1f && data[1] === 0x8b) {
        data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      }
      if (!await valid(data)) throw new Error('Precomputed audit integrity failure');
      const decoded: unknown = JSON.parse(new TextDecoder().decode(data));
      try { await cache?.put(target, new Response(data)); } catch { /* Quota/private mode. */ }
      return decoded;
    };
    const index = await file(pointer.file) as AuditIndex;
    if (index?.version !== 1 || index.revision !== AUDIT_REVISION || index.model !== model ||
        index.setId !== manifest.models[model]?.row.set_id || index.snapshot !== await auditSnapshot(manifest, model) ||
        !string(index.generatedAt) || !Number.isFinite(Date.parse(index.generatedAt)) ||
        !index.apps || typeof index.apps !== 'object' || Array.isArray(index.apps) ||
        Object.keys(index.apps).length > 10000 ||
        !Object.entries(index.apps).every(([key, ref]) => String(Number(key)) === key && id(Number(key)) && validAuditRef(ref))) return null;
    const ref = index.apps[appid];
    if (!ref) return null;
    const saved = await file(ref);
    if (!validSavedAudit(saved, index, appid)) return null;
    try {
      if (cache) {
        await cache.put(url, new Response(JSON.stringify(manifest)));
        const keep = new Set([url, ...[pointer.file, ...Object.values(index.apps)].map(ref => new URL(ref.path, base).href)]);
        for (const key of await cache.keys()) if (!keep.has(key.url)) await cache.delete(key);
      }
    } catch { /* Cache maintenance never blocks the result. */ }
    return saved;
  } catch { return null; }
}
