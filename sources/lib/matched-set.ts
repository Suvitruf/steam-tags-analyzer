// Matched-set verification.
//
// A model's tag centroids (tag_embeddings), tag_stats, ranker, game-vector
// blob and quantized encoder are built together and only make sense
// together; a stale ranker on refreshed tag_stats cost 2.6 pt id_recall in
// July 2026 and nothing noticed. The offline model pipeline's stamp step records
// each set in the DB table `model_sets` (fingerprints + an encoder probe) and
// writes the set id into the ranker JSON and the blob header. This module
// recomputes what the browser can see and compares:
//   - ranker and blob carry the manifest's set id;
//   - the DB's centroids and tag_stats hash to the manifest's fingerprints
//     (the canonical byte layouts below mirror model_set.py exactly);
//   - the served encoder reproduces the manifest's probe embedding.
// A DB without a manifest row (artifacts from before the stamp) is
// "unverified", not a failure.
import { query, queryOne } from './db/client';
import { getRankerSetId } from './scoring/ranker';
import type { GameVectors } from './llm/game-knn';

/** Same ONNX on another runtime differs only at float rounding; a different fine-tune lands far below. */
export const PROBE_MIN_COSINE = 0.99;

export interface ModelSetRow {
  model_name: string;
  set_id: string;
  created_at: string;
  centroids_sha256: string;
  tag_stats_sha256: string;
  ranker_sha256: string;
  vectors_sha256: string;
  encoder_sha256: string;
  /** JSON: { text, embedding: number[] } — the quantized ONNX's normalized embedding of `text`. */
  encoder_probe: string;
  notes: string | null;
}

export interface MatchedSetObservation {
  centroidsSha256: string;
  tagStatsSha256: string;
  /** undefined = ranker not loaded; null = loaded but carries no set id (pre-manifest file). */
  rankerSetId: string | null | undefined;
  /** undefined = blob not loaded (channel off or unavailable); null = v1 blob without a set id. */
  vectorsSetId: string | null | undefined;
  /** Cosine between the served encoder's probe embedding and the manifest's; undefined when no embedder ran. */
  probeCosine?: number;
}

export type MatchedSetStatus = 'verified' | 'unverified' | 'mismatch';

export interface MatchedSetReport {
  status: MatchedSetStatus;
  setId: string | null;
  createdAt: string | null;
  /** Human-readable, one per failed check; empty unless status is 'mismatch'. */
  problems: string[];
  /** Which artifacts were compared ('ranker', 'game vectors', 'tag centroids', 'tag_stats', 'encoder'). */
  checked: string[];
  probeCosine?: number;
}

export function readModelSet(modelKey: string): ModelSetRow | null {
  try {
    return queryOne<ModelSetRow>('SELECT * FROM model_sets WHERE model_name = ?', [modelKey]);
  } catch {
    return null; // no model_sets table: the DB predates the manifest
  }
}

/** The set id the loaded database names for a model, or null for an unstamped
 * set. The loaders address a set's CDN files by it (config.ts). */
export function currentSetId(modelKey: string): string | null {
  return readModelSet(modelKey)?.set_id ?? null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer: TS 5.9 types digest() as BufferSource over ArrayBuffer only.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 over (tag_id uint32 LE, raw embedding blob) in tag_id order — model_set.centroids_fingerprint. */
export async function centroidsFingerprint(modelKey: string): Promise<string> {
  const rows = query<{ tag_id: number; embedding: Uint8Array }>(
    'SELECT tag_id, embedding FROM tag_embeddings WHERE model_name = ? ORDER BY tag_id', [modelKey]
  );
  let length = 0;
  for (const r of rows) length += 4 + r.embedding.length;
  const out = new Uint8Array(length);
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const r of rows) {
    dv.setUint32(off, r.tag_id, true); off += 4;
    out.set(r.embedding, off); off += r.embedding.length;
  }
  return sha256Hex(out);
}

/** sha256 over (tag_id uint32, game_count int64, avg_rank/idf/top1_rate float64, NULL as NaN) LE in tag_id order — model_set.tag_stats_fingerprint. */
export async function tagStatsFingerprint(): Promise<string> {
  const rows = query<{ tag_id: number; game_count: number | null; avg_rank: number | null; idf: number | null; top1_rate: number | null }>(
    'SELECT tag_id, game_count, avg_rank, idf, top1_rate FROM tag_stats ORDER BY tag_id'
  );
  const out = new Uint8Array(rows.length * 36);
  const dv = new DataView(out.buffer);
  let off = 0;
  for (const r of rows) {
    dv.setUint32(off, r.tag_id, true); off += 4;
    dv.setBigInt64(off, BigInt(Math.trunc(r.game_count ?? 0)), true); off += 8;
    for (const v of [r.avg_rank, r.idf, r.top1_rate]) { dv.setFloat64(off, v ?? NaN, true); off += 8; }
  }
  return sha256Hex(out);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1e-9);
}

/** Pure comparison of a manifest row with what was observed; null row = unstamped set. */
export function judgeMatchedSet(row: ModelSetRow | null, obs: MatchedSetObservation): MatchedSetReport {
  if (!row) return { status: 'unverified', setId: null, createdAt: null, problems: [], checked: [] };
  const problems: string[] = [];
  const checked: string[] = [];
  const idCheck = (what: string, plural: boolean, got: string | null | undefined) => {
    if (got === undefined) return;
    checked.push(what);
    if (got === null) problems.push(`the ${what} ${plural ? 'carry' : 'carries'} no set id; the database expects set ${row.set_id}`);
    else if (got !== row.set_id) problems.push(`the ${what} ${plural ? 'are' : 'is'} from set ${got}; the database expects ${row.set_id}`);
  };
  idCheck('ranker', false, obs.rankerSetId);
  idCheck('game vectors', true, obs.vectorsSetId);
  checked.push('tag centroids');
  if (obs.centroidsSha256 !== row.centroids_sha256) {
    problems.push('the tag centroids in the database are not the ones this set was built with (tag_embeddings rewritten since)');
  }
  checked.push('tag_stats');
  if (obs.tagStatsSha256 !== row.tag_stats_sha256) {
    problems.push('tag_stats are not the ones the ranker was trained against (recomputed since; its tag_idf feature has drifted)');
  }
  if (obs.probeCosine !== undefined) {
    checked.push('encoder');
    if (!(obs.probeCosine >= PROBE_MIN_COSINE)) {
      problems.push(`the served encoder does not reproduce the set's probe embedding (cosine ${obs.probeCosine.toFixed(4)} < ${PROBE_MIN_COSINE}); a different model than the centroids and game vectors were built with`);
    }
  }
  return {
    status: problems.length ? 'mismatch' : 'verified',
    setId: row.set_id,
    createdAt: row.created_at,
    problems,
    checked,
    probeCosine: obs.probeCosine,
  };
}

export interface VerifyOptions {
  /** Embeds a text the way queries are embedded (the worker, or transformers.js in Node); enables the encoder check. */
  embed?: (text: string) => Promise<Float32Array>;
  /** The loaded blob, when the kNN channel is on; enables the game-vectors check. */
  gameVectors?: GameVectors;
}

export async function observeMatchedSet(modelKey: string, row: ModelSetRow | null, opts: VerifyOptions = {}): Promise<MatchedSetObservation> {
  const obs: MatchedSetObservation = {
    centroidsSha256: await centroidsFingerprint(modelKey),
    tagStatsSha256: await tagStatsFingerprint(),
    rankerSetId: getRankerSetId(),
    vectorsSetId: opts.gameVectors ? opts.gameVectors.setId : undefined,
  };
  if (row && opts.embed) {
    const probe = JSON.parse(row.encoder_probe) as { text: string; embedding: number[] };
    obs.probeCosine = cosine(await opts.embed(probe.text), probe.embedding);
  }
  return obs;
}

/** The whole check for one model against the loaded database. Never throws for a legacy (unstamped) DB. */
export async function verifyMatchedSet(modelKey: string, opts: VerifyOptions = {}): Promise<MatchedSetReport> {
  const row = readModelSet(modelKey);
  if (!row) return judgeMatchedSet(null, { centroidsSha256: '', tagStatsSha256: '', rankerSetId: undefined, vectorsSetId: undefined });
  return judgeMatchedSet(row, await observeMatchedSet(modelKey, row, opts));
}
