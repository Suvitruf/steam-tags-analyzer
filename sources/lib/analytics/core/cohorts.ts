import { matchesGameType, type GameType } from './game-type';
import { quantile, wilson } from './shared';
import { comparisonThresholds, DEFAULT_REVIEW_THRESHOLD } from './thresholds';

export interface ResearchGame {
  appid: number; name: string; year: number | null; date: string | null;
  reviews: number | null; positive: number | null; price: number | null; currency: string | null;
  developer: string | null; publisher: string | null; categories: string[] | null;
  tags: Array<[number, number | null]>; reviewsAt: string | null; detailsAt: string | null;
  detailsLoaded?: false;
  partyState?: 'unknown' | 'match' | 'different';
}
export type GameTuple = [number, string, number | null, string | null, number | null, number | null,
  number | null, string | null, number | null, number | null, number[] | null, number[], string | null, string | null];
export interface ResearchShard { parties: string[]; categories: string[]; games: GameTuple[] }
export interface CohortShard {
  format: 'cohort-v1'; year: number | null; categories: string[]; tags: number[];
  // Currency: unknown / USD / other. Parties: unknown / matching / different.
  games: Array<[number, number|null, number|null, number|null, number, number, number[]|null, Array<number|[number,number|null]>]>;
}
export interface ResearchIndex {
  tags: Array<{id: number; name: string}>;
  years: Array<{year: number | null; count: number; file: string; detailsFile?: string}>;
  defaultYear: number | null;
  appBuckets: number;
}
export function unpackGames(shard: ResearchShard | CohortShard): ResearchGame[] {
  if ('format' in shard) return shard.games.map(r=>({appid:r[0],name:`App ${r[0]}`,year:shard.year,date:null,
    reviews:r[1],positive:r[2],price:r[3],currency:r[4]===1?'USD':r[4]===2?'other':null,
    developer:null,publisher:null,partyState:(['unknown','match','different'] as const)[r[5]],
    categories:r[6]?.map(i=>shard.categories[i])??null,
    tags:r[7].map(t=>typeof t==='number'?[shard.tags[Math.floor(t/32)],t%32]:[shard.tags[t[0]],t[1]]),
    reviewsAt:null,detailsAt:null,detailsLoaded:false}));
  return shard.games.map(r => {
    const tags: ResearchGame['tags'] = [];
    for (let i=0;i<r[11].length;i+=2) tags.push([r[11][i],r[11][i+1] || null]);
    return { appid:r[0], name:r[1], year:r[2], date:r[3], reviews:r[4], positive:r[5], price:r[6], currency:r[7],
      developer:r[8] === null ? null : shard.parties[r[8]], publisher:r[9] === null ? null : shard.parties[r[9]],
      categories:r[10] === null ? null : r[10].map(i=>shard.categories[i]), tags, reviewsAt:r[12], detailsAt:r[13] };
  });
}
export interface CohortFilter {
  gameType?: GameType;
  include: number[]; exclude: number[]; mode: 'all' | 'any'; rank: number | null;
  price: 'all' | 'zero' | 'positive' | 'usd' | 'unknown'; rated: boolean;
  parties: 'all' | 'match' | 'different' | 'unknown'; features: string[];
}
export const DEFAULT_FILTER: CohortFilter = { include:[], exclude:[], mode:'all', rank:20, price:'all', rated:false, parties:'all', features:[] };

export function selectCohort(games: ResearchGame[], f: CohortFilter): ResearchGame[] {
  return games.filter(g => {
    if (!matchesGameType(g.price, f.gameType)) return false;
    if ((f.include.length || f.exclude.length) && !g.tags.length) return false;
    if (f.include.length || f.exclude.length) {
      const tags = new Set(g.tags.filter(([,r]) => f.rank === null || (r !== null && r <= f.rank)).map(([id])=>id));
      if (f.include.length && !(f.mode === 'all' ? f.include.every(id=>tags.has(id)) : f.include.some(id=>tags.has(id)))) return false;
      if (f.exclude.some(id=>tags.has(id))) return false;
    }
    if (f.rated && (g.reviews === null || g.reviews < 10)) return false;
    if (f.price === 'zero' && g.price !== 0) return false;
    if (f.price === 'positive' && (g.price === null || g.price <= 0)) return false;
    if (f.price === 'usd' && (g.price === null || g.price <= 0 || g.currency !== 'USD')) return false;
    if (f.price === 'unknown' && g.price !== null) return false;
    const parties = g.partyState ?? (!g.developer || !g.publisher ? 'unknown' : g.developer === g.publisher ? 'match' : 'different');
    if (f.parties !== 'all' && f.parties !== parties) return false;
    return f.features.every(feature => g.categories?.includes(feature));
  });
}

export function summarizeCohort(games: ResearchGame[],threshold=DEFAULT_REVIEW_THRESHOLD) {
  const reviews = games.flatMap(g => g.reviews === null ? [] : [g.reviews]).sort((a,b)=>a-b);
  const observed = reviews.length;
  const bins = Array.from({length:21},()=>0);
  for (const r of reviews) bins[Math.min(20,Math.floor(Math.log2(r+1)))]++;
  return { selected:games.length, observed, missing:games.length-observed, zeros:reviews.filter(r=>r===0).length,
    quantiles: [0.25,0.5,0.75,0.9].map(p=>quantile(reviews,p)), bins,
    thresholds: comparisonThresholds(threshold).map(threshold => {
      const hits=reviews.filter(r=>r>=threshold).length;
      return { threshold, hits, n:observed, rate:observed ? hits/observed : null, interval:wilson(hits,observed) };
    }) };
}

/** Spreadsheet formula prefixes must remain text when opening an exported CSV. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
export function gamesCsv(games: ResearchGame[]): string {
  if (games.some(g=>g.detailsLoaded===false)) throw Error('Load game details before exporting CSV.');
  return [['appid','name','release_date','reviews','positive_ratio','observed_price_cents','currency','developer','publisher','reviews_observed_at'],
    ...games.map(g=>[g.appid,g.name,g.date,g.reviews,g.positive,g.price,g.currency,g.developer,g.publisher,g.reviewsAt])]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
}
