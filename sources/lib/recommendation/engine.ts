import { normalizeIntentDescription, intentScore, suppressSubsumedIntents, INTENT_STATED } from './intent';
import type {
  CurrentTagSignal,
  RecommendationInput,
  RecommendationOutput,
  Segment,
  SimilarGame,
  ExemplarBasis,
  TagRecommendation,
  TagScore,
} from '../types';
import {
  findSegment,
  findTagByName,
  getTagScoresForSegment,
  getAppById,
  getAppTags,
  getAppTagsForApps,
  getGameInfoForApps,
  getCompetitorTagOverlap,
  getExemplarGamesForTags,
  getAllTagEmbeddings,
  getTagStats,
  getTagsByIds,
  type TagEmbedding,
  type TagStats,
} from '../db/queries';
import { findSimilarTags, embed, cosineSimilarity } from '../llm/engine';
import { loadGameVectors, projectQuery, nearestGames, type GameVectors } from '../llm/game-knn';
import { DEFAULT_MODEL_KEY } from '../llm/models';
import { GAME_VECTOR_MODELS, gameVectorsUrl } from '../config';
import { currentSetId } from '../matched-set';
import { predict, type FeatureVector, featureVectorToArray } from '../scoring/ranker';

// `bytes` accompanies stages that download something (today only the game-vector
// blob on its first use per model) so the UI can draw a real progress bar.
export type RecommendationProgressCallback = (
  stage: string,
  detail?: string,
  bytes?: { loaded: number; total: number | null }
) => void;

const TOP_K_CANDIDATES = 120;

// Game-level kNN channel (the published game-vector format).
const KNN_NEIGHBORS = 50;          // nearest games to pull per query
const SIMILAR_GAMES_SHOWN = 6;     // how many to surface in the output
const KNN_WEIGHT = 2.0;            // swept 2026-07-08: 0.5→2.0 gains +4.5 id_recall; higher evals better but drowns lift/intent (the published game-vector format)
const KNN_EXPAND_MIN = 0.3;        // min neighbor vote to rescue a missed tag
const KNN_EXPAND_MAX = 15;         // cap on kNN-added candidates

// "Tags to avoid" — commercially tempting in the segment but wrong for this
// game. Sourced from the segment's top-lift tags (NOT the similarity
// retrieval: the dangerous tags are by definition far from the description,
// so the old draw-from-candidates check was always empty). "Low relevance" is
// relative to the query's own similarity scale: below the retrieval cutoff
// (the K-th candidate), i.e. the tag wouldn't have made the candidate list.
const AVOID_MIN_SHRUNK_LIFT = 1.4; // confidence-shrunk lift floor
const AVOID_MIN_SAMPLE = 10;       // lift computed from fewer games is noise
const AVOID_MAX_NEIGHBOR_VOTE = 0.15; // similar games using it = not misleading
const AVOID_LIMIT = 5;

// How strongly to boost a tag whose words the user explicitly used in their
// description. Protects stated identity tags ("turn-based", "roguelike") from
// being demoted as non-distinctive within their segment.
const INTENT_WEIGHT = 0.4;

// How strongly a tag shared by the user's named competitors boosts its score.
// competitorOverlap is the fraction of competitors carrying the tag [0,1], so a
// tag every competitor uses gets up to +30%. Only applies when the user
// provides competitor App IDs; otherwise the factor is 1.0.
const COMPETITOR_WEIGHT = 0.3;

// How strongly within-segment commercial lift moves the final score. The
// LightGBM ranker barely uses success_lift (it is sparse and clusters near
// 1.0 in training), so we apply it as an explicit multiplicative factor to
// keep the "appears Nx more often among top performers" signal meaningful.
const LIFT_WEIGHT = 0.5;
const LIFT_MIN = 0.5; // a weak lift shouldn't zero out an otherwise relevant tag
const LIFT_MAX = 3.0; // an extreme lift shouldn't dominate everything else

// Raw lift is topFreq/tagFreq over as few as 3 games — pure noise at that
// sample size. Shrink it toward the neutral 1.0 by the tag's confidence
// (log-scaled sample size, saturates at 100 games) before it multiplies the
// score: a 3-game tag with raw lift 3.0 but confidence 0.3 contributes 1.6x
// worth of signal, not 3.0x.
function shrinkLift(successLift: number, confidence: number): number {
  return 1 + (successLift - 1) * confidence;
}

// Map the unbounded lambdarank score to (0,1) so the downstream multiplicative
// factors stay monotonic and the displayed value is never negative.
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function liftFactor(successLift: number): number {
  const clamped = Math.max(LIFT_MIN, Math.min(LIFT_MAX, successLift));
  return 1 + LIFT_WEIGHT * (clamped - 1);
}

const tagEmbeddingsCache = new Map<string, TagEmbedding[]>();

function getCachedTagEmbeddings(modelKey: string): TagEmbedding[] {
  let cached = tagEmbeddingsCache.get(modelKey);
  if (!cached) {
    cached = getAllTagEmbeddings(modelKey);
    tagEmbeddingsCache.set(modelKey, cached);
  }
  return cached;
}

// The game-vector blob is ~8MB; fetch+parse once per model and reuse. Cache the
// promise so concurrent analyses share one download; drop it on failure so a
// transient error can be retried next time.
const gameVectorsCache = new Map<string, Promise<GameVectors>>();

export function getCachedGameVectors(modelKey: string, onProgress?: RecommendationProgressCallback): Promise<GameVectors> {
  let p = gameVectorsCache.get(modelKey);
  if (!p) {
    // Only the call that starts the download sees its progress; later callers
    // share the promise and get the parsed blob.
    p = loadGameVectors(gameVectorsUrl(modelKey, currentSetId(modelKey)), onProgress && ((loaded, total) =>
      onProgress('Finding similar games', 'downloading game index', { loaded, total })));
    p.catch(() => gameVectorsCache.delete(modelKey));
    gameVectorsCache.set(modelKey, p);
  }
  return p;
}

export async function recommend(
  input: RecommendationInput,
  onProgress?: RecommendationProgressCallback,
  modelKey: string = DEFAULT_MODEL_KEY
): Promise<RecommendationOutput> {
  onProgress?.('Loading tag embeddings');
  const allTagEmbeddings = getCachedTagEmbeddings(modelKey);
  if (allTagEmbeddings.length === 0) {
    throw new Error(
      `No tag embeddings for model "${modelKey}" in the database — this model hasn't been built yet.`
    );
  }

  const descNorm = normalizeIntentDescription(input.description);
  const descTokens = new Set(descNorm.split(' '));

  // Tags whose full name appears verbatim in the description are force-included
  // as candidates even if semantic similarity would rank them below the
  // shortlist — e.g. a theme tag like "Dark Fantasy" for a mechanics-heavy
  // description. We require the whole phrase (not a shared word like "based"
  // from "turn-based") so we don't drag in every "X-Based" tag.
  const forcedTagIds = new Set(
    allTagEmbeddings
      .filter(t => intentScore(t.tagName, descNorm, descTokens) >= 1)
      .map(t => t.tagId)
  );

  onProgress?.('Embedding description');
  // Embed once; both retrieval channels (tag centroids + game kNN) reuse it.
  // A caller that already has the embedding (the Node sanity harness) passes
  // it in and skips the worker.
  const queryEmbedding = input.queryEmbedding ?? await embed(input.description);
  const candidates = await findSimilarTags(
    input.description,
    allTagEmbeddings,
    TOP_K_CANDIDATES,
    forcedTagIds,
    queryEmbedding
  );
  onProgress?.('Candidate retrieval', `${candidates.length} candidates`);

  // The K-th candidate's similarity = this query's "relevance floor". A tag
  // below it wouldn't have been retrieved on merit — used by the avoid list.
  const retrievalCutoff = candidates[Math.min(TOP_K_CANDIDATES, candidates.length) - 1].similarity;

  // --- game-level kNN channel: nearest games vote for their tags, and become
  // the "similar games" output. Optional enrichment — any failure here leaves
  // the tag-centroid pipeline untouched.
  const neighborVote = new Map<number, number>();
  const neighborShare = new Map<number, number>(); // tag → share of neighbors carrying it
  let similarGames: SimilarGame[] = [];
  let neighborAppids: number[] = []; // for the exemplars: top performers near this query come first
  let neighborEvidenceAvailable = false;
  if (GAME_VECTOR_MODELS.has(modelKey)) {
    try {
      onProgress?.('Finding similar games');
      const gv = await getCachedGameVectors(modelKey, onProgress);
      const projected = projectQuery(gv, queryEmbedding);
      // A game that is itself in the index is its own nearest neighbor at
      // ~1.0 and would vote for exactly the tags under review (the tag audit)
      // or already on its page (analyzer with an App ID). Drop it, fetching
      // one extra so K stays K — mirrors exclude_appid in eval_models.py.
      const selfAppid = input.appid ?? input.excludeAppid;
      const want = selfAppid ? KNN_NEIGHBORS + 1 : KNN_NEIGHBORS;
      const neighbors = nearestGames(gv, projected, want)
        .filter(n => n.appid !== selfAppid)
        .slice(0, KNN_NEIGHBORS);
      const appids = neighbors.map(n => n.appid);
      neighborAppids = appids;
      const tagsByApp = getAppTagsForApps(appids);
      for (const n of neighbors) {
        const w = Math.max(0, n.similarity);
        for (const t of tagsByApp.get(n.appid) ?? []) {
          // identity tags (top of a neighbor's list) count more; rank-weighted,
          // no raw-success weighting so popular generic tags don't dominate.
          const rw = t.rank <= 3 ? 1.0 : t.rank <= 10 ? 0.5 : 0.2;
          neighborVote.set(t.tag_id, (neighborVote.get(t.tag_id) ?? 0) + w * rw);
          neighborShare.set(t.tag_id, (neighborShare.get(t.tag_id) ?? 0) + 1);
        }
      }
      if (neighbors.length > 0) {
        for (const [k, c] of neighborShare) neighborShare.set(k, c / neighbors.length);
      }
      let maxVote = 0;
      for (const v of neighborVote.values()) maxVote = Math.max(maxVote, v);
      if (maxVote > 0) for (const [k, v] of neighborVote) neighborVote.set(k, v / maxVote);

      const info = getGameInfoForApps(appids);
      similarGames = neighbors.slice(0, SIMILAR_GAMES_SHOWN).map(n => ({
        appid: n.appid,
        name: info.get(n.appid)?.name ?? `App ${n.appid}`,
        similarity: n.similarity,
        reviews: info.get(n.appid)?.reviews ?? 0,
      }));
      neighborEvidenceAvailable = neighbors.length > 0
        && neighbors.every(n => (tagsByApp.get(n.appid)?.length ?? 0) > 0);
    } catch (err) {
      // Never expose partially accumulated votes after a channel failure.
      neighborVote.clear();
      neighborShare.clear();
      similarGames = [];
      neighborAppids = [];
      console.warn('Game-kNN channel unavailable:', (err as Error).message);
    }
  }

  const tagEmbById = new Map(allTagEmbeddings.map(t => [t.tagId, t]));

  // Rescue strongly-voted identity tags the centroid retrieval missed (the
  // main point of the kNN channel — a specific multi-tag blend can sit far from
  // every single tag's centroid yet close to the games that share the blend).
  const candidateIds = new Set(candidates.map(c => c.tagId));
  if (neighborVote.size > 0) {
    let added = 0;
    for (const [tagId, vote] of [...neighborVote.entries()].sort((a, b) => b[1] - a[1])) {
      if (added >= KNN_EXPAND_MAX) break;
      if (vote < KNN_EXPAND_MIN || candidateIds.has(tagId)) continue;
      const te = tagEmbById.get(tagId);
      if (!te) continue;
      candidates.push({ tagId, tagName: te.tagName, similarity: cosineSimilarity(queryEmbedding, te.embedding) });
      candidateIds.add(tagId);
      added++;
    }
  }

  const candidateTagIds = candidates.map(c => c.tagId);
  const tagStatsMap = getTagStats(candidateTagIds);

  let segment: Segment | null = null;
  let segmentInferred = false;
  let tagScoresMap = new Map<number, TagScore>();

  const loadSegmentScores = (seg: Segment): Map<number, TagScore> => {
    const map = new Map<number, TagScore>();
    for (const ts of getTagScoresForSegment(seg.segment_id)) map.set(ts.tag_id, ts);
    return map;
  };

  if (input.mainTag) {
    const mainTagRecord = findTagByName(input.mainTag);
    if (mainTagRecord) {
      const seg = findSegment(mainTagRecord.tag_id, input.priceBucket);
      if (seg) {
        segment = seg;
        tagScoresMap = loadSegmentScores(seg);
        onProgress?.('Segment found', `${seg.main_tag_name} (${seg.game_count} games)`);
      }
    }
  }

  // When analyzing an existing game by App ID, capture its identity (name +
  // current tags) so we can pin its segment and badge tags it already uses.
  let analyzedApp: { appid: number; name: string } | null = null;
  let currentTagIds: number[] = [];
  let currentTagRanks: number[] = []; // parallel to currentTagIds: store-page rank
  if (input.appid) {
    const app = getAppById(input.appid);
    const appTags = getAppTags(input.appid);
    if (input.currentTagIds) {
      // Tags the caller fetched from Steam just now (a game the dataset lacks,
      // or a refresh of one it has): they describe the page as it is, so they
      // win over the dataset's snapshot. Store order, so index = rank.
      analyzedApp = { appid: input.appid, name: input.appName ?? app?.name ?? `App ${input.appid}` };
      currentTagIds = input.currentTagIds;
      currentTagRanks = input.currentTagIds.map((_, i) => i + 1);
    } else if (app) {
      // Game is in the local dataset.
      analyzedApp = { appid: app.appid, name: app.name };
      currentTagIds = appTags.map(t => t.tag_id);
      currentTagRanks = appTags.map(t => t.rank);
    }

    // Pin the segment to the page's leading tag (segment membership is a
    // top-5 tag, and the first tag is what players see first).
    if (!segment && currentTagIds.length > 0) {
      const seg = findSegment(currentTagIds[0], input.priceBucket);
      if (seg) {
        segment = seg;
        tagScoresMap = loadSegmentScores(seg);
        onProgress?.('Segment from app', seg.main_tag_name);
      }
    }
  }

  // Retrieval signals for the game's CURRENT tags. The analyzer ignores these;
  // the tag audit (audit.ts) classifies each existing tag from them. Computed
  // against the same embedding, neighbor votes and cutoff the recommendations
  // use, so "relevance" means the same thing on both pages.
  let currentTagSignals: CurrentTagSignal[] | undefined;
  if (currentTagIds.length > 0) {
    // Retired tags have no centroid (tagEmbById covers active tags only), so
    // their names come from the tags table and their similarity is 0.
    const nameById = new Map(getTagsByIds(currentTagIds).map(t => [t.tag_id, t.name]));
    // Similarity rank among all active tags: absolute cosines sit in a narrow
    // band for every tag, so "7th closest of 432" is the readable measure.
    const simRankById = new Map<number, number>();
    allTagEmbeddings
      .map(t => ({ tagId: t.tagId, sim: cosineSimilarity(queryEmbedding, t.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .forEach((t, idx) => simRankById.set(t.tagId, idx + 1));
    currentTagSignals = currentTagIds.map((tagId, i) => {
      const te = tagEmbById.get(tagId);
      const name = te?.tagName ?? nameById.get(tagId) ?? `Tag ${tagId}`;
      return {
        tagId,
        tag: name,
        rank: currentTagRanks[i],
        similarity: te ? cosineSimilarity(queryEmbedding, te.embedding) : 0,
        similarityRank: simRankById.get(tagId) ?? 0,
        neighborVote: neighborVote.get(tagId) ?? 0,
        neighborShare: neighborShare.get(tagId) ?? 0,
        intent: intentScore(name, descNorm, descTokens),
        active: !!te,
      };
    });
  }

  let competitorOverlapMap = new Map<number, number>();
  if (input.competitorAppids && input.competitorAppids.length > 0) {
    const competitorTags = getCompetitorTagOverlap(input.competitorAppids);
    const totalCompetitors = input.competitorAppids.length;
    for (const ct of competitorTags) {
      competitorOverlapMap.set(ct.tag_id, ct.overlap_count / totalCompetitors);
    }
    onProgress?.('Competitor analysis', `${competitorTags.length} tags from ${totalCompetitors} competitors`);
  }

  // Per-candidate inputs that don't depend on the chosen segment.
  const rawBase = candidates.map(c => ({
    tagId: c.tagId,
    tagName: c.tagName,
    similarity: c.similarity,
    stats: tagStatsMap.get(c.tagId),
    intent: intentScore(c.tagName, descNorm, descTokens),
    competitorOverlap: competitorOverlapMap.get(c.tagId) ?? 0,
    neighborVote: neighborVote.get(c.tagId) ?? 0,
  }));
  // Keep the boost only on the most specific stated tags (see
  // suppressSubsumedIntents): "Dark"/"Fantasy" yield to "Dark Fantasy", etc.
  const effIntents = suppressSubsumedIntents(rawBase);
  const base = rawBase.map((b, i) => ({ ...b, intent: effIntents[i] }));

  // Score every candidate against a segment's tag scores (an empty map gives a
  // segment-agnostic score). The ranker captures relevance/specificity/segment
  // fit; commercial lift and stated intent are applied as explicit bounded
  // factors, and the logistic keeps the result positive so they stay monotonic.
  const scoreAll = (scoresMap: Map<number, TagScore>) =>
    base.map(b => {
      const tagScore = scoresMap.get(b.tagId);
      const fv: FeatureVector = {
        embed_similarity: b.similarity,
        success_lift: tagScore?.success_lift ?? 1.0,
        confidence: tagScore?.confidence ?? 0.0,
        tag_frequency: tagScore?.tag_frequency ?? 0.0,
        tag_idf: b.stats?.idf ?? 0.0,
      };
      const rankerScore = predict(featureVectorToArray(fv));
      const shrunkLift = shrinkLift(fv.success_lift, fv.confidence);
      const finalScore =
        logistic(rankerScore) * liftFactor(shrunkLift)
        * (1 + INTENT_WEIGHT * b.intent)
        * (1 + KNN_WEIGHT * b.neighborVote)
        * (1 + COMPETITOR_WEIGHT * b.competitorOverlap);
      return { ...b, rankerScore, shrunkLift, finalScore, features: fv, tagScore };
    });

  // Order by composite score; ties break toward the more relevant and more
  // specific (higher IDF) tag so generic tags don't win ties.
  type Scored = ReturnType<typeof scoreAll>[number];
  const byScore = (a: Scored, b: Scored) => {
    const d = b.finalScore - a.finalScore;
    if (Math.abs(d) > 1e-6) return d;
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return b.features.tag_idf - a.features.tag_idf;
  };

  // No explicit main tag or appid: infer the segment from the top-RANKED tag
  // that anchors a segment, not merely the highest-cosine one. A quick
  // segment-agnostic scoring pass picks the anchor by relevance + specificity +
  // stated intent, which is more accurate and stable across embedding models
  // than raw cosine (which can land on a less precise segment). Without any
  // segment, every candidate gets a flat 1.0x lift and the ranker falls back to
  // a popularity prior that floats generic tags above specific relevant ones.
  if (!segment) {
    const prelim = scoreAll(new Map()).sort(byScore);
    for (const c of prelim) {
      const seg = findSegment(c.tagId, input.priceBucket);
      if (seg) {
        segment = seg;
        tagScoresMap = loadSegmentScores(seg);
        segmentInferred = true;
        onProgress?.('Segment inferred', `${seg.main_tag_name} (from description)`);
        break;
      }
    }
  }

  onProgress?.('Scoring candidates');

  const scored = scoreAll(tagScoresMap).sort(byScore);

  const primary: TagRecommendation[] = [];
  const secondary: TagRecommendation[] = [];
  const avoid: TagRecommendation[] = [];
  const exemplarWanted: number[] = [];

  for (const c of scored) {
    const explanation = generateExplanation(c, segment?.main_tag_name ?? 'overall');

    // Exemplars are filled in AFTER the partition, for displayed tags only:
    // fetching them per scored candidate (~109 queries) was 95% of the
    // analyzer's main-thread stall (1.4s measured cold).
    const rec: TagRecommendation = {
      tag: c.tagName,
      tagId: c.tagId,
      score: c.finalScore,
      relevance: c.similarity,
      successLift: c.features.success_lift,
      confidence: c.features.confidence,
      explanation,
      exemplarGames: [],
    };
    const hasScore = !!c.tagScore;

    // A tag the user (almost) fully spelled out is a stated identity tag:
    // give it a relevance floor so low semantic similarity can't bury it.
    // Partial word overlap (e.g. "based") doesn't qualify — it carries no
    // weight anywhere (see suppressSubsumedIntents).
    const intentMatched = c.intent >= INTENT_STATED;
    const relevance = intentMatched ? Math.max(c.similarity, 0.5) : c.similarity;

    if (relevance >= 0.5 && primary.length < 5) {
      primary.push(rec);
      if (hasScore) exemplarWanted.push(rec.tagId);
    } else if (relevance >= 0.3 && (secondary.length < 10 || intentMatched)) {
      // Intent-matched tags bypass the secondary cap: a tag the user explicitly
      // named must always be shown, even if its semantic similarity ranks it
      // past the normal cutoff.
      secondary.push(rec);
      if (hasScore) exemplarWanted.push(rec.tagId);
    }
  }

  // Examples under a tag are the games behind its lift — the segment's top
  // performers carrying it, the games behind the lift — never the game under
  // analysis, and nearest games first so the examples are also like this one.
  let exemplarBasis: ExemplarBasis | undefined;
  if (segment && exemplarWanted.length > 0) {
    const exemplars = getExemplarGamesForTags(segment.segment_id, exemplarWanted, 3, {
      excludeAppid: input.appid ?? input.excludeAppid,
      nearAppids: neighborAppids,
    });
    exemplarBasis = exemplars.basis;
    for (const rec of [...primary, ...secondary]) {
      rec.exemplarGames = exemplars.games.get(rec.tagId) ?? [];
    }
  }

  // --- Tags to avoid: the segment's commercially strongest tags that DON'T
  // fit this game (see AVOID_* constants for why they're sourced here and not
  // from the similarity candidates). Typical catches: Anime/Cute for a dark
  // fantasy deckbuilder, Multiplayer for a solo cozy pitch, Sexual Content in
  // Horror — high lift in the segment, nothing in this description to support it.
  if (segment) {
    const shown = new Set([...primary, ...secondary].map(r => r.tagId));
    const avoidCandidates: Array<{ ts: TagScore; shrunk: number; sim: number }> = [];
    for (const ts of tagScoresMap.values()) {
      const shrunk = shrinkLift(ts.success_lift, ts.confidence);
      if (shrunk < AVOID_MIN_SHRUNK_LIFT || ts.sample_size < AVOID_MIN_SAMPLE) continue;
      if (shown.has(ts.tag_id)) continue;
      if ((neighborVote.get(ts.tag_id) ?? 0) >= AVOID_MAX_NEIGHBOR_VOTE) continue;
      const te = tagEmbById.get(ts.tag_id);
      if (!te) continue; // inactive tag or no embedding
      const sim = cosineSimilarity(queryEmbedding, te.embedding);
      if (sim >= retrievalCutoff) continue; // relevant enough to be a candidate
      if (intentScore(te.tagName, descNorm, descTokens) >= INTENT_STATED) continue;
      avoidCandidates.push({ ts, shrunk, sim });
    }
    avoidCandidates.sort((a, b) => b.shrunk - a.shrunk);
    for (const { ts, sim } of avoidCandidates.slice(0, AVOID_LIMIT)) {
      avoid.push({
        tag: ts.tag_name,
        tagId: ts.tag_id,
        score: 0,
        relevance: sim,
        successLift: ts.success_lift,
        confidence: ts.confidence,
        // Observational: lift is association within the segment, not the
        // effect of adding the tag, and low similarity is absence of support,
        // not contradiction.
        explanation:
          `"${ts.tag_name}" appears ${ts.success_lift.toFixed(1)}x more often among top performers in the ` +
          `${segment.main_tag_name} segment, but nothing in your description supports it — ` +
          `confirm it fits before using it.`,
        exemplarGames: [],
      });
    }
  }

  onProgress?.('Complete');

  return {
    primaryTags: primary,
    secondaryTags: secondary,
    avoidTags: avoid,
    segment,
    segmentInferred,
    analyzedApp,
    currentTagIds,
    similarGames,
    exemplarBasis,
    neighborEvidenceAvailable,
    currentTagSignals,
    retrievalCutoff,
    rankedTagIds: scored.map(c => c.tagId),
  };
}

function generateExplanation(
  c: {
    tagName: string;
    similarity: number;
    intent: number;
    shrunkLift: number;
    features: FeatureVector;
    tagScore?: TagScore;
    competitorOverlap: number;
  },
  segmentName: string
): string {
  const parts: string[] = [];

  if (c.intent >= INTENT_STATED) {
    parts.push('a term you used to describe your game');
  }

  // Gate the lift claims on the confidence-shrunk value so we never advertise
  // a lift the sample size can't support; the displayed number stays the raw
  // (factually observed) lift.
  if (c.shrunkLift > 1.25) {
    parts.push(
      `appears ${c.features.success_lift.toFixed(1)}x more often among top-performing games in the ${segmentName} segment`
    );
  } else if (c.features.success_lift > 0 && c.shrunkLift < 0.7) {
    parts.push(
      `underrepresented among top performers in ${segmentName} (${c.features.success_lift.toFixed(1)}x lift)`
    );
  }

  if (c.tagScore && c.tagScore.top_frequency > 0.4) {
    parts.push(`used by ${(c.tagScore.top_frequency * 100).toFixed(0)}% of top games`);
  }

  if (c.competitorOverlap > 0.5) {
    parts.push(`shared by ${(c.competitorOverlap * 100).toFixed(0)}% of your competitors`);
  }

  if (c.similarity > 0.7) {
    parts.push('high semantic match to your description');
  }

  if (parts.length === 0) {
    return `Semantic match: ${(c.similarity * 100).toFixed(0)}%, ${c.features.success_lift.toFixed(1)}x lift.`;
  }

  return parts.join('. ') + '.';
}
