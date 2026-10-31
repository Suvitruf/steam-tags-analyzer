// --- hosting config ---
// The big runtime artifacts (SQLite DB ~300MB, quantized ONNX models, ranker
// JSONs) are too large for the git repo / GitHub Pages, so they live in the
// R2 bucket behind this CDN domain (bucket "projects", prefix "steam-tags/").
// Local dev uses the same CDN copies — nothing big needs to exist locally.
//
// Layout (mirrors what scripts upload / the GitHub Action refreshes):
//   {ASSET_BASE}/steam-tags.db                       — browser database
//   {ASSET_BASE}/data/ranker-{model}.json            — LightGBM rankers
//   {ASSET_BASE}/models/steam-{model}-onnx/...       — transformers.js models
//     (transformers.js fetches config.json, tokenizer.json,
//      tokenizer_config.json and onnx/model_quantized.onnx per model)
export const ASSET_BASE = 'https://projects.cdn.aapanasik.com/steam-tags';

export const DB_URL = `${ASSET_BASE}/steam-tags.db`;

export const rankerUrl = (modelKey: string) => `${ASSET_BASE}/data/ranker-${modelKey}.json`;

// transformers.js env.localModelPath — must end with '/'.
export const MODELS_BASE = `${ASSET_BASE}/models/`;

// Precomputed analytics aggregates (see scripts export-analytics + the daily
// workflow): tags-summary.json, tags/{id}.json, combos.json, changelog.
export const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_BASE || `${ASSET_BASE}/analytics`;

// Game-vector kNN blob (the published game-vector format). Only built for models
// listed here; the analyzer skips the kNN channel for models without one.
export const GAME_VECTOR_MODELS = new Set(['gte-base', 'minilm', 'bge-small']);
export const gameVectorsUrl = (modelKey: string) => `${ASSET_BASE}/data/game-vectors-${modelKey}.bin`;

// Cloudflare Worker base URL for live App ID lookups (games not in the DB).
// Empty string disables live lookups (local-DB-only).
export const STEAM_PROXY_URL = '';   // e.g. 'https://steam-tags-proxy.<you>.workers.dev'
