// Dedicated worker hosting the transformers.js embedding pipeline.
//
// A quantized gte-base forward pass is ~300ms of solid WASM compute and the
// one-time session init (compile + parsing the ~107MB model) is ~1.5s; on the
// main thread both freeze the UI and the progress text never paints. ort-web's
// own `wasm.proxy` option was tried first and silently fails to spawn its
// worker under Vite (measured: `page.workers()` stays empty, stalls unchanged),
// so the pipeline lives in this explicit module worker instead — init AND
// inference stay off the main thread, and everything remains self-hosted.
import { pipeline, env } from '@xenova/transformers';
import { getModelConfig, type EmbeddingModelConfig } from './models';
import { MODELS_BASE } from '../config';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODELS_BASE;

let embeddingPipeline: any = null;
let currentConfig: EmbeddingModelConfig | null = null;

interface RpcRequest {
  id: number;
  type: 'load' | 'embed';
  payload: { modelKey?: string; text?: string };
}

self.onmessage = async (e: MessageEvent<RpcRequest>) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'load') {
      const cfg = getModelConfig(payload.modelKey!);
      if (embeddingPipeline && currentConfig?.key === cfg.key) {
        self.postMessage({ id, type: 'done' });
        return;
      }
      // Switching models: drop the old pipeline so its session/memory is released.
      if (embeddingPipeline?.dispose) {
        try { await embeddingPipeline.dispose(); } catch { /* best effort */ }
      }
      embeddingPipeline = null;
      currentConfig = cfg;
      embeddingPipeline = await pipeline('feature-extraction', cfg.onnxPath, {
        quantized: true,
        progress_callback: (p: unknown) => self.postMessage({ id, type: 'progress', payload: p }),
      });
      self.postMessage({ id, type: 'done', payload: { modelKey: cfg.key } });
    } else if (type === 'embed') {
      if (!embeddingPipeline || !currentConfig) throw new Error('Embedding model not loaded');
      // The description is the query side, so it gets the model's query prefix
      // and is pooled the same way its tag embeddings were (mean or CLS).
      const result = await embeddingPipeline(currentConfig.queryPrefix + payload.text, {
        pooling: currentConfig.pooling,
        normalize: true,
      });
      const vec = new Float32Array(result.data);
      // Transfer the buffer instead of cloning it.
      (self as unknown as Worker).postMessage({ id, type: 'done', payload: vec }, [vec.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: String((err as Error)?.message ?? err) });
  }
};
