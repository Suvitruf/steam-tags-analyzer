import { decodePack, type CoreMetadata, type ModelMetadata, type PackManifest } from './format';
import type { App, AppTag, Tag, Segment, TagScore, ExemplarBasis } from '../types';
import type { TagEmbedding, TagStats } from '../db/queries';

let current: InferenceStore | null = null;
export const inferenceStore = () => current;
export function setInferenceStore(store: InferenceStore | null): void { current = store; }

export class InferenceStore {
  readonly metadata: CoreMetadata;
  readonly appids: Uint32Array;
  readonly tags: Uint16Array;
  readonly ranks: Uint8Array;
  readonly offsets: Uint32Array;
  readonly reviews: Float64Array;
  readonly observed: Uint32Array;
  readonly appIndex = new Map<number, number>();
  readonly tagIndex = new Map<number, Tag>();
  readonly details = new Map<number, App>();
  readonly models = new Map<string, { metadata: ModelMetadata; embeddings: Uint8Array }>();
  private scores = new Map<number, TagScore[]>();
  private top = new Map<number, number[]>();

  constructor(readonly manifest: PackManifest, core: Uint8Array) {
    const { metadata, sections } = decodePack(core);
    if (metadata.kind !== 'core') throw new Error('Expected inference core');
    this.metadata = metadata;
    const array = <T extends Uint8Array | Uint16Array | Uint32Array | Float64Array>(
      name: string, ctor: { new(buffer: ArrayBufferLike, offset: number, length: number): T; BYTES_PER_ELEMENT: number }, count: number
    ): T => {
      const data = sections.get(name);
      if (!Number.isSafeInteger(count) || count < 0 || !data || data.byteLength !== count * ctor.BYTES_PER_ELEMENT) throw new Error(`Invalid inference section: ${name}`);
      return new ctor(data.buffer, data.byteOffset, count);
    };
    const n = metadata.gameCount, t = metadata.tagCount;
    this.appids = array('appids', Uint32Array, n);
    this.offsets = array('offsets', Uint32Array, n + 1);
    this.tags = array('tags', Uint16Array, t);
    this.ranks = array('ranks', Uint8Array, t);
    this.reviews = array('reviews', Float64Array, n);
    this.observed = array('observed', Uint32Array, n);
    const topSegments = array('topSegments', Uint32Array, metadata.topCount), topApps = array('topApps', Uint32Array, metadata.topCount);
    if (metadata.names.length !== n || this.offsets[0] !== 0 || this.offsets[n] !== t) throw new Error('Invalid inference game directory');
    for (let i = 0; i < n; i++) {
      if (!this.appids[i] || (i && this.appids[i] <= this.appids[i - 1]) || this.offsets[i + 1] < this.offsets[i] ||
          this.observed[i] > metadata.dates.length) throw new Error('Invalid inference game index');
      this.appIndex.set(this.appids[i], i);
    }
    for (const tag of metadata.tags) this.tagIndex.set(tag.tag_id, tag);
    for (const tag of this.tags) if (tag >= metadata.tags.length) throw new Error('Invalid inference tag index');
    for (const row of metadata.scores) {
      if (row.length !== 8 || !this.tagIndex.has(row[1])) throw new Error('Invalid inference score');
      const [segment_id, tag_id, success_lift, confidence, sample_size, top_sample_size, tag_frequency, top_frequency] = row;
      const score = { segment_id, tag_id, tag_name: this.tagIndex.get(tag_id)!.name, success_lift, confidence, sample_size, top_sample_size, tag_frequency, top_frequency };
      const list = this.scores.get(segment_id) ?? []; list.push(score); this.scores.set(segment_id, list);
    }
    for (let i = 0; i < topSegments.length; i++) {
      if (topApps[i] >= n) throw new Error('Invalid inference exemplar index');
      const list = this.top.get(topSegments[i]) ?? []; list.push(topApps[i]); this.top.set(topSegments[i], list);
    }
  }

  addModel(key: string, bytes: Uint8Array): void {
    const { metadata, sections } = decodePack(bytes);
    const embeddings = sections.get('embeddings');
    if (metadata.kind !== 'model' || metadata.model !== key || metadata.setId !== this.manifest.models[key]?.row.set_id || !embeddings) throw new Error('Inference model-set mismatch');
    let end = 0;
    for (const row of metadata.centroids) {
      if (!Number.isInteger(row.length) || row.length <= 0 || row.length % 4 || row.offset !== end || !this.tagIndex.has(row.tagId)) throw new Error('Invalid inference centroid');
      end += row.length;
    }
    if (end !== embeddings.length) throw new Error('Invalid inference centroid length');
    this.models.set(key, { metadata, embeddings });
  }

  getAllTags(): Tag[] { return this.metadata.tags.filter(t => t.is_active === 1).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }
  getSegments(): Segment[] { return this.metadata.segments; }
  findSegment(id: number, price?: string | null): Segment | null {
    const rows = this.metadata.segments.filter(s => s.main_tag_id === id && s.release_year === null);
    return (price ? rows.find(s => s.price_bucket === price) : null) ?? rows.find(s => s.price_bucket === null) ?? null;
  }
  getTagScoresForSegment(id: number): TagScore[] { return this.scores.get(id) ?? []; }
  getAppById(id: number): App | null {
    const i = this.appIndex.get(id);
    if (i === undefined) return null;
    return this.details.get(id) ?? { appid: id, name: this.metadata.names[i], type: 'game', is_released: 1,
      release_date: null, price_usd: null, developer: null, publisher: null, short_description: null, genres: null, categories: null };
  }
  searchApps(text: string, limit: number): App[] {
    // SQLite LIKE folds ASCII case and treats % / _ as wildcards.
    const fold = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
    const pattern = [...fold(text)].map(c => c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    const match = new RegExp(pattern, 'su');
    const apps = this.metadata.names.flatMap((name, i) => match.test(fold(name)) ? [this.getAppById(this.appids[i])!] : [])
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return limit < 0 ? apps : apps.slice(0, limit);
  }
  private tagRows(id: number): Array<{ tag_id: number; rank: number }> {
    const i = this.appIndex.get(id); if (i === undefined) return [];
    const out = [];
    for (let j = this.offsets[i]; j < this.offsets[i + 1]; j++) out.push({ tag_id: this.metadata.tags[this.tags[j]].tag_id, rank: (this.ranks[j] === 255 ? null : this.ranks[j]) as number });
    return out;
  }
  getAppTags(id: number): AppTag[] {
    return this.tagRows(id).sort((a, b) => (a.rank ?? -Infinity) - (b.rank ?? -Infinity)).map(r => ({ appid: id, ...r, tag_name: this.tagIndex.get(r.tag_id)!.name }));
  }
  getAppTagsCollectedAt(id: number): string | null {
    const i = this.appIndex.get(id); return i === undefined ? null : this.metadata.dates[this.observed[i] - 1] ?? null;
  }
  getRetiredTags(ids: number[]): Array<{ tag_id: number; name: string; removed_at: string | null }> {
    return this.getTagsByIds(ids).filter(t => t.is_active === 0).map(t => ({ tag_id: t.tag_id, name: t.name, removed_at: this.metadata.removed[t.tag_id] ?? null }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  getCompetitorTagOverlap(ids: number[]): Array<{ tag_id: number; tag_name: string; overlap_count: number; avg_rank: number }> {
    const values = new Map<number, { count: number; sum: number; ranks: number }>();
    for (const id of new Set(ids)) for (const tag of this.tagRows(id)) {
      const v = values.get(tag.tag_id) ?? { count: 0, sum: 0, ranks: 0 };
      v.count++; if (tag.rank !== null) { v.sum += tag.rank; v.ranks++; } values.set(tag.tag_id, v);
    }
    return [...values].sort(([a], [b]) => a - b).map(([tag_id, v]) => ({ tag_id, tag_name: this.tagIndex.get(tag_id)!.name,
      overlap_count: v.count, avg_rank: (v.ranks ? v.sum / v.ranks : null) as number }))
      .sort((a, b) => b.overlap_count - a.overlap_count || (a.avg_rank ?? -Infinity) - (b.avg_rank ?? -Infinity));
  }
  findTagByName(name: string): Tag | null { return this.metadata.tags.find(t => t.normalized_name === name.toLowerCase().trim()) ?? null; }
  getExemplarGamesForTags(segment: number, ids: number[], limit: number, opts: { excludeAppid?: number | null; nearAppids?: number[] }): { basis: ExemplarBasis; games: Map<number, Array<{ name: string; appid: number }>> } {
    const near = new Set(opts.nearAppids), wanted = new Set(ids), games = new Map<number, Array<{ name: string; appid: number }>>();
    const sorted = (this.top.get(segment) ?? []).filter(i => this.appids[i] !== opts.excludeAppid).slice().sort((a, b) =>
      Number(near.has(this.appids[b])) - Number(near.has(this.appids[a])) ||
      (Number.isNaN(this.reviews[b]) ? -Infinity : this.reviews[b]) - (Number.isNaN(this.reviews[a]) ? -Infinity : this.reviews[a]) || this.appids[a] - this.appids[b]);
    for (const i of sorted) for (let j = this.offsets[i]; j < this.offsets[i + 1]; j++) {
      const id = this.metadata.tags[this.tags[j]].tag_id;
      if (!wanted.has(id)) continue;
      const list = games.get(id) ?? [];
      if (list.length < limit) { list.push({ name: this.metadata.names[i], appid: this.appids[i] }); games.set(id, list); }
    }
    return { basis: 'top', games: new Map([...games].sort(([a], [b]) => a - b)) };
  }
  getAllTagEmbeddings(key: string): TagEmbedding[] {
    const model = this.model(key);
    return model.metadata.centroids.filter(r => this.tagIndex.get(r.tagId)?.is_active === 1).map(r => ({
      tagId: r.tagId, tagName: this.tagIndex.get(r.tagId)!.name,
      embedding: new Float32Array(model.embeddings.buffer, model.embeddings.byteOffset + r.offset, r.length / 4),
    }));
  }
  model(key: string): { metadata: ModelMetadata; embeddings: Uint8Array } {
    const model = this.models.get(key); if (!model) throw new Error(`Inference model data not loaded: ${key}`); return model;
  }
  getTagStats(ids: number[]): Map<number, TagStats> {
    const model = this.models.values().next().value;
    if (!model) throw new Error('Inference model data not loaded');
    const wanted = new Set(ids);
    return new Map(model.metadata.stats.filter(r => wanted.has(r.tag_id)).map(r => [r.tag_id, r as TagStats]));
  }
  getAppTagsForApps(ids: number[]): Map<number, Array<{ tag_id: number; rank: number }>> {
    const out = new Map<number, Array<{ tag_id: number; rank: number }>>();
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) { const tags = this.tagRows(id); if (tags.length) out.set(id, tags); }
    return out;
  }
  getGameInfoForApps(ids: number[]): Map<number, { name: string; reviews: number }> {
    const out = new Map<number, { name: string; reviews: number }>();
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
      const i = this.appIndex.get(id); if (i !== undefined) out.set(id, { name: this.metadata.names[i], reviews: Number.isNaN(this.reviews[i]) ? 0 : this.reviews[i] });
    }
    return out;
  }
  getTagsByIds(ids: number[]): Tag[] { const wanted = new Set(ids); return this.metadata.tags.filter(t => wanted.has(t.tag_id)); }
}
