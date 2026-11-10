// Live Steam lookups through the Cloudflare Worker: the
// page's current name, description, store-feature categories and tag list for
// any App ID — games the dataset lacks, and games whose dataset row is a
// months-old snapshot (the nightly rotation revisits ~500 pages a day).
import { STEAM_PROXY_URL } from './config';

export interface LiveApp {
  appid: number;
  name: string;
  /** Steam's app type ('game', 'dlc', 'demo', …). */
  type: string;
  short_description: string;
  /** Current store tags in store order (index + 1 = rank). */
  tagIds: number[];
  /** Store-feature categories as Steam spells them; undefined when the Worker could not read them. */
  categories?: string[];
  genres: string[];
  comingSoon: boolean;
  /** When the Worker fetched this from Steam (ISO 8601); null for an older Worker build. */
  fetchedAt: string | null;
}

interface WorkerAppResponse {
  name?: unknown;
  type?: unknown;
  short_description?: unknown;
  tags?: unknown;
  categories?: unknown;
  genres?: unknown;
  coming_soon?: unknown;
  fetched_at?: unknown;
}

/** False when the site was built without a Worker URL (VITE_STEAM_PROXY_URL). */
export const liveLookupEnabled = STEAM_PROXY_URL !== '';

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

// The Worker answers 404 only when Steam has no store page for the App ID,
// and 503 (with Retry-After) when Steam did not answer: its API intermittently
// returns nothing for existing games from shared egress IPs, so that one is
// worth a second click. No bare status codes in the text: the audit page reads
// a "404" in an error as a missing model artifact.
function lookupError(appid: number, status: number): string {
  if (status === 404) return `App ID ${appid} has no Steam store page`;
  if (status === 503 || status === 502 || status === 429) {
    return `Steam did not answer for App ID ${appid}; try again in a few seconds`;
  }
  return `Steam lookup failed for App ID ${appid} (HTTP ${status})`;
}

/**
 * Fetch one App ID through the Worker. `fresh` bypasses the Worker's day-long
 * edge cache and the browser's own HTTP cache — the audit's "refresh from
 * Steam" — and the Worker stores the result for everyone else.
 */
export async function fetchLiveApp(appid: number, opts: { fresh?: boolean } = {}): Promise<LiveApp> {
  if (!liveLookupEnabled) throw new Error('Live Steam lookup is not configured');
  const url = `${STEAM_PROXY_URL}/app/${appid}${opts.fresh ? '?fresh=1' : ''}`;
  const res = await fetch(url, opts.fresh ? { cache: 'no-store' } : undefined);
  if (!res.ok) throw new Error(lookupError(appid, res.status));
  const data = (await res.json()) as WorkerAppResponse;
  const tagIds = Array.isArray(data.tags)
    ? data.tags.map((t: any) => t?.tagid).filter((id: unknown): id is number => Number.isInteger(id))
    : [];
  return {
    appid,
    name: typeof data.name === 'string' && data.name ? data.name : `App ${appid}`,
    type: typeof data.type === 'string' ? data.type : '',
    short_description: typeof data.short_description === 'string' ? data.short_description : '',
    tagIds,
    categories: Array.isArray(data.categories) ? strings(data.categories) : undefined,
    genres: strings(data.genres),
    comingSoon: Boolean(data.coming_soon),
    fetchedAt: typeof data.fetched_at === 'string' ? data.fetched_at : null,
  };
}
