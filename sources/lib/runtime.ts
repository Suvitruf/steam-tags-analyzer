// Shared loaders for the heavy runtime artifacts (DB, ranker, embedding
// model), memoized per model so the analyzer and the audit page — both in
// app.js — never fetch the same thing twice and switching models only reloads
// what changed. Everything is lazy: nothing downloads until first use.
import { loadDatabase, type DatabaseLoadProgress } from './db/client';
import { loadRanker } from './scoring/ranker';
import { loadEmbeddingModel, type ProgressCallback } from './llm/engine';
import { DB_URL, rankerUrl } from './config';
import type { ByteProgress } from './fetch-progress';

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
  await loadRanker(rankerUrl(modelKey), onProgress);
  rankerLoadedFor = modelKey;
}

export async function ensureEmbeddingModel(modelKey: string, onProgress?: ProgressCallback): Promise<void> {
  if (embeddingLoadedFor === modelKey) return;
  await loadEmbeddingModel(modelKey, onProgress);
  embeddingLoadedFor = modelKey;
}
