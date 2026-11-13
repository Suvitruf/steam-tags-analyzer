export interface App {
  appid: number;
  name: string;
  type: string;
  release_date: string | null;
  price_usd: number | null;
  developer: string | null;
  publisher: string | null;
  is_released: number;
  short_description: string | null;
  genres: string | null;
  categories: string | null;
}

export interface Tag {
  tag_id: number;
  name: string;
  normalized_name: string;
  is_active: number;
}

export interface AppTag {
  appid: number;
  tag_id: number;
  tag_name: string;
  rank: number;
}

export interface Segment {
  segment_id: number;
  main_tag_id: number;
  main_tag_name: string;
  release_year: number | null;
  price_bucket: string | null;
  game_count: number;
}

export interface TagScore {
  segment_id: number;
  tag_id: number;
  tag_name: string;
  success_lift: number;
  confidence: number;
  sample_size: number;
  top_sample_size: number;
  tag_frequency: number;
  top_frequency: number;
}

export interface RecommendationInput {
  description: string;
  mainTag?: string;
  appid?: number;
  competitorAppids?: number[];
  priceBucket?: string;
  /**
   * For a game looked up live on Steam: its name + current tag IDs in store
   * order. When given they replace the dataset's snapshot of that App ID.
   */
  appName?: string;
  currentTagIds?: number[];
  /**
   * Drop this App ID from the kNN neighbors without treating it as the
   * analyzed game (no segment pin, no current tags): an offline evaluation
   * simulates an unseen game whose own vector is still in the index.
   * `appid` implies it.
   */
  excludeAppid?: number;
  /**
   * Embedding of `description`, if the caller already has one. Skips the
   * in-browser model; the Node sanity harness (sources/eval) uses it because
   * it embeds with transformers.js directly instead of the web worker.
   */
  queryEmbedding?: Float32Array;
}

/**
 * Retrieval signals for one of an analyzed game's CURRENT tags, computed
 * against the same embedding, neighbor votes and cutoff the recommendations
 * use. Consumed by the tag audit (recommendation/audit.ts).
 */
export interface CurrentTagSignal {
  tagId: number;
  tag: string;
  /** Store-page rank (1 = most-voted). */
  rank: number;
  /** Cosine to the tag's centroid; 0 for a retired tag (it has no centroid). */
  similarity: number;
  /**
   * Position of that cosine among ALL active tags for this description
   * (1 = closest). Absolute cosines cluster in 0.4–0.8 for every tag, so the
   * rank is the usable relevance measure; 0 for a retired tag.
   */
  similarityRank: number;
  /** Normalized kNN neighbor vote, [0,1]. Interpret only when output.neighborEvidenceAvailable. */
  neighborVote: number;
  /**
   * Share of the nearest games carrying the tag at ANY rank, [0,1]. The
   * rank-weighted vote under-counts tags neighbors carry low on their lists
   * (Atmospheric, Pixel Graphics); this is the plain "do games like this
   * have it" answer. Interpret only when output.neighborEvidenceAvailable.
   */
  neighborShare: number;
  /** Fraction of the tag's words the description uses (1 = verbatim). */
  intent: number;
  /** False when Valve has retired the tag. */
  active: boolean;
}

export interface TagRecommendation {
  tag: string;
  tagId: number;
  score: number;
  relevance: number;
  successLift: number;
  confidence: number;
  explanation: string;
  /**
   * Games behind the tag's lift: the segment's top performers (the top fifth
   * of each release-year cohort, as the offline pipeline picks them) that carry the
   * tag, nearest to the query first. `output.exemplarBasis` says whether the
   * database had that set. Never the analyzed game itself.
   */
  exemplarGames: Array<{ name: string; appid: number }>;
}

/**
 * Where exemplar games come from: 'top' = the segment's top-performer set
 * (`segment_top_games`, the lift's numerator); 'segment' = any segment member
 * by review count, when the database predates that table (before 2026-11-12).
 */
export type ExemplarBasis = 'top' | 'segment';

export interface SimilarGame {
  appid: number;
  name: string;
  similarity: number;
  reviews: number;
}

export interface RecommendationOutput {
  primaryTags: TagRecommendation[];
  secondaryTags: TagRecommendation[];
  avoidTags: TagRecommendation[];
  segment: Segment | null;
  /** The segment came from the top-ranked candidate, not from the user or the game's own tags. */
  segmentInferred: boolean;
  /** Set when analyzing an existing game by App ID. */
  analyzedApp?: { appid: number; name: string } | null;
  /** Tag IDs the analyzed game already uses (for "already using" badges). */
  currentTagIds?: number[];
  /** Nearest games to the description; can be present even when their tag evidence is incomplete. */
  similarGames: SimilarGame[];
  /** What `exemplarGames` were drawn from; absent when no segment matched. */
  exemplarBasis?: ExemplarBasis;
  /** True only when a nonempty neighbor set has tag data for every neighbor.
   * When false, zero votes/shares mean unavailable evidence, not observed absence. */
  neighborEvidenceAvailable: boolean;
  /** Signals for each current tag, in store rank order; only when the game has tags. */
  currentTagSignals?: CurrentTagSignal[];
  /** The K-th candidate's similarity: this query's own relevance floor (avoid list, audit). */
  retrievalCutoff?: number;
  /**
   * Every scored candidate in final order, before the primary/secondary
   * partition and its caps. The offline evaluation measures its top-K
   * directly.
   */
  rankedTagIds: number[];
}
