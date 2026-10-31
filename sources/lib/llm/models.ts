// Browser-side mirror of the model metadata used by the offline pipeline. Keep key, pooling,
// and queryPrefix in sync with the Python registry — they must match exactly or
// the description (query) is embedded differently than the tag documents the
// model was trained/encoded with.

export interface EmbeddingModelConfig {
  key: string;
  label: string;
  /** transformers.js model path under env.localModelPath ('/models/'). */
  onnxPath: string;
  /** Token-embedding reduction; must match how the tag embeddings were encoded. */
  pooling: 'mean' | 'cls';
  /** Prepended to the query (description) only, never to tag documents. */
  queryPrefix: string;
  dim: number;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelConfig> = {
  minilm: {
    key: 'minilm',
    label: 'MiniLM-L6 (fine-tuned)',
    onnxPath: 'steam-minilm-onnx',
    pooling: 'mean',
    queryPrefix: '',
    dim: 384,
  },
  'bge-small': {
    key: 'bge-small',
    label: 'BGE-small-en v1.5',
    onnxPath: 'steam-bge-small-onnx',
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    dim: 384,
  },
  'gte-base': {
    key: 'gte-base',
    label: 'GTE-base',
    onnxPath: 'steam-gte-base-onnx',
    pooling: 'mean',
    queryPrefix: '',
    dim: 768,
  },
};

export const DEFAULT_MODEL_KEY = 'gte-base';

export function getModelConfig(key: string): EmbeddingModelConfig {
  return EMBEDDING_MODELS[key] ?? EMBEDDING_MODELS[DEFAULT_MODEL_KEY];
}

export function listModels(): EmbeddingModelConfig[] {
  return Object.values(EMBEDDING_MODELS);
}
