import { publisherKey, publisherBucket, portfolioComposition } from '../shared/research-core.js';
import { unpackGames, summarizeCohort } from './model.ts';
import { el, select, action, table, stat, number, percent, gameLink, link } from './ui.js';

export function portfolioFile(manifest, name) {
  const keys=Object.keys(manifest.artifacts).filter(f=>/^publishers\/portfolios\/\d+\.json$/.test(f));
  if(!keys.length || keys.some((_,i)=>!manifest.artifacts[`publishers/portfolios/${i}.json`]))throw Error('Publisher portfolios are unavailable in this snapshot');
  const key=publisherKey(name);if(!key)throw Error('Enter a publisher name as credited on its games.');
  return `publishers/portfolios/${publisherBucket(key,keys.length)}.json`;
}
export async function publisherPanel(root,client,heading) {
  const [manifest,index]=await Promise.all([client.getManifest(),client.get('research-index.json')]);
  const controls=el('div',null,root,'controls'), label=el('label','Publisher credit',controls), input=el('input',null,label);input.type='text';input.value=heading;
  const tag=select(controls,'Portfolio niche',[['all','All tags'],...index.tags.map(t=>[t.id,t.name])],'all');
  el('p','Matches the publisher credit on games, ignoring only case and whitespace. A Steam creator page can have a different name; edit the credit if needed. Combined credits and subsidiaries are kept separate.',root,'note');
  const output=el('div',null,root);
  const render=async()=>{
    const key=publisherKey(input.value),games=unpackGames(await client.get(portfolioFile(manifest,input.value))).filter(g=>publisherKey(g.publisher)===key);
    const selected=games.filter(g=>tag.value==='all'||g.tags.some(([id,rank])=>id===+tag.value&&rank!==null&&rank<=5));
    const stats=summarizeCohort(selected), composition=portfolioComposition(games,5);
    output.replaceChildren();
    el('p',`${games.length} released games in this publisher’s observed catalog; ${selected.length} in the selected niche. Snapshot ${manifest.generatedAt.slice(0,10)}.`,output,'note');
    if(!games.length){el('p','No matching publisher credit in the snapshot. Check the name shown on an individual game’s Steam page.',output);return;}
    const cards=el('div',null,output,'stats');stat(cards,'Median reviews',number(stats.quantiles[1]));stat(cards,'Middle 50% reviews',`${number(stats.quantiles[0])}–${number(stats.quantiles[2])}`);
    const threshold=stats.thresholds.find(t=>t.threshold===250);stat(cards,'Games reaching 250 reviews',`${percent(threshold.rate)} (${threshold.hits}/${threshold.n})`);
    el('p',`${stats.missing} missing review observations. ${stats.observed<30?'Small sample: fewer than 30 observed games. ':''}These are lifetime observations across release ages, not a forecast or evidence of a publisher effect.`,output,'note');
    const years=new Map();for(const g of selected)years.set(g.year,(years.get(g.year)??0)+1);
    table(output,['Release year','Games'],[...years].sort((a,b)=>(b[0]??0)-(a[0]??0)));
    el('h3','Whole-portfolio top-five tags',output);
    table(output,['Tag','Games'],composition.tags.slice(0,10).map(t=>[index.tags.find(x=>x.id===t.id)?.name??`Tag ${t.id}`,`${t.count} / ${composition.tagged}`]));
    el('p',`${composition.unknown} catalog games without ranked tags. Tags overlap.`,output,'note');
    el('h3','Recent releases in the selection',output);
    const ordered=[...selected].sort((a,b)=>(b.date??String(b.year??'')).localeCompare(a.date??String(a.year??''))||a.appid-b.appid);
    const list=el('div',null,output);
    const show=limit=>{list.replaceChildren();table(list,['Game','Release','Reviews'],ordered.slice(0,limit).map(g=>[gameLink(g),g.date??g.year,number(g.reviews)]));};
    show(20);if(ordered.length>20)action(output,`Show all ${ordered.length} games`,async()=>show(ordered.length));
    link(output,'Open publisher research',`https://steam-tags-analyzer.apanasik.com/publishers/`);
  };
  action(root,'Look up portfolio',render);
  if(heading)await render();
}
