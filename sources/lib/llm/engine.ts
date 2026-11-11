import { getModelConfig, DEFAULT_MODEL_KEY } from './models';

// The transformers.js pipeline lives in a dedicated worker (embed-worker.ts):
// session init (~1.5s) and each forward pass (~300ms on gte-base) are solid
// WASM compute that would otherwise freeze the UI. This module is a thin RPC
// shim that preserves the old loadEmbeddingModel/embed API.
let worker: Worker | null = null;
let currentModelKey = DEFAULT_MODEL_KEY;
let nextId = 1;
const pending = new Map<number, {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressCallback;
}>();

export type ProgressCallback = (progress: { status: string; progress?: number; file?: string }) => void;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./embed-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; type: string; payload?: any }>) => {
    const { id, type, payload } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (type === 'progress') {
      p.onProgress?.(payload);
    } else if (type === 'done') {
      pending.delete(id);
      p.resolve(payload);
    } else if (type === 'error') {
      pending.delete(id);
      p.reject(new Error(payload));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(`Embedding worker failed: ${e.message}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

function rpc<T>(type: 'load' | 'embed', payload: object, onProgress?: ProgressCallback): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, payload });
  });
}

export function getCurrentModelKey(): string {
  return currentModelKey;
}

export async function loadEmbeddingModel(modelKey: string, onProgress?: ProgressCallback, modelsBase?: string): Promise<void> {
  const cfg = getModelConfig(modelKey);
  await rpc('load', { modelKey: cfg.key, modelsBase }, onProgress);
  currentModelKey = cfg.key;
}

export async function embed(text: string): Promise<Float32Array> {
  return rpc<Float32Array>('embed', { text });
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export async function findSimilarTags(
  description: string,
  tagEmbeddings: Array<{ tagId: number; tagName: string; embedding: Float32Array }>,
  topK = 50,
  forceIncludeIds?: Set<number>,
  precomputedEmbedding?: Float32Array
): Promise<Array<{ tagId: number; tagName: string; similarity: number }>> {
  const descEmbedding = precomputedEmbedding ?? await embed(description);

  const scored = tagEmbeddings.map(t => ({
    tagId: t.tagId,
    tagName: t.tagName,
    similarity: cosineSimilarity(descEmbedding, t.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, topK);

  // Always keep explicitly-requested tags (e.g. ones the user named in their
  // description) even if their semantic similarity ranks them below topK —
  // otherwise the downstream intent boost can never surface them.
  if (forceIncludeIds && forceIncludeIds.size > 0) {
    const present = new Set(top.map(t => t.tagId));
    for (const s of scored) {
      if (forceIncludeIds.has(s.tagId) && !present.has(s.tagId)) {
        top.push(s);
        present.add(s.tagId);
      }
    }
  }

  return top;
}
