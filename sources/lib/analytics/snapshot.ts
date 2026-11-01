import { ANALYTICS_BASE } from '../config';
import { ANALYTICS_SCHEMA, type AnalyticsManifest } from './core/shared';

let manifestPromise: Promise<AnalyticsManifest | null> | null = null;
export function getManifest(): Promise<AnalyticsManifest | null> {
  if (!manifestPromise) manifestPromise = loadManifest().catch(err => { manifestPromise = null; throw err; });
  return manifestPromise;
}

async function loadManifest(): Promise<AnalyticsManifest | null> {
  const pinned = typeof document === 'undefined' ? undefined : document.querySelector<HTMLMetaElement>('meta[name="analytics-manifest"]')?.content;
  const response = await fetch(pinned || `${ANALYTICS_BASE}/manifest.json`, { cache: 'no-cache' });
  if (response.status === 404 && !pinned) return null; // Explicit legacy mode, disclosed in coverage.
  if (!response.ok) throw new Error(`Analytics manifest unavailable (${response.status})`);
  const data = await response.json() as AnalyticsManifest;
  if (data.schemaVersion !== ANALYTICS_SCHEMA || !/^releases\/[\w-]+$/.test(data.basePath)
      || !data.snapshotId || !data.coverage || !data.artifacts) throw new Error('Unsupported analytics manifest');
  return data;
}

export async function fetchAnalytics<T>(file: string): Promise<T> {
  const manifest = await getManifest();
  if (manifest && !manifest.artifacts[file]) throw new Error(`${file} is unavailable in this data snapshot`);
  const url = `${ANALYTICS_BASE}/${manifest ? `${manifest.basePath}/` : ''}${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Analytics data unavailable (${response.status})`);
  const data = await response.json();
  if (manifest && (data.snapshotId !== manifest.snapshotId || data.schemaVersion !== manifest.schemaVersion)) {
    throw new Error('Analytics snapshot mismatch. Reload to fetch a consistent release.');
  }
  return data as T;
}
