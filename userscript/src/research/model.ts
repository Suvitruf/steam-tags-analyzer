import { unpackGames, selectCohort, summarizeCohort, exposureExclusions, exposureMonths, quantile, DEFAULT_FILTER } from '../shared/research-core.js';
type ResearchGame = ReturnType<typeof unpackGames>[number];
export { unpackGames, summarizeCohort };
export function peerContext(game: ResearchGame, games: ResearchGame[], tag: number, ageMatched: boolean) {
  const months = exposureMonths(game);
  const filter = {...DEFAULT_FILTER,include:[tag],rank:5,
    gameType:game.price === null ? 'all' : game.price === 0 ? 'free' : 'paid',
    ageMin:ageMatched && months !== null ? Math.max(0,months-3) : null,
    ageMax:ageMatched && months !== null ? months+3 : null};
  const candidates = games.filter(g=>g.appid!==game.appid && g.year===game.year);
  const peers = selectCohort(candidates,filter), stats = summarizeCohort(peers);
  const known = peers.filter(g=>g.reviews!==null), below = known.filter(g=>g.reviews! < game.reviews!).length;
  const prices = peers.filter(g=>g.currency==='USD' && g.price!==null).map(g=>g.price!).sort((a,b)=>a-b);
  const tags = new Set(game.tags.filter(([,r])=>r!==null && r<=5).map(([id])=>id));
  const overlap = (g:ResearchGame)=>g.tags.filter(([id,r])=>r!==null && r<=5 && tags.has(id)).length;
  return {stats,months,exclusions:exposureExclusions(candidates,filter),below,
    percentile:game.reviews!==null && known.length>=30 ? below/known.length : null,
    equal:known.filter(g=>g.reviews===game.reviews).length,prices:prices.length,priceBand:[quantile(prices,.25),quantile(prices,.75)],
    peers:[...peers].sort((a,b)=>overlap(b)-overlap(a)||a.appid-b.appid).slice(0,5)};
}
export function niche(games: ResearchGame[], tag: number, age: string) {
  const [ageMin, ageMax] = age === 'all' ? [null, null] : age.split(':').map(Number);
  const filter = { ...DEFAULT_FILTER, include:[tag], rank:20, ageMin, ageMax };
  const selected = selectCohort(games, filter), stats = summarizeCohort(selected);
  const reviews = selected.flatMap(g => g.reviews === null ? [] : [g.reviews]).sort((a,b)=>b-a), total = reviews.reduce((a,b)=>a+b,0);
  const related = new Map<number,number>();
  for (const game of selected) for (const id of new Set(game.tags.filter(([,rank])=>rank!==null && rank<=5).map(([id])=>id))) if (id!==tag) related.set(id,(related.get(id)??0)+1);
  return { selected, stats, exclusions:exposureExclusions(games,filter), topFiveShare:total ? reviews.slice(0,5).reduce((a,b)=>a+b,0)/total : null,
    related:[...related].sort((a,b)=>b[1]-a[1]).slice(0,8) };
}
