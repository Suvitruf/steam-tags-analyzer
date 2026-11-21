/* Synced from extension/src/local-policy.js. Update with npm run sync:shared. */
export const WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-simd.wasm';
const CDN = 'https://projects.cdn.aapanasik.com/steam-tags/';
// Every request from the bundled compute worker is checked again by its host.
// No arbitrary URLs, redirects, credentials, headers or methods cross the bridge.
export function localRequestLimit(url, appid) {
  if (url === `https://steam-tags-api.aapanasik.com/app/${appid}?fresh=1`) return 2_000_000;
  if (url === WASM_URL) return 12_000_000;
  if (!url.startsWith(CDN)) throw new Error('Unexpected audit resource');
  const p = url.slice(CDN.length);
  if (p === 'inference/manifest.json') return 512_000;
  if (/^inference\/(snapshots|details|sets\/[a-zA-Z0-9_-]+)\/[a-f0-9]{64}\.gz$/.test(p)) return 64_000_000;
  if (/^data\/[a-zA-Z0-9_-]+\/(ranker-gte-base\.json|game-vectors-gte-base\.bin)$/.test(p)) return 32_000_000;
  if (/^models\/[a-zA-Z0-9_-]+\/steam-gte-base-onnx\/onnx\/model_quantized\.onnx$/.test(p)) return 128_000_000;
  if (/^models\/[a-zA-Z0-9_-]+\/steam-gte-base-onnx\/(config\.json|tokenizer\.json|tokenizer_config\.json|special_tokens_map\.json|vocab\.txt)$/.test(p)) return 4_000_000;
  throw new Error('Unexpected audit resource');
}
export function resourceLabel(url) {
  if (url.endsWith('.onnx')) return 'Loading model data';
  if (url.endsWith('.wasm')) return 'Downloading calculation runtime';
  if (url.includes('/app/')) return 'Fetching current Steam page';
  return 'Downloading game data';
}
