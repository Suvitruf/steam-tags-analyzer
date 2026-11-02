import { fetchPopulation } from './game-type';
import { fetchAnalytics } from './snapshot';

// Shapes mirror the analytics artifact schema output.

export interface TagSummary {
  id: number;
  name: string;
  count: number;
  rated: number;
  releases365: number;
  medianReviews: number;
  hitRates: { h50: number; h250: number; h1000: number };
  liftVsBaseline: { h50: number; h250: number; h1000: number };
  /** avg Bayesian-adjusted positive ratio over >=10-review games; null if none */
  love: number | null;
}

export interface TagsSummaryFile {
  generatedAt: string;
  gameCount: number;
  baseline: { h50: number; h250: number; h1000: number; love: number | null };
  tags: TagSummary[];
}

export interface RelatedTag {
  id: number;
  name: string;
  lift: number;
  confidence: number;
  n: number;
}

export interface TagDetail {
  id: number;
  name: string;
  count: number;
  rated: number;
  releases365: number;
  medianReviews: number;
  love: number | null;
  selfPub: { n: number; hits: number };
  published: { n: number; hits: number };
  histogram: number[]; // log2(reviews+1) buckets
  ranks: { buckets: string[]; all: number[]; hits250: number[] };
  related: RelatedTag[];
  topGames: Array<{ appid: number; name: string; reviews: number }>;
  byYear: Record<string, [number, number]>; // year -> [releases, hits250]
}

let summaryPromise: Promise<TagsSummaryFile> | null = null;

export function getTagsSummary(): Promise<TagsSummaryFile> {
  if (!summaryPromise) {
    summaryPromise = fetchPopulation<TagsSummaryFile>(`tags-summary.json`);
  }
  return summaryPromise;
}

export interface CombosFile {
  tags: Array<{ id: number; name: string }>;
  minGames: number;
  /** [tagIndexA, tagIndexB, games, hits250, approxMedianReviews] */
  pairs: Array<[number, number, number, number, number]>;
}

let combosPromise: Promise<CombosFile> | null = null;

export function getCombos(): Promise<CombosFile> {
  if (!combosPromise) {
    combosPromise = fetchPopulation<CombosFile>(`combos.json`);
  }
  return combosPromise;
}

export interface TrendTag {
  id: number;
  name: string;
  rel: number[];   // releases per year, aligned to TrendsFile.years
  hits: number[];  // 250+-review games per year
}

export interface TrendsFile {
  generatedAt: string;
  years: number[];
  baseline: { rel: number[]; hits: number[] }; // all-Steam per year
  tags: TrendTag[];
}

export interface TimingTag {
  id: number;
  name: string;
  rel: number[];   // releases per month (Jan..Dec), timing window
  hits: number[];  // 250+-review games per month
}

export interface TimingFile {
  generatedAt: string;
  years: [number, number]; // inclusive window of complete years
  all: { rel: number[]; hits: number[] };
  tags: TimingTag[];
}

let timingPromise: Promise<TimingFile> | null = null;

export function getTiming(): Promise<TimingFile> {
  if (!timingPromise) {
    timingPromise = fetchPopulation<TimingFile>(`timing.json`);
  }
  return timingPromise;
}

export interface TrendingContributor {
  appid: number;
  name: string;
  reviews: number;
  /** this game's share of the tag's latest-month reviews */
  share: number;
}

export interface TrendingTag {
  id: number;
  name: string;
  /** monthly reviews (up+down) across the tag's games, aligned to months */
  rev: number[];
  revLast: number;
  /** median monthly reviews over the trailing window */
  revBase: number;
  /** z-score of the tag's share of all-Steam reviews vs its trailing window */
  z: number;
  /** share vs trailing median, as a ratio change (0.5 = +50%); null if no base */
  chg: number | null;
  /** latest-month share of all-Steam reviews, in percent */
  share: number;
  /** distinct games contributing reviews in the latest month */
  games: number;
  pos: number | null;
  posBase: number | null;
  /** clears the sample floors, so it belongs in the ranked lists */
  rankable: boolean;
  top: TrendingContributor[];
}

export interface TrendingFile {
  generatedAt: string;
  /** "YYYY-MM", oldest first; the last entry is the latest COMPLETE month */
  months: string[];
  baseMonths: number;
  minReviews: number;
  minGames: number;
  coverage: { games: number; eligible: number; pending: number };
  all: number[];
  tags: TrendingTag[];
  rising: Array<{ appid: number; name: string; last: number; base: number; ratio: number }>;
  debuts: Array<{ appid: number; name: string; last: number }>;
}

export interface FeatureFlag {
  key: string;
  label: string;
  /** the raw Steam category strings grouped into this flag */
  categories: string[];
  /** true when the flag follows success rather than being chosen up front */
  outcome: boolean;
}

/** [gamesCarryingFlag, howManyOfThoseReachedTheThreshold] */
export type FeatureCell = [number, number];

export interface FeatureTag {
  id: number;
  name: string;
  rated: number;
  hits: number;
  flags: FeatureCell[];
}

export interface FeaturesFile {
  generatedAt: string;
  threshold: number;
  minN: number;
  flags: FeatureFlag[];
  all: { rated: number; hits: number; flags: FeatureCell[] };
  tags: FeatureTag[];
}

export interface TaxonomyChange {
  change_type: 'added' | 'removed' | 'renamed' | 'restored';
  tag_id: number;
  old_name: string | null;
  new_name: string | null;
  changed_at: string;
  /** new_name ?? old_name — the label to show */
  name: string;
}

export interface ChangelogFile {
  generatedAt: string;
  activeTags: number;
  retired: Array<{ tag_id: number; name: string; removed_at: string | null }>;
  changes: TaxonomyChange[];
}

/** [games, howManyReachedTheThreshold] */
export type PriceCell = [number, number];

export interface PriceSubject {
  free: PriceCell;
  paid: PriceCell;
  /** paid games whose currency is confirmed USD — the medians' sample */
  clean: number;
  /** cents; null when the clean sample is below minClean */
  median: number | null;
  medianHit: number | null;
  buckets: number[];
  bucketHits: number[];
}

export interface PriceTag extends PriceSubject {
  id: number;
  name: string;
}

export interface PricesFile {
  generatedAt: string;
  threshold: number;
  minClean: number;
  buckets: string[];
  coverage: { paid: number; currencyKnown: number };
  all: PriceSubject;
  tags: PriceTag[];
}

let pricesPromise: Promise<PricesFile> | null = null;

export function getPrices(): Promise<PricesFile> {
  if (!pricesPromise) {
    pricesPromise = fetchPopulation<PricesFile>(`prices.json`);
  }
  return pricesPromise;
}

let changelogPromise: Promise<ChangelogFile> | null = null;

export function getChangelog(): Promise<ChangelogFile> {
  if (!changelogPromise) {
    changelogPromise = fetchAnalytics<ChangelogFile>(`taxonomy-changelog.json`);
  }
  return changelogPromise;
}

let featuresPromise: Promise<FeaturesFile> | null = null;

export function getFeatures(): Promise<FeaturesFile> {
  if (!featuresPromise) {
    featuresPromise = fetchPopulation<FeaturesFile>(`features.json`);
  }
  return featuresPromise;
}

let trendingPromise: Promise<TrendingFile> | null = null;

export function getTrending(): Promise<TrendingFile> {
  if (!trendingPromise) {
    trendingPromise = fetchPopulation<TrendingFile>(`trending.json`);
  }
  return trendingPromise;
}

let trendsPromise: Promise<TrendsFile> | null = null;

export function getTrends(): Promise<TrendsFile> {
  if (!trendsPromise) {
    trendsPromise = fetchPopulation<TrendsFile>(`trends.json`);
  }
  return trendsPromise;
}

const detailCache = new Map<number, Promise<TagDetail>>();

export function getTagDetail(tagId: number): Promise<TagDetail> {
  let p = detailCache.get(tagId);
  if (!p) {
    p = fetchPopulation<TagDetail>(`tags/${tagId}.json`);
    detailCache.set(tagId, p);
  }
  return p;
}
