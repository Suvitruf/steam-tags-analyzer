// --- hosting config ---
// The big runtime artifacts (SQLite DB ~300MB, quantized ONNX models, ranker
// JSONs) are too large for the git repo / GitHub Pages, so they live in the
// R2 bucket behind this CDN domain (bucket "projects", prefix "steam-tags/").
// Local dev uses the same CDN copies — nothing big needs to exist locally.
//
// Layout (mirrors what scripts upload / the GitHub Action refreshes):
//   {ASSET_BASE}/steam-tags.db                       — browser database
//   {ASSET_BASE}/data/[{set id}/]ranker-{model}.json — LightGBM rankers
//   {ASSET_BASE}/data/[{set id}/]game-vectors-{model}.bin — kNN blobs
//   {ASSET_BASE}/models/[{set id}/]steam-{model}-onnx/... — transformers.js models
//     (transformers.js fetches config.json, tokenizer.json,
//      tokenizer_config.json and onnx/model_quantized.onnx per model)
export const ASSET_BASE = 'https://projects.cdn.aapanasik.com/steam-tags';

export const DB_URL = `${ASSET_BASE}/steam-tags.db`;

// A stamped set's files live under its set id on the CDN: the
// database names the set, so a browser that cached the previous encoder (the
// Cache API keys transformers.js downloads by URL) switches the moment the new
// database lands, and one set's files are never paired with another's tables.
// Unstamped (legacy) sets keep the flat paths.
const setDir = (setId: string | null) => (setId ? `${setId}/` : '');
export const rankerUrl = (modelKey: string, setId: string | null = null) =>
  `${ASSET_BASE}/data/${setDir(setId)}ranker-${modelKey}.json`;

// transformers.js env.localModelPath — must end with '/'.
export const MODELS_BASE = `${ASSET_BASE}/models/`;
export const modelsBase = (setId: string | null = null) => `${MODELS_BASE}${setDir(setId)}`;

// Precomputed analytics aggregates (see scripts export-analytics + the daily
// workflow): tags-summary.json, tags/{id}.json, combos.json, changelog.
export const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_BASE || `${ASSET_BASE}/analytics`;

// Game-vector kNN blob (the published game-vector format). Only built for models
// listed here; the analyzer skips the kNN channel for models without one.
export const GAME_VECTOR_MODELS = new Set(['gte-base', 'minilm', 'bge-small']);
export const gameVectorsUrl = (modelKey: string, setId: string | null = null) =>
  `${ASSET_BASE}/data/${setDir(setId)}game-vectors-${modelKey}.bin`;

// Cloudflare Worker base URL for live Steam lookups: App IDs
// the DB lacks, and the audit's "refresh from Steam". Build-time override via
// VITE_STEAM_PROXY_URL; the default is the deployed Worker on its custom
// domain. Empty disables live lookups (local-DB-only).
const DEFAULT_STEAM_PROXY_URL = 'https://steam-tags-api.aapanasik.com';
export const STEAM_PROXY_URL = String(import.meta.env.VITE_STEAM_PROXY_URL ?? DEFAULT_STEAM_PROXY_URL).replace(/\/+$/, '');
