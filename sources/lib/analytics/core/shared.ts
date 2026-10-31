// Pure definitions used by both the exporter and browser. No database/runtime imports.
export const ANALYTICS_SCHEMA = 2;
export const THRESHOLDS = [50, 250, 1000] as const;

export interface ObservationRange {
  oldest: string | null;
  newest: string | null;
  missing: number;
  olderThan30Days: number;
}

export interface AnalyticsCoverage {
  released: number;
  observedReviews: number;
  missingReviews: number;
  zeroReviews: number;
  rated: number;
  tagged: number;
  exactDates: number;
  categoriesKnown: number;
  positivePrice: number;
  usdPrice: number;
  unknownPrice: number;
  sources: Record<string, ObservationRange>;
  collection?: {freeStatusKnown:number;categoryIdsKnown:number;priceBreakdownKnown:number;detailObservations:number;tagSnapshots:number};
  histograms: { games: number; eligible: number; pending: number; latestMonth: string | null;
    validatedMonthly?:number;weekly?:number;incomplete?:number;legacy?:number;successfulObservations?:ObservationRange } | null;
}

export interface AnalyticsManifest {
  schemaVersion: number;
  snapshotId: string;
  generatedAt: string;
  basePath: string;
  coverage: AnalyticsCoverage;
  artifacts: Record<string, { bytes: number; sha256: string }>;
}

export function quantile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function wilson(hits: number, n: number): [number, number] | null {
  if (n <= 0 || hits < 0 || hits > n) return null;
  const z = 1.959963984540054, p = hits / n, denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Empty/invalid metadata is unknown, not a known absence of every feature. */
export function categoriesOf(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string' && v.trim().length>0 && !v.startsWith('#') && !/[^\x00-\x7F]/.test(v))
      ? value : null;
  } catch { return null; }
}
