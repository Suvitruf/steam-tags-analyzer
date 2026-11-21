import { createGMFetch } from '../gm-adapters.js';

export const ANALYTICS_BASE = 'https://projects.cdn.aapanasik.com/steam-tags/analytics/';
const PREFIX = 'steam-tag-research:artifact:';
const MAX_FILE = 20_000_000, MAX_CACHE = 32_000_000;
export function analyticsLimit(url) {
  if (url === `${ANALYTICS_BASE}manifest.json`) return 2_000_000;
  if (url.startsWith(ANALYTICS_BASE) && /^releases\/[\w-]+\/(?:[\w-]+\/)*[\w-]+\.json$/.test(url.slice(ANALYTICS_BASE.length))) return MAX_FILE;
  throw new Error('Unexpected analytics URL');
}
export function createResearchClient(gm, request = createGMFetch(GM_xmlhttpRequest, 30000, analyticsLimit)) {
  let manifest, pruning = Promise.resolve();
  const pending = new Map();
  async function getManifest() {
    return manifest ??= (async () => {
      const response = await request(`${ANALYTICS_BASE}manifest.json`, { cache: 'no-cache' });
      if (!response.ok) throw Error(`Analytics unavailable (${response.status})`);
      const m = await response.json();
      if (m.schemaVersion !== 2 || !/^[\w-]+$/.test(m.snapshotId) || m.basePath !== `releases/${m.snapshotId}` || !m.artifacts || !Number.isFinite(Date.parse(m.generatedAt))) throw Error('Unsupported analytics snapshot');
      return m;
    })().catch(error => { manifest = undefined; throw error; });
  }
  async function verify(text, ref, m) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length !== ref.bytes) throw Error('Analytics size mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== ref.sha256) throw Error('Analytics checksum mismatch');
    const data = JSON.parse(text);
    if (data.snapshotId !== m.snapshotId || data.schemaVersion !== m.schemaVersion) throw Error('Analytics snapshot mismatch');
    return data;
  }
  async function store(key, text) {
    try {
      await gm.setValue(key, { text, at: Date.now() });
      pruning = pruning.then(async () => {
        const entries = [];
        for (const key of (await gm.listValues()).filter(k => k.startsWith(PREFIX))) {
          const value = await gm.getValue(key, null);
          entries.push({ key, at: value?.at ?? 0, bytes: typeof value?.text === 'string' ? new TextEncoder().encode(value.text).length : MAX_CACHE });
        }
        let bytes = 0;
        for (const entry of entries.sort((a,b) => b.at-a.at)) {
          bytes += entry.bytes;
          if (bytes > MAX_CACHE) await gm.deleteValue(entry.key);
        }
      }).catch(() => {});
      await pruning;
    } catch { /* Storage may be disabled; the verified response remains usable. */ }
  }
  async function get(file) {
    const m = await getManifest(), ref = m.artifacts[file];
    const url = `${ANALYTICS_BASE}${m.basePath}/${file}`;
    analyticsLimit(url);
    if (!ref || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw Error('This data is unavailable in the current snapshot');
    if (!pending.has(url)) pending.set(url, (async () => {
      const key = PREFIX + url;
      try {
        const cached = await gm.getValue(key, null);
        if (typeof cached?.text === 'string') return await verify(cached.text, ref, m);
      } catch { /* Invalid or unavailable cache: fetch a verified copy. */ }
      const response = await request(url);
      if (!response.ok) throw Error(`Analytics unavailable (${response.status})`);
      const text = await response.text(), data = await verify(text, ref, m);
      await store(key, text);
      return data;
    })().catch(error => { pending.delete(url); throw error; }));
    return pending.get(url);
  }
  return { get, getManifest };
}
