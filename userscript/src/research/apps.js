import { unpackGames, peerContext } from './model.ts';
import { el, select, table, number, percent, action, gameLink, stat } from './ui.js';

export async function loadApps(client, ids) {
  const index = await client.get('research-index.json');
  if (!Number.isSafeInteger(index.appBuckets) || index.appBuckets < 1 || index.appBuckets > 1024) throw Error('Unsupported app buckets');
  const games = new Map();
  for (const bucket of new Set(ids.map(id=>id%index.appBuckets))) {
    for (const game of unpackGames(await client.get(`research/apps/${bucket}.json`))) games.set(game.appid,game);
  }
  return ids.flatMap(id=>games.has(id)?[games.get(id)]:[]);
}
export const price = game => game.price === null || game.currency !== 'USD' ? 'Unknown USD price' : `$${(game.price/100).toFixed(2)}`;
export async function appContext(root, client, appid) {
  const [game] = await loadApps(client,[appid]);
  if (!game) { el('p','This game is absent from the released-game research snapshot. Its tag audit remains available separately.',root); return; }
  const [index,manifest] = await Promise.all([client.get('research-index.json'),client.getManifest()]);
  el('h3',game.name,root);
  el('p',`Observed reviews: ${number(game.reviews)} (${game.reviewsAt?.slice(0,10)??'unknown date'}). Observed price: ${price(game)} (${game.detailsAt?.slice(0,10)??'unknown date'}).`,root);
  const top = game.tags.filter(([,rank])=>rank!==null && rank<=5);
  const year = index.years.find(y=>y.year!==null && y.year===game.year);
  if (!top.length || !year) { el('p','A known release year and ranked tags are required for a peer group.',root); return; }
  const controls = el('div',null,root,'controls');
  const tag = select(controls,'Shared top-five tag',top.map(([id])=>[id,index.tags.find(t=>t.id===id)?.name??`Tag ${id}`]),top[0][0]);
  const age = select(controls,'Peer age at observation',[['matched','Within three months'],['all','Any age']],'matched');
  const output = el('div',null,root);
  const render = async()=>{
    const result=peerContext(game,unpackGames(await client.get(year.file)),+tag.value,age.value==='matched');
    if (age.value==='matched' && result.months===null) {
      output.replaceChildren();el('p','The game’s age at review observation is unknown. Select Any age to compare without age matching.',output);return;
    }
    const examples=await loadApps(client,result.peers.map(g=>g.appid));
    output.replaceChildren();
    const kind=game.price===null?'all prices':game.price===0?'zero observed price':'positive observed price';
    el('p',`${result.stats.selected} other released games from ${game.year}, ${kind}, with the chosen tag in their top five. Snapshot ${manifest.generatedAt.slice(0,10)}.`,output,'note');
    if(age.value==='matched') el('p',`Age window: ${Math.max(0,result.months-3).toFixed(1)}–${(result.months+3).toFixed(1)} months; ${result.exclusions.candidates-result.exclusions.kept} games excluded by age or missing dates.`,output,'note');
    const cards=el('div',null,output,'stats');
    stat(cards,'Peer median reviews',number(result.stats.quantiles[1]));
    stat(cards,'Peers with fewer reviews',result.percentile===null?'Insufficient data':percent(result.percentile));
    stat(cards,'Peer middle 50% USD price',result.prices?result.priceBand.map(v=>`$${(v/100).toFixed(2)}`).join('–'):'Unknown');
    el('p',`${result.stats.observed} observed review counts; ${result.stats.missing} missing. ${result.equal} ties with this game. A percentile needs at least 30 observed peers and this game’s review count. Price range uses ${result.prices} verified USD prices, which may include discounts.`,output,'note');
    el('h3','Examples with the most shared top-five tags',output);
    table(output,['Game','Reviews','Observed USD price'],examples.map(g=>[gameLink(g),number(g.reviews),price(g)]));
    if(!examples.length)el('p','No games meet this selection. Try another tag or age window.',output);
  };
  action(root,'Update peer group',render);
  await render();
}
