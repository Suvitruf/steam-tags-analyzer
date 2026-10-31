import { query, queryOne } from './client';
import type { App, Tag, AppTag, Segment, TagScore } from '../types';

export function getAllTags(): Tag[] {
  return query<Tag>('SELECT tag_id, name, normalized_name, is_active FROM tags WHERE is_active = 1 ORDER BY name');
}

export function getSegments(): Segment[] {
  return query<Segment>(
    `SELECT s.segment_id, s.main_tag_id, t.name as main_tag_name,
            s.release_year, s.price_bucket, s.game_count
     FROM segments s
     JOIN tags t ON t.tag_id = s.main_tag_id
     ORDER BY s.game_count DESC`
  );
}

export function findSegment(mainTagId: number, priceBucket?: string | null): Segment | null {
  if (priceBucket) {
    const seg = queryOne<Segment>(
      `SELECT s.segment_id, s.main_tag_id, t.name as main_tag_name,
              s.release_year, s.price_bucket, s.game_count
       FROM segments s
       JOIN tags t ON t.tag_id = s.main_tag_id
       WHERE s.main_tag_id = ? AND s.price_bucket = ? AND s.release_year IS NULL`,
      [mainTagId, priceBucket]
    );
    if (seg) return seg;
  }

  return queryOne<Segment>(
    `SELECT s.segment_id, s.main_tag_id, t.name as main_tag_name,
            s.release_year, s.price_bucket, s.game_count
     FROM segments s
     JOIN tags t ON t.tag_id = s.main_tag_id
     WHERE s.main_tag_id = ? AND s.release_year IS NULL AND s.price_bucket IS NULL`,
    [mainTagId]
  );
}

export function getTagScoresForSegment(segmentId: number): TagScore[] {
  return query<TagScore>(
    `SELECT ts.segment_id, ts.tag_id, t.name as tag_name,
            ts.success_lift, ts.confidence, ts.sample_size,
            ts.top_sample_size, ts.tag_frequency, ts.top_frequency
     FROM tag_scores ts
     JOIN tags t ON t.tag_id = ts.tag_id
     WHERE ts.segment_id = ?
     ORDER BY ts.success_lift DESC`,
    [segmentId]
  );
}

export function searchApps(searchQuery: string, limit = 20): App[] {
  return query<App>(
    `SELECT appid, name, type, release_date, price_usd, developer, publisher,
            is_released, short_description, genres, categories
     FROM apps
     WHERE name LIKE ? AND is_released = 1
     ORDER BY name LIMIT ?`,
    [`%${searchQuery}%`, limit]
  );
}

export function getAppById(appid: number): App | null {
  return queryOne<App>(
    `SELECT appid, name, type, release_date, price_usd, developer, publisher,
            is_released, short_description, genres, categories
     FROM apps WHERE appid = ?`,
    [appid]
  );
}

export function getAppTags(appid: number): AppTag[] {
  return query<AppTag>(
    `SELECT at.appid, at.tag_id, t.name as tag_name, at.rank, at.weight
     FROM app_tags at
     JOIN tags t ON t.tag_id = at.tag_id
     WHERE at.appid = ?
     ORDER BY at.rank`,
    [appid]
  );
}

/**
 * Which of these tags has Valve retired? Used to warn a developer whose store
 * page still carries a tag that no longer exists in the taxonomy — Valve ships
 * these changes with no migration notice (see the /tag-changes/ page).
 */
export function getRetiredTags(tagIds: number[]): Array<{ tag_id: number; name: string; removed_at: string | null }> {
  if (tagIds.length === 0) return [];
  const placeholders = tagIds.map(() => '?').join(',');
  return query(
    `SELECT t.tag_id, t.name,
            (SELECT MAX(c.changed_at) FROM tag_changes c
              WHERE c.tag_id = t.tag_id AND c.change_type = 'removed') AS removed_at
     FROM tags t
     WHERE t.is_active = 0 AND t.tag_id IN (${placeholders})
     ORDER BY t.name`,
    tagIds
  );
}

export function getCompetitorTagOverlap(appids: number[]): Array<{ tag_id: number; tag_name: string; overlap_count: number; avg_rank: number }> {
  if (appids.length === 0) return [];

  const placeholders = appids.map(() => '?').join(',');
  return query(
    `SELECT at.tag_id, t.name as tag_name,
            COUNT(DISTINCT at.appid) as overlap_count,
            AVG(at.rank) as avg_rank
     FROM app_tags at
     JOIN tags t ON t.tag_id = at.tag_id
     WHERE at.appid IN (${placeholders})
     GROUP BY at.tag_id
     ORDER BY overlap_count DESC, avg_rank ASC`,
    appids
  );
}

export function getTopGamesInSegment(segmentId: number, limit = 10): App[] {
  return query<App>(
    `SELECT a.appid, a.name, a.type, a.release_date, a.price_usd,
            a.developer, a.publisher, a.is_released, a.short_description,
            a.genres, a.categories
     FROM apps a
     JOIN app_tags at ON a.appid = at.appid
     JOIN segments s ON s.main_tag_id = at.tag_id AND at.rank = 1
     LEFT JOIN app_metrics m ON a.appid = m.appid
     WHERE s.segment_id = ? AND a.is_released = 1
     ORDER BY m.review_count DESC
     LIMIT ?`,
    [segmentId, limit]
  );
}

export function findTagByName(name: string): Tag | null {
  return queryOne<Tag>(
    'SELECT tag_id, name, normalized_name, is_active FROM tags WHERE normalized_name = ?',
    [name.toLowerCase().trim()]
  );
}

/**
 * Top-reviewed segment games carrying each of the given tags, in ONE query.
 * The per-tag version of this was the analyzer's freeze: called once per
 * scored candidate (~109x), each call re-scanning and re-sorting the segment
 * join, it cost ~1.4s of main-thread stall per analysis (measured 2026-08-10).
 * A window function partitions a single scan instead.
 */
export function getExemplarGamesForTags(
  segmentId: number,
  tagIds: number[],
  limit = 3
): Map<number, Array<{ name: string; appid: number }>> {
  const result = new Map<number, Array<{ name: string; appid: number }>>();
  if (tagIds.length === 0) return result;
  const placeholders = tagIds.map(() => '?').join(',');
  const rows = query<{ tag_id: number; name: string; appid: number }>(
    `SELECT tag_id, name, appid FROM (
       SELECT at2.tag_id AS tag_id, a.name AS name, a.appid AS appid,
              ROW_NUMBER() OVER (PARTITION BY at2.tag_id ORDER BY m.review_count DESC) AS rn
       FROM apps a
       JOIN app_tags at1 ON a.appid = at1.appid
       JOIN segments s ON s.main_tag_id = at1.tag_id AND at1.rank = 1
       JOIN app_tags at2 ON a.appid = at2.appid AND at2.tag_id IN (${placeholders})
       LEFT JOIN app_metrics m ON a.appid = m.appid
       WHERE s.segment_id = ? AND a.is_released = 1
     ) WHERE rn <= ?
     ORDER BY tag_id, rn`,
    [...tagIds, segmentId, limit]
  );
  for (const r of rows) {
    const list = result.get(r.tag_id);
    if (list) list.push({ name: r.name, appid: r.appid });
    else result.set(r.tag_id, [{ name: r.name, appid: r.appid }]);
  }
  return result;
}

export interface TagEmbedding {
  tagId: number;
  tagName: string;
  embedding: Float32Array;
}

export interface TagStats {
  tag_id: number;
  game_count: number;
  avg_rank: number;
  idf: number;
  top1_rate: number;
}

function blobToFloat32Array(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export function getAllTagEmbeddings(modelName: string): TagEmbedding[] {
  const rows = query<{ tag_id: number; tag_name: string; embedding: Uint8Array }>(
    `SELECT te.tag_id, t.name as tag_name, te.embedding
     FROM tag_embeddings te
     JOIN tags t ON t.tag_id = te.tag_id
     WHERE te.model_name = ? AND t.is_active = 1`,
    [modelName]
  );
  return rows.map(r => ({
    tagId: r.tag_id,
    tagName: r.tag_name,
    embedding: blobToFloat32Array(r.embedding),
  }));
}

export function getTagStats(tagIds: number[]): Map<number, TagStats> {
  if (tagIds.length === 0) return new Map();
  const placeholders = tagIds.map(() => '?').join(',');
  const rows = query<TagStats>(
    `SELECT tag_id, game_count, avg_rank, idf, top1_rate
     FROM tag_stats
     WHERE tag_id IN (${placeholders})`,
    tagIds
  );
  const map = new Map<number, TagStats>();
  for (const r of rows) map.set(r.tag_id, r);
  return map;
}

// Tags (with rank) for many apps at once — for aggregating kNN neighbors' tags.
export function getAppTagsForApps(appids: number[]): Map<number, Array<{ tag_id: number; rank: number }>> {
  const map = new Map<number, Array<{ tag_id: number; rank: number }>>();
  if (appids.length === 0) return map;
  const placeholders = appids.map(() => '?').join(',');
  const rows = query<{ appid: number; tag_id: number; rank: number }>(
    `SELECT appid, tag_id, rank FROM app_tags WHERE appid IN (${placeholders})`,
    appids
  );
  for (const r of rows) {
    let list = map.get(r.appid);
    if (!list) { list = []; map.set(r.appid, list); }
    list.push({ tag_id: r.tag_id, rank: r.rank });
  }
  return map;
}

// Name + review count for many apps at once — for the similar-games output.
export function getGameInfoForApps(appids: number[]): Map<number, { name: string; reviews: number }> {
  const map = new Map<number, { name: string; reviews: number }>();
  if (appids.length === 0) return map;
  const placeholders = appids.map(() => '?').join(',');
  const rows = query<{ appid: number; name: string; reviews: number }>(
    `SELECT a.appid, a.name, COALESCE(m.review_count, 0) as reviews
     FROM apps a LEFT JOIN app_metrics m ON m.appid = a.appid
     WHERE a.appid IN (${placeholders})`,
    appids
  );
  for (const r of rows) map.set(r.appid, { name: r.name, reviews: r.reviews });
  return map;
}

export function getTagsByIds(tagIds: number[]): Tag[] {
  if (tagIds.length === 0) return [];
  const placeholders = tagIds.map(() => '?').join(',');
  return query<Tag>(
    `SELECT tag_id, name, normalized_name, is_active FROM tags WHERE tag_id IN (${placeholders})`,
    tagIds
  );
}
