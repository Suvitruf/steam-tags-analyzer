// Game-level kNN retrieval channel (the published game-vector format).
//
// Loads the precomputed game-vector blob (built by
// the offline game-vector exporter), projects the query embedding through
// the same PCA it carries, and does a brute-force cosine kNN over ~78k games.
// Neighbor tags/names/reviews come from the SQLite DB the analyzer already has,
// so the blob only carries appids + int8 vectors.
import { fetchBytes, readCachedBytes, type ByteProgress } from '../fetch-progress';
import { sha256 } from '../inference/loader';

export interface GameVectors {
  count: number;
  dims: number;      // PCA-reduced dims
  origDims: number;  // original embedding dims (must match the query model)
  scale: number;     // int8 dequant scale
  mean: Float32Array;       // [origDims]
  components: Float32Array; // [dims * origDims] row-major
  appids: Uint32Array;      // [count]  row -> appid
  matrix: Int8Array;        // [count * dims] row-major, unit-normalized * scale
  /** Matched-set id from the v2 header (model_set.py stamp); null for a v1 blob. */
  setId: string | null;
}

const MAGIC = 0x47564543; // "GVEC" little-endian as read below
const SET_ID_BYTES = 64;   // v2: NUL-padded ASCII set id after the header
export const GAME_VECTOR_CACHE = 'steam-tags-game-vectors-v1';

export interface GameVectorIdentity {
  setId: string;
  sha256: string;
}

// HTTP cache is optional and expires. Persist only fingerprinted model-set
// artifacts, checking the bytes on every read; flat legacy files keep their
// normal HTTP freshness instead of being pinned forever.
export async function loadGameVectors(url: string, onProgress?: ByteProgress, identity?: GameVectorIdentity): Promise<GameVectors> {
  const verified = async (bytes: Uint8Array): Promise<GameVectors> => {
    if (identity && await sha256(bytes) !== identity.sha256) throw new Error('Game-vector integrity check failed');
    const vectors = parseGameVectors(bytes);
    if (identity && vectors.setId !== identity.setId) throw new Error('Game-vector model set mismatch');
    return vectors;
  };
  let storage: Cache | null = null;
  if (identity && /^[a-f0-9]{64}$/.test(identity.sha256) && /^https?:\/\//.test(url)) {
    try { if (typeof caches !== 'undefined') storage = await caches.open(GAME_VECTOR_CACHE); }
    catch (error) { console.warn('Game-vector cache unavailable:', error); }
  }
  const persist = async (bytes: Uint8Array) => {
    if (!storage) return false;
    try {
      await storage.put(url, new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream' } }));
      // One current set per model; keep the other models' cached vectors.
      const current = new URL(url), filename = current.pathname.split('/').pop();
      for (const entry of await storage.keys()) {
        const previous = new URL(entry.url);
        if (entry.url !== url && previous.origin === current.origin && previous.pathname.split('/').pop() === filename) await storage.delete(entry);
      }
      return true;
    } catch (error) { console.warn('Game-vector cache write failed:', error); return false; }
  };
  if (storage) {
    try {
      const hit = await storage.match(url);
      if (hit) {
        try { return await verified(await readCachedBytes(hit)); }
        catch { await storage.delete(url); }
      }
      // Reuse the userscript/extension's 0.2.x cache on upgrade. The shared
      // loader now owns vectors, so they need not be downloaded or stored twice.
      const legacyName = 'steam-tags-local-runtime-v1';
      if (await caches.has(legacyName)) {
        const legacy = await caches.open(legacyName), old = await legacy.match(url);
        if (old) {
          const bytes = await readCachedBytes(old);
          const vectors = await verified(bytes);
          if (await persist(bytes)) {
            try { await legacy.delete(url); } catch { /* Valid new copy is already stored. */ }
          }
          return vectors;
        }
      }
    } catch (error) { console.warn('Game-vector cache read failed; retrying from network:', error); }
  }
  const bytes = await fetchBytes(url, onProgress, 'game vectors');
  const vectors = await verified(bytes);
  await persist(bytes);
  return vectors;
}

function parseGameVectors(bytes: Uint8Array): GameVectors {
  // fetchBytes returns views at offset 0; the typed-array views below need
  // the section offsets to be relative to the ArrayBuffer start.
  const buf = bytes.byteOffset === 0 ? bytes.buffer : bytes.slice().buffer;
  const dv = new DataView(buf);

  // magic is the 4 ASCII bytes "GVEC"
  const magic = dv.getUint32(0, false);
  if (magic !== MAGIC) throw new Error('Bad game-vector blob (magic mismatch)');

  let off = 4;
  const version = dv.getUint32(off, true); off += 4;
  const count = dv.getUint32(off, true); off += 4;
  const dims = dv.getUint32(off, true); off += 4;
  const origDims = dv.getUint32(off, true); off += 4;
  const scale = dv.getFloat32(off, true); off += 4;
  if (version !== 1 && version !== 2) throw new Error(`Unsupported game-vector version ${version}`);
  let setId: string | null = null;
  if (version === 2) {
    const raw = new Uint8Array(buf, off, SET_ID_BYTES); off += SET_ID_BYTES;
    const end = raw.indexOf(0);
    setId = new TextDecoder().decode(end >= 0 ? raw.subarray(0, end) : raw) || null;
  }

  // Header is 24 bytes (88 for v2) and every section below is 4-byte aligned,
  // so typed array views over the buffer are zero-copy (little-endian everywhere).
  const mean = new Float32Array(buf, off, origDims); off += origDims * 4;
  const components = new Float32Array(buf, off, dims * origDims); off += dims * origDims * 4;
  const appids = new Uint32Array(buf, off, count); off += count * 4;
  const matrix = new Int8Array(buf, off, count * dims); off += count * dims;

  return { count, dims, origDims, scale, mean, components, appids, matrix, setId };
}

// Project a raw query embedding into the blob's reduced, unit-normalized space:
// reduced = components @ (query - mean), then L2-normalize.
export function projectQuery(gv: GameVectors, query: Float32Array): Float32Array {
  if (query.length !== gv.origDims) {
    throw new Error(`Query dim ${query.length} != blob orig dim ${gv.origDims}`);
  }
  const { dims, origDims, mean, components } = gv;
  const centered = new Float32Array(origDims);
  for (let j = 0; j < origDims; j++) centered[j] = query[j] - mean[j];

  const reduced = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    let s = 0;
    const base = d * origDims;
    for (let j = 0; j < origDims; j++) s += components[base + j] * centered[j];
    reduced[d] = s;
  }
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += reduced[d] * reduced[d];
  norm = Math.sqrt(norm) || 1e-9;
  for (let d = 0; d < dims; d++) reduced[d] /= norm;
  return reduced;
}

export interface Neighbor {
  appid: number;
  similarity: number;
}

// Brute-force cosine kNN: sim = dot(projectedQuery, gameVec) / scale. At ~78k×96
// this is a few million multiply-adds — single-digit ms.
export function nearestGames(gv: GameVectors, projected: Float32Array, k: number): Neighbor[] {
  const { count, dims, scale, matrix, appids } = gv;
  // maintain a small top-k with a linear insert (k is ~50, cheaper than a heap here)
  const topSim = new Float32Array(k).fill(-Infinity);
  const topIdx = new Int32Array(k).fill(-1);
  let worst = -Infinity;

  for (let i = 0; i < count; i++) {
    let s = 0;
    const base = i * dims;
    for (let d = 0; d < dims; d++) s += projected[d] * matrix[base + d];
    s /= scale;
    if (s <= worst) continue;
    // insert into the sorted-desc top-k
    let p = k - 1;
    if (topSim[p] >= s) continue;
    while (p > 0 && topSim[p - 1] < s) {
      topSim[p] = topSim[p - 1];
      topIdx[p] = topIdx[p - 1];
      p--;
    }
    topSim[p] = s;
    topIdx[p] = i;
    worst = topSim[k - 1];
  }

  const out: Neighbor[] = [];
  for (let r = 0; r < k; r++) {
    if (topIdx[r] < 0) break;
    out.push({ appid: appids[topIdx[r]], similarity: topSim[r] });
  }
  return out;
}
