// Shared wire contract. This module is browser-safe: no SQLite or Node imports.
export interface FileRef { path: string; sha256: string; bytes: number; gzipBytes: number }
export interface ModelRow {
  model_name: string; set_id: string; created_at: string;
  centroids_sha256: string; tag_stats_sha256: string; ranker_sha256: string;
  vectors_sha256: string; encoder_sha256: string; encoder_probe: string; notes: string | null;
}
export interface PackManifest {
  version: 1;
  core: FileRef;
  models: Record<string, { row: ModelRow; file: FileRef }>;
  details: FileRef[];
  /** Optional ready-made audit indexes. Older clients simply ignore these. */
  audits?: Record<string, { revision: string; file: FileRef }>;
}
export interface PackTag { tag_id: number; name: string; normalized_name: string; is_active: number }
export interface PackSegment {
  segment_id: number; main_tag_id: number; main_tag_name: string;
  release_year: number | null; price_bucket: string | null; game_count: number;
}
export interface CoreMetadata {
  kind: 'core'; tags: PackTag[]; segments: PackSegment[];
  // [segment_id, tag_id, lift, confidence, sample, top_sample, frequency, top_frequency]
  scores: number[][];
  removed: Record<string, string | null>;
  names: string[]; dates: string[]; gameCount: number; tagCount: number; topCount: number;
}
export interface ModelMetadata {
  kind: 'model'; model: string; setId: string;
  // All rows, including inactive tags: matched-set hashes cover every centroid.
  centroids: Array<{ tagId: number; offset: number; length: number }>;
  stats: Array<{ tag_id: number; game_count: number | null; avg_rank: number | null; idf: number | null; top1_rate: number | null }>;
}

const MAGIC = 0x53544950; // STIP
const align = (n: number) => Math.ceil(n / 8) * 8;

/** Aligned binary sections following a small JSON directory; integers/floats are LE. */
export function encodePack(metadata: CoreMetadata | ModelMetadata, sections: Record<string, Uint8Array>): Uint8Array {
  let offset = 0;
  const directory = Object.entries(sections).map(([name, bytes]) => {
    const entry = { name, offset, length: bytes.byteLength };
    offset = align(offset + bytes.byteLength);
    return entry;
  });
  const json = new TextEncoder().encode(JSON.stringify({ metadata, directory }));
  const start = align(16 + json.length);
  const bytes = new Uint8Array(start + offset);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, MAGIC); header.setUint32(4, 1, true);
  header.setUint32(8, json.length, true); header.setUint32(12, bytes.length, true);
  bytes.set(json, 16);
  for (const entry of directory) bytes.set(sections[entry.name], start + entry.offset);
  return bytes;
}

export function decodePack(input: Uint8Array): { metadata: CoreMetadata | ModelMetadata; sections: Map<string, Uint8Array> } {
  const bytes = input.byteOffset % 8 ? input.slice() : input;
  if (bytes.length < 16) throw new Error('Truncated inference pack');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0) !== MAGIC || header.getUint32(4, true) !== 1) throw new Error('Unsupported inference pack');
  const length = header.getUint32(8, true), start = align(16 + length);
  if (header.getUint32(12, true) !== bytes.length || start > bytes.length) throw new Error('Invalid inference pack length');
  const { metadata, directory } = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + length)));
  if (!metadata || !['core', 'model'].includes(metadata.kind) || !Array.isArray(directory)) throw new Error('Invalid inference pack directory');
  const sections = new Map<string, Uint8Array>();
  let end = 0;
  for (const entry of directory) {
    if (typeof entry.name !== 'string' || sections.has(entry.name) || !Number.isSafeInteger(entry.offset) ||
        !Number.isSafeInteger(entry.length) || entry.offset < end || entry.offset % 8 || entry.length < 0 ||
        start + entry.offset + entry.length > bytes.length) throw new Error('Invalid inference pack section');
    sections.set(entry.name, bytes.subarray(start + entry.offset, start + entry.offset + entry.length));
    end = align(entry.offset + entry.length);
  }
  if (start + end !== bytes.length) throw new Error('Unexpected inference pack trailing bytes');
  return { metadata, sections };
}

export function detailBucket(appid: number): number {
  // Steam IDs are mostly multiples of ten; modulo alone leaves half the buckets empty.
  return (Math.imul(appid, 0x9e3779b1) >>> 24) & 255;
}
