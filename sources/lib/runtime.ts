// Shared loaders for the heavy runtime artifacts (DB, ranker, embedding
// model), memoized per model so the analyzer and the audit page — both in
// app.js — never fetch the same thing twice and switching models only reloads
// what changed. Everything is lazy: nothing downloads until first use.
import { loadDatabase, type DatabaseLoadProgress } from './db/client';
import { loadRanker } from './scoring/ranker';
import { loadEmbeddingModel, embed, type ProgressCallback } from './llm/engine';
import { getCachedGameVectors } from './recommendation/engine';
import { verifyMatchedSet, currentSetId, type MatchedSetReport } from './matched-set';
import { DB_URL, rankerUrl, modelsBase, GAME_VECTOR_MODELS } from './config';
import type { ByteProgress } from './fetch-progress';
import type { GameVectors } from './llm/game-knn';

let dbPromise: Promise<void> | null = null;
let dbListeners: Set<DatabaseLoadProgress> | null = null;
let rankerLoadedFor: string | null = null;
let embeddingLoadedFor: string | null = null;

// Progress callbacks fire only while something actually loads: a memoized hit
// resolves silently, so callers can show a bar on the first event and never
// flash one for an instant no-op.
export function ensureDatabase(onProgress?: DatabaseLoadProgress): Promise<void> {
  if (!dbPromise) {
    // A listener set rather than a single callback: a second caller arriving
    // mid-download still gets the remaining events.
    const listeners = new Set<DatabaseLoadProgress>();
    dbListeners = listeners;
    dbPromise = loadDatabase(DB_URL, e => { for (const l of listeners) l(e); }).then(() => undefined);
    // Drop a failed load so the next call can retry instead of re-rejecting.
    dbPromise.catch(() => { dbPromise = null; });
    const settle = () => { if (dbListeners === listeners) dbListeners = null; };
    dbPromise.then(settle, settle);
  }
  if (onProgress) dbListeners?.add(onProgress);
  return dbPromise;
}

export async function ensureRanker(modelKey: string, onProgress?: ByteProgress): Promise<void> {
  if (rankerLoadedFor === modelKey) return;
  // The database (loaded first; both pages gate on it) names the set whose
  // files to fetch; an unstamped database resolves to the legacy flat paths.
  await loadRanker(rankerUrl(modelKey, currentSetId(modelKey)), onProgress);
  rankerLoadedFor = modelKey;
}

export async function ensureEmbeddingModel(modelKey: string, onProgress?: ProgressCallback): Promise<void> {
  if (embeddingLoadedFor === modelKey) return;
  await loadEmbeddingModel(modelKey, onProgress, modelsBase(currentSetId(modelKey)));
  embeddingLoadedFor = modelKey;
}

// Once per model, after the ranker and the encoder are loaded: do the served
// artifacts belong to the set the database's centroids were built with?
// Loads the game-vector blob early (the analysis would
// fetch it anyway); a blob that fails to load is simply not compared, as the
// engine then runs without that channel. Problems are logged here; the pages
// decide what to show.
const matchedSetCache = new Map<string, Promise<MatchedSetReport>>();

export function ensureMatchedSet(modelKey: string, onProgress?: ByteProgress): Promise<MatchedSetReport> {
  let p = matchedSetCache.get(modelKey);
  if (!p) {
    p = (async () => {
      let gameVectors: GameVectors | undefined;
      if (GAME_VECTOR_MODELS.has(modelKey)) {
        try {
          gameVectors = await getCachedGameVectors(modelKey, onProgress && ((_stage, _detail, bytes) => {
            if (bytes) onProgress(bytes.loaded, bytes.total);
          }));
        } catch (err) {
          console.warn('Game-vector blob unavailable for the matched-set check:', (err as Error).message);
        }
      }
      const report = await verifyMatchedSet(modelKey, { embed, gameVectors });
      for (const problem of report.problems) console.warn(`[matched set ${modelKey}] ${problem}`);
      return report;
    })();
    p.catch(() => matchedSetCache.delete(modelKey));
    matchedSetCache.set(modelKey, p);
  }
  return p;
}
