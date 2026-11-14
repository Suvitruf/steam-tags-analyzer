import { getAppTagsForApps, getGameInfoForApps } from '../db/queries';
import { fetchLiveApp, liveLookupEnabled } from '../live';
import type { CompetitorEvidence } from '../types';

const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 0xffffffff;
const uniqueIds = (ids: number[]) => [...new Set(ids.filter(validId))];

/** Keep the report and its denominator consistent, including replayed snapshots. */
export function normalizeCompetitors(competitors: CompetitorEvidence[]): CompetitorEvidence[] {
  const games = new Map<number, CompetitorEvidence>();
  for (const c of competitors) {
    if (!validId(c.appid)) continue;
    const tagIds = c.source === 'unavailable' ? [] : uniqueIds(c.tagIds);
    const normalized: CompetitorEvidence = tagIds.length
      ? { ...c, tagIds }
      : { ...c, tagIds, source: 'unavailable', issue: c.issue ?? 'No tag data available.' };
    if (!games.has(c.appid) || (games.get(c.appid)!.source === 'unavailable' && tagIds.length)) {
      games.set(c.appid, normalized);
    }
  }
  return [...games.values()];
}

/** Reject partial numbers ("123oops"), rather than looking up a different game. */
export function parseCompetitorAppids(text: string): number[] {
  if (!text.trim()) return [];
  const parts = text.split(',').map(s => s.trim());
  if (parts.some(s => !/^\d+$/.test(s) || !validId(Number(s)))) {
    throw new Error('Enter competitor App IDs as positive whole numbers, separated by commas.');
  }
  return uniqueIds(parts.map(Number));
}

/** A missing or empty tag list is unavailable evidence, never an observed zero. */
export function localCompetitors(appids: number[]): CompetitorEvidence[] {
  const ids = uniqueIds(appids);
  const tags = getAppTagsForApps(ids);
  const info = getGameInfoForApps(ids);
  return ids.map(appid => {
    const tagIds = uniqueIds((tags.get(appid) ?? []).map(t => t.tag_id));
    return {
      appid, name: info.get(appid)?.name ?? `App ${appid}`, tagIds,
      source: tagIds.length ? 'dataset' : 'unavailable',
      ...(tagIds.length ? {} : { issue: 'No tags in the dataset.' }),
    };
  });
}

/** The page resolves live evidence before calling the deterministic engine.
 * Bound requests and their lifetime; failed lookups can be retried next analysis. */
export async function resolveCompetitors(
  appids: number[],
  options: { lookup?: typeof fetchLiveApp | null; timeoutMs?: number } = {},
): Promise<CompetitorEvidence[]> {
  const competitors = localCompetitors(appids);
  const missing = competitors.filter(c => c.source === 'unavailable');
  const lookup = options.lookup === undefined ? (liveLookupEnabled ? fetchLiveApp : null) : options.lookup;
  if (!lookup) {
    for (const c of missing) c.issue = 'No tags in the dataset; live Steam lookup is not configured.';
    return competitors;
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
    while (next < missing.length) {
      const c = missing[next++];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
      try {
        const live = await lookup(c.appid, { signal: controller.signal });
        c.name = live.name;
        c.tagIds = uniqueIds(live.tagIds);
        if (c.tagIds.length) {
          c.source = 'live';
          delete c.issue;
        } else {
          c.issue = 'Steam returned no tags; this competitor was not counted.';
        }
      } catch (err) {
        c.issue = controller.signal.aborted
          ? 'Steam lookup timed out; try analyzing again.'
          : err instanceof Error ? err.message : 'Steam lookup failed; try analyzing again.';
      } finally {
        clearTimeout(timer);
      }
    }
  }));
  return competitors;
}

/** Competitor overlap: each usable game votes
 * once per tag; duplicates and unavailable lists never dilute the denominator. */
export function competitorOverlap(competitors: CompetitorEvidence[]): Map<number, number> {
  const games = normalizeCompetitors(competitors).filter(c => c.source !== 'unavailable');
  const overlap = new Map<number, number>();
  for (const c of games) {
    for (const id of c.tagIds) overlap.set(id, (overlap.get(id) ?? 0) + 1);
  }
  for (const [id, count] of overlap) overlap.set(id, count / games.length);
  return overlap;
}
