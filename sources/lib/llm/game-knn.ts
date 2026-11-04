// Game-level kNN retrieval channel (the published game-vector format).
//
// Loads the precomputed game-vector blob (built by
// the offline game-vector exporter), projects the query embedding through
// the same PCA it carries, and does a brute-force cosine kNN over ~78k games.
// Neighbor tags/names/reviews come from the SQLite DB the analyzer already has,
// so the blob only carries appids + int8 vectors.
import { fetchBytes, type ByteProgress } from '../fetch-progress';

export interface GameVectors {
  count: number;
  dims: number;      // PCA-reduced dims
  origDims: number;  // original embedding dims (must match the query model)
  scale: number;     // int8 dequant scale
  mean: Float32Array;       // [origDims]
  components: Float32Array; // [dims * origDims] row-major
  appids: Uint32Array;      // [count]  row -> appid
  matrix: Int8Array;        // [count * dims] row-major, unit-normalized * scale
}

const MAGIC = 0x47564543; // "GVEC" little-endian as read below

export async function loadGameVectors(url: string, onProgress?: ByteProgress): Promise<GameVectors> {
  const bytes = await fetchBytes(url, onProgress, 'game vectors');
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
  if (version !== 1) throw new Error(`Unsupported game-vector version ${version}`);

  // Header is 24 bytes and every section below is 4-byte aligned, so typed
  // array views over the buffer are zero-copy (little-endian everywhere).
  const mean = new Float32Array(buf, off, origDims); off += origDims * 4;
  const components = new Float32Array(buf, off, dims * origDims); off += dims * origDims * 4;
  const appids = new Uint32Array(buf, off, count); off += count * 4;
  const matrix = new Int8Array(buf, off, count * dims); off += count * dims;

  return { count, dims, origDims, scale, mean, components, appids, matrix };
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
