// Shared loaders for the heavy runtime artifacts (DB, ranker, embedding
// model), memoized per model so the analyzer and the audit page — both in
// app.js — never fetch the same thing twice and switching models only reloads
// what changed. Everything is lazy: nothing downloads until first use.
import { loadDatabase } from './db/client';
import { loadRanker } from './scoring/ranker';
import { loadEmbeddingModel, type ProgressCallback } from './llm/engine';
import { DB_URL, rankerUrl } from './config';

let dbPromise: Promise<void> | null = null;
let rankerLoadedFor: string | null = null;
let embeddingLoadedFor: string | null = null;

export function ensureDatabase(): Promise<void> {
  if (!dbPromise) {
    dbPromise = loadDatabase(DB_URL).then(() => undefined);
    // Drop a failed load so the next call can retry instead of re-rejecting.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export async function ensureRanker(modelKey: string): Promise<void> {
  if (rankerLoadedFor === modelKey) return;
  await loadRanker(rankerUrl(modelKey));
  rankerLoadedFor = modelKey;
}

export async function ensureEmbeddingModel(modelKey: string, onProgress?: ProgressCallback): Promise<void> {
  if (embeddingLoadedFor === modelKey) return;
  await loadEmbeddingModel(modelKey, onProgress);
  embeddingLoadedFor = modelKey;
}
