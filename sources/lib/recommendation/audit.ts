// Tag audit for a RELEASED game: the analyzer's engine pointed at a store page
// that already has tags (docs/tag-audit.md). Instead of proposing tags from
// scratch, it classifies each tag the game currently carries, using the three
// signals the recommendations are already built from:
//
//   similarity    cosine between the description and the tag's centroid
//   neighborVote  how much the nearest games (kNN) use the tag, [0,1]
//   intent        whether the description literally uses the tag's words
//
// plus two facts no embedding can supply: Steam's own store-feature
// categories (co-op, PvP, controller support… are facts, not community
// votes) and tag prevalence (near-universal tags say nothing either way).
//
// The honest limit: the signals answer "does the description / do similar
// games say this", not "is this true". Multiplayer on a game whose blurb never
// mentions it looks exactly like a joke tag — which is why store features are
// checked before anything can be called suspicious.
import type { CurrentTagSignal, ExemplarBasis, Segment, SimilarGame, TagRecommendation, AppTag } from '../types';
import { thinSignalSim } from '../matched-set';
import { recommend, type RecommendationProgressCallback } from './engine';
import { getAppById, getTagStats, getAppTags, getAppTagsCollectedAt, getTagsByIds } from '../db/queries';
import { DEFAULT_MODEL_KEY } from '../llm/models';

export type AuditBucket = 'identity' | 'feature' | 'neutral' | 'weak' | 'suspicious' | 'retired';
export const AUDIT_BUCKETS: readonly AuditBucket[] =
  ['identity', 'feature', 'neutral', 'weak', 'suspicious', 'retired'];

// Thresholds. Relevance is the tag's similarity RANK among all active tags
// for this description, not the absolute cosine: cosines sit in 0.4–0.8 for
// nearly every tag (a game's rank-1 tag and its rank-20 tag differ by ~0.04
// at the median), while the rank and the neighbor vote separate the two ends
// cleanly. Calibrated on a seed-1 sample, reported on seed 42 and the frozen
// holdout: eval/tag_audit_sanity.md.
export const AUDIT = {
  /** Among the closest N tags of ~430 for this description: identity on its own. */
  IDENTITY_TOP_RANK: 20,
  /** Within the closest N: identity only with neighbor agreement. */
  SUPPORTED_TOP_RANK: 60,
  SUPPORTED_VOTE: 0.15,
  /** Carried by at least this share of the nearest games: identity regardless of the blurb. */
  IDENTITY_MIN_SHARE: 0.5,
  /** The description (almost) fully spells the tag out — mirror of INTENT_STATED. */
  INTENT_STATED: 0.85,
  /**
   * Suspicious, tier 1: below the relevance floor AND on none of the nearest
   * games. Any looser share mostly caught true tags the blurb doesn't mention
   * (Card Game on a card game whose blurb is all theme): allowing one
   * neighbor put the top-3 false-flag rate at 2.7%, allowing none 0.7%.
   */
  SUSPECT_MAX_SHARE: 0,
  /**
   * Suspicious, tier 2: VERY far from the description (rank beyond this of
   * ~430) and on at most a few nearest games. Catches the classic joke that
   * a couple of neighbors also carry — Family Friendly on Elden Ring sits at
   * rank ~317 with 3 of 50 neighbors.
   */
  FAR_RANK: 300,
  FAR_MAX_SHARE: 0.06,
  /** Tags on more than this share of all tagged games are too broad to judge — mirror of BROAD_PREVALENCE (export-analytics). */
  BROAD_PREVALENCE: 0.35,
  /** Nearest-game similarity below this: the description is too thin to lean on (10th percentile, sanity run). */
  // Nearest-game cosine below which the description is called thin. An absolute
  // on a scale each encoder sets: the bottom decile of holdout games (p10 0.70
  // with the August set, 0.68 with the November set). A stamped set carries
  // its own measurement in the manifest (thinSignalThreshold below); this
  // constant is the fallback for an unstamped or uncalibrated database.
  THIN_SIGNAL_SIM: 0.68,
  /** The store page leads with this many tags; the slots worth ordering. */
  IDENTITY_SLOTS: 5,
} as const;

// Tag → Steam store-feature categories (apps.categories, spelled as Steam
// does). Structural features only — never genres: "Trading Card Game" is a
// genre, "Steam Trading Cards" is a store feature, and they must not match.
//
// Two lists per tag, because a category can be necessary for a tag without
// being sufficient:
//   verifiedBy  categories that establish the tag's whole claim — the tag is a
//               verified FACT when any of them is listed.
//   requires    categories the claim cannot be true without; when the game's
//               list is known and has none of them, the tag is contradicted.
// "Multi-player" is required by Asynchronous Multiplayer but verifies nothing
// about asynchronous play; "Co-op" is required by Co-op Campaign but says
// nothing about a campaign; "MMO" does not make a game an RPG; "LAN Co-op" is
// networked play, not the same-device play that Local Co-Op means.
interface FeatureTag { verifiedBy: string[]; requires: string[] }
const feature = (verifiedBy: string[], requires: string[] = verifiedBy): FeatureTag => ({ verifiedBy, requires });
const ANY_COOP = ['Co-op', 'Online Co-op', 'LAN Co-op', 'Shared/Split Screen Co-op'];
const ANY_MULTI = ['Multi-player', 'PvP', 'Online PvP', 'LAN PvP', 'Shared/Split Screen PvP', 'MMO', ...ANY_COOP];
const SAME_DEVICE = ['Shared/Split Screen', 'Shared/Split Screen PvP', 'Shared/Split Screen Co-op'];
const FEATURE_TAGS: Record<string, FeatureTag> = {
  'Singleplayer': feature(['Single-player']),
  'Multiplayer': feature(ANY_MULTI),
  'Asynchronous Multiplayer': feature([], ANY_MULTI),
  'Massively Multiplayer': feature(['MMO']),
  'MMORPG': feature([], ['MMO']),
  'Co-op': feature(ANY_COOP),
  'Co-op Campaign': feature([], ANY_COOP),
  'Online Co-Op': feature(['Online Co-op']),
  'Local Co-Op': feature(['Shared/Split Screen Co-op'], ['Shared/Split Screen Co-op', 'LAN Co-op']),
  'Local Multiplayer': feature(SAME_DEVICE, [...SAME_DEVICE, 'LAN PvP', 'LAN Co-op']),
  'Split Screen': feature(SAME_DEVICE),
  'PvP': feature(['PvP', 'Online PvP', 'Shared/Split Screen PvP', 'LAN PvP']),
  'Controller': feature(['Full controller support', 'Partial Controller Support', 'Tracked Controller Support', 'DualShock Controller Support']),
  'VR': feature(['VR Only', 'VR Supported']),
  'Moddable': feature(['Steam Workshop']),
  'Level Editor': feature(['Includes level editor']),
};

/** Store-feature facts for one tag against a game's (lower-cased) category set. */
export function featureFacts(tag: string, categories: Set<string> | undefined): { verifiedBy: string[]; featureMissing: boolean } {
  const spec = FEATURE_TAGS[tag];
  if (!spec || !categories) return { verifiedBy: [], featureMissing: false };
  const has = (c: string) => categories.has(c.toLowerCase());
  return {
    verifiedBy: spec.verifiedBy.filter(has),
    featureMissing: spec.requires.length > 0 && !spec.requires.some(has),
  };
}

// Praise, packaging and content descriptors: applied for reasons other than
// "this is what the game is", so they are neither identity nor a misleading
// genre claim. Same curated set as PRAISE_META_TAGS in
// the analytics artifact schema — keep the two in sync.
const NEUTRAL_TAGS = new Set([
  // player praise (applied after success)
  'Great Soundtrack', 'Soundtrack', 'Classic', 'Addictive', 'Beautiful',
  'Epic', 'Replay Value', 'Nostalgia', 'Immersive', 'Benchmark', 'Gaming',
  // store state / packaging, not gameplay
  'Early Access', 'Free to Play', 'Moddable', 'Mod', 'Remake', 'Sequel',
  'Reboot', 'Tutorial', 'Controller', 'Touch-Friendly', 'Mouse Only',
  // content warnings — descriptors big-budget games carry, not genre choices
  'Sexual Content', 'Nudity', 'Violent', 'Gore',
]);

export interface AuditedTag extends CurrentTagSignal {
  bucket: AuditBucket;
  reason: string;
  /** Store features that verify a feature tag (empty otherwise). */
  verifiedBy: string[];
  /** The tag names a store feature and the game's feature list lacks it. */
  featureMissing: boolean;
}

export interface TagAudit {
  app: {
    appid: number;
    name: string;
    /** Tags, description and categories came from Steam just now, not from the dataset. */
    live: boolean;
    /** The dataset has a row for this App ID (even when `live` replaced its snapshot). */
    inDataset: boolean;
    /** When the live data was fetched (ISO 8601), if known. */
    fetchedAt: string | null;
  };
  /** Store-feature categories were known, so feature verification and contradiction could run. */
  featuresKnown: boolean;
  /** When the dataset last observed this game's tags; null when it has no row. */
  snapshotCollectedAt: string | null;
  /** Live tags against the dataset snapshot, by name; only for a live refresh of a dataset game. */
  liveDiff: { added: string[]; removed: string[] } | null;
  segment: Segment | null;
  /** The game's current tags, store order, classified. */
  tags: AuditedTag[];
  counts: Record<AuditBucket, number>;
  /** Tags the analyzer would recommend that the page doesn't carry (primary first). */
  missing: TagRecommendation[];
  /** What the examples under `missing` are drawn from (the recommender's `exemplarBasis`). */
  exemplarBasis?: ExemplarBasis;
  /** Recommended feature tags withheld because the store's feature list lacks what they require. */
  missingContradicted: TagRecommendation[];
  /** The analyzer's avoid list for this game. */
  avoid: TagRecommendation[];
  similarGames: SimilarGame[];
  /**
   * Whether evidence gives the engine enough to go on. Thin when neighbor
   * tag data is unavailable/incomplete, or when the
   * nearest game is a weak match, or when none of the top-3 store tags is
   * supported — a blurb that is all lore/theme and no gameplay (Total
   * Annihilation's, say) has close neighbors in lore, not in genre.
   */
  signal: { topSimilarity: number; thin: boolean; reason: string | null; neighborEvidenceAvailable: boolean };
  /** Identity tags sitting outside the top slots while weaker tags hold them. */
  orderNotes: string[];
  retrievalCutoff: number;
}

export interface AuditInput {
  appid: number;
  /**
   * What a live Steam lookup returned (lib/live.ts): for a game the dataset
   * lacks, or a refresh of one it has. These tags, description and categories
   * replace the dataset snapshot.
   */
  live?: { name: string; short_description: string; tagIds: number[]; categories?: string[]; fetchedAt?: string | null };
  /** Precomputed description embedding (the Node sanity harness). */
  queryEmbedding?: Float32Array;
}

export interface AuditContext {
  /** Missing or incomplete neighbor data cannot establish support or absence. */
  neighborEvidenceAvailable: boolean;
  retrievalCutoff: number;
  /** Lower-cased store-feature categories; undefined when unknown (live lookup). */
  categories?: Set<string>;
  /** tag_id → share of all tagged games carrying the tag. */
  prevalence: Map<number, number>;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Classify one current tag. Order matters and encodes the argument above:
 * retired → identity (stated, or close to the description, or close-ish with
 * neighbor agreement) → verified store feature → neutral (praise/meta or
 * near-universal) → identity by neighbor consensus → suspicious → weak.
 * The consensus route sits after the broad-tag check so Singleplayer/Indie
 * can't become "identity" just because every neighbor carries them.
 */
export function classifyTag(
  s: CurrentTagSignal,
  ctx: AuditContext
): Pick<AuditedTag, 'bucket' | 'reason' | 'verifiedBy' | 'featureMissing'> {
  const { verifiedBy, featureMissing } = featureFacts(s.tag, ctx.categories);
  const base = { verifiedBy, featureMissing };

  if (!s.active) {
    return { ...base, bucket: 'retired', reason: 'Valve retired this tag; it spends a slot players can no longer browse by.' };
  }
  if (s.intent >= AUDIT.INTENT_STATED) {
    return { ...base, bucket: 'identity', reason: 'Your description uses these words.' };
  }
  if (s.similarityRank > 0 && s.similarityRank <= AUDIT.IDENTITY_TOP_RANK) {
    return { ...base, bucket: 'identity', reason: `Among the ${AUDIT.IDENTITY_TOP_RANK} tags closest to the description (#${s.similarityRank}).` };
  }
  if (ctx.neighborEvidenceAvailable && s.similarityRank > 0 && s.similarityRank <= AUDIT.SUPPORTED_TOP_RANK && s.neighborVote >= AUDIT.SUPPORTED_VOTE) {
    return {
      ...base, bucket: 'identity',
      reason: `Close to the description (#${s.similarityRank} of the tags) and games like this use it (${pct(s.neighborVote)} of the neighbor vote).`,
    };
  }
  if (verifiedBy.length > 0) {
    return { ...base, bucket: 'feature', reason: `Verified by the store's feature list: ${verifiedBy.join(', ')}.` };
  }
  if (NEUTRAL_TAGS.has(s.tag)) {
    return { ...base, bucket: 'neutral', reason: 'Praise, packaging or a content descriptor — not a claim about what the game is.' };
  }
  const prevalence = ctx.prevalence.get(s.tagId) ?? 0;
  if (prevalence >= AUDIT.BROAD_PREVALENCE) {
    return { ...base, bucket: 'neutral', reason: `On ${pct(prevalence)} of all tagged games; too broad to say much either way.` };
  }
  if (!ctx.neighborEvidenceAvailable) {
    return {
      ...base, bucket: 'weak',
      reason: `Limited evidence: #${s.similarityRank} closest tag to the description. Similar-game tag data is unavailable or incomplete, so this tag cannot be judged suspicious.`,
    };
  }
  if (s.neighborShare >= AUDIT.IDENTITY_MIN_SHARE) {
    return { ...base, bucket: 'identity', reason: `${pct(s.neighborShare)} of the nearest games carry it.` };
  }
  const missingNote = featureMissing ? " The store's feature list doesn't include it either." : '';
  if (s.similarity < ctx.retrievalCutoff && s.neighborShare <= AUDIT.SUSPECT_MAX_SHARE) {
    return {
      ...base, bucket: 'suspicious',
      reason: `Below this game's relevance floor (#${s.similarityRank} closest tag), and none of the nearest games carry it.${missingNote}`,
    };
  }
  if (s.similarityRank > AUDIT.FAR_RANK && s.neighborShare <= AUDIT.FAR_MAX_SHARE) {
    return {
      ...base, bucket: 'suspicious',
      reason: `Among the tags furthest from the description (#${s.similarityRank} closest), and only ${pct(s.neighborShare)} of the nearest games carry it.${missingNote}`,
    };
  }
  return {
    ...base, bucket: 'weak',
    reason: `Not contradicted, but weakly supported: #${s.similarityRank} closest tag, on ${pct(s.neighborShare)} of the nearest games.${missingNote}`,
  };
}

function parseCategories(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  } catch {
    return undefined;
  }
}

// tag_stats stores idf = log10(total_tagged_games / game_count), so the
// denominator can be recovered from any row without a COUNT(DISTINCT) scan of
// app_tags (3.5M rows in sql.js).
function prevalenceFor(tagIds: number[]): Map<number, number> {
  const out = new Map<number, number>();
  const stats = getTagStats(tagIds);
  let total = 0;
  for (const st of stats.values()) {
    if (st.game_count > 0 && st.idf > 0) total = Math.max(total, st.game_count * Math.pow(10, st.idf));
  }
  if (total <= 0) return out;
  for (const st of stats.values()) out.set(st.tag_id, st.game_count / total);
  return out;
}

// What a live lookup added or dropped relative to the dataset's snapshot of
// the same page, by name, each side in its own store order.
function diffAgainstSnapshot(liveIds: number[], snapshot: AppTag[]): { added: string[]; removed: string[] } {
  const live = new Set(liveIds);
  const had = new Set(snapshot.map(t => t.tag_id));
  const addedIds = liveIds.filter(id => !had.has(id));
  const nameById = new Map(getTagsByIds(addedIds).map(t => [t.tag_id, t.name]));
  return {
    added: addedIds.map(id => nameById.get(id) ?? `#${id}`),
    removed: snapshot.filter(t => !live.has(t.tag_id)).map(t => t.tag_name),
  };
}

function listNames(tags: AuditedTag[]): string {
  return tags.map(t => `${t.tag} (#${t.rank})`).join(', ');
}

/** The thin-signal cosine for this model: the set's recorded holdout p10, else AUDIT.THIN_SIGNAL_SIM. */
export function thinSignalThreshold(modelKey: string): number {
  return thinSignalSim(modelKey) ?? AUDIT.THIN_SIGNAL_SIM;
}

export async function auditGame(
  input: AuditInput,
  onProgress?: RecommendationProgressCallback,
  modelKey: string = DEFAULT_MODEL_KEY
): Promise<TagAudit> {
  const app = getAppById(input.appid);
  if (!app && !input.live) throw new Error(`App ID ${input.appid} isn't in the dataset`);
  if (app && input.live && input.live.tagIds.length === 0) {
    throw new Error('Steam returned no tags for this page right now; audit the dataset snapshot instead');
  }
  // Live data describes the page as it is now; the dataset row is a snapshot.
  const description = (input.live?.short_description || app?.short_description || '').trim();
  if (!description) throw new Error('This game has no store description to audit');

  const output = await recommend(
    {
      description,
      appid: input.appid,
      appName: input.live?.name,
      currentTagIds: input.live?.tagIds,
      queryEmbedding: input.queryEmbedding,
    },
    onProgress,
    modelKey
  );
  const signals = output.currentTagSignals ?? [];
  if (signals.length === 0) throw new Error('This game has no tags to audit');

  // Live categories first; a Worker that could not read them falls back to the
  // dataset's (store features change far less often than tags do).
  const categories = input.live?.categories ?? parseCategories(app?.categories);
  const ctx: AuditContext = {
    neighborEvidenceAvailable: output.neighborEvidenceAvailable,
    retrievalCutoff: output.retrievalCutoff ?? 0,
    categories: categories ? new Set(categories.map(c => c.toLowerCase())) : undefined,
    prevalence: prevalenceFor(signals.map(s => s.tagId)),
  };
  const tags: AuditedTag[] = signals.map(s => ({ ...s, ...classifyTag(s, ctx) }));

  const counts = Object.fromEntries(AUDIT_BUCKETS.map(b => [b, 0])) as Record<AuditBucket, number>;
  for (const t of tags) counts[t.bucket]++;

  const have = new Set(signals.map(s => s.tagId));
  // The same fact check applies to proposals: suggesting Co-op to a page whose
  // store features list no co-op mode would recommend a contradicted tag.
  const proposed = [...output.primaryTags, ...output.secondaryTags].filter(t => !have.has(t.tagId));
  const missing = proposed.filter(t => !featureFacts(t.tag, ctx.categories).featureMissing);
  const missingContradicted = proposed.filter(t => featureFacts(t.tag, ctx.categories).featureMissing);

  // Order: the leading slots are what players see first and how this tool
  // groups games (segment membership = tag in the top 5). Tags are ordered by
  // votes, so this is about which tags to apply and encourage, not a setting.
  // Only a suspicious/retired tag in a leading slot is worth a note — weak or
  // broad tags up top (Indie at #1) are how most Steam pages look.
  const slots = AUDIT.IDENTITY_SLOTS;
  const buried = tags.filter(t => t.bucket === 'identity' && t.rank > slots);
  const squatting = tags.filter(t =>
    t.rank <= slots && (t.bucket === 'suspicious' || t.bucket === 'retired')
  );
  const orderNotes: string[] = [];
  if (buried.length > 0 && squatting.length > 0) {
    orderNotes.push(
      `${listNames(buried)} ${buried.length === 1 ? 'sits' : 'sit'} below the top ${slots} while ` +
      `${listNames(squatting)} ${squatting.length === 1 ? 'holds' : 'hold'} a leading slot. ` +
      `The top ${slots} are what players see first and what groups this game with its peers; ` +
      `the tags you apply yourself count as votes, so lead with the identity tags.`
    );
  }

  const topSimilarity = output.similarGames[0]?.similarity ?? 0;
  // Only tags the text signals can judge count here: a neutral "Classic" or a
  // verified "Multiplayer" in the top 3 says nothing about the blurb.
  const top3 = tags.filter(t => t.rank <= 3 && (t.bucket === 'identity' || t.bucket === 'weak' || t.bucket === 'suspicious'));
  const top3Unsupported = top3.length >= 2 && top3.every(t => t.bucket !== 'identity');
  const thinReason = !output.neighborEvidenceAvailable
    ? 'Similar-game tag data is unavailable or incomplete. This audit uses the description and store features; suspicious-tag judgments and avoid suggestions are withheld.'
    : topSimilarity < thinSignalThreshold(modelKey)
      ? `The nearest game is only a ${topSimilarity.toFixed(2)} cosine match, so this description gives the engine little to go on.`
      : top3Unsupported
        ? 'None of the three most-voted tags is backed by the description or by similar games — the blurb likely describes story or theme rather than gameplay.'
        : null;

  const snapshotCollectedAt = app ? getAppTagsCollectedAt(input.appid) : null;
  const liveDiff = app && input.live ? diffAgainstSnapshot(input.live.tagIds, getAppTags(input.appid)) : null;

  return {
    app: {
      appid: input.appid,
      name: input.live?.name ?? app?.name ?? `App ${input.appid}`,
      live: input.live !== undefined,
      inDataset: app !== null,
      fetchedAt: input.live?.fetchedAt ?? null,
    },
    featuresKnown: ctx.categories !== undefined,
    snapshotCollectedAt,
    liveDiff,
    segment: output.segment,
    tags,
    counts,
    missing,
    missingContradicted,
    // A tag already on the page is judged in the table; repeating it here as
    // "avoid" would contradict a verified store feature (Co-op on Elden Ring).
    avoid: output.neighborEvidenceAvailable ? output.avoidTags.filter(t => !have.has(t.tagId)) : [],
    similarGames: output.similarGames,
    exemplarBasis: output.exemplarBasis,
    signal: { topSimilarity, thin: thinReason !== null, reason: thinReason, neighborEvidenceAvailable: output.neighborEvidenceAvailable },
    orderNotes,
    retrievalCutoff: ctx.retrievalCutoff,
  };
}
