import { getResearchIndex, getResearchApps } from './research-data';
import { fetchAnalytics } from './snapshot';
import { el, fmtInt, fmtPct } from './format';
import { labeledInput, action, downloadGames } from './research-ui';
import { analyticsPath } from './coverage';
import type { ResearchGame } from './core/cohorts';

export async function initCompare(root: HTMLElement): Promise<void> {
  try {
    const index=await getResearchIndex();root.replaceChildren();
    el('p','analytics-intro',root).textContent='Compare up to eight released games you choose. Tag positions and declared store features help explain positioning; review counts describe observed reception and reach, not sales.';
    const form=el('form','research-controls',root);
    const input=labeledInput(form,'Steam App IDs or store URLs, comma separated',new URLSearchParams(location.search).get('apps')??'');
    const submit=el('button','research-button',form);submit.type='submit';submit.textContent='Compare games';
    const search=labeledInput(root,'Find a game by name');search.placeholder='Enter at least three characters';
    const results=el('div','research-search-results',root),error=el('p','coverage-warning',root);error.setAttribute('role','alert');
    const actions=el('div','analytics-controls',root),host=el('div','research-table-scroll',root);
    let games:ResearchGame[]=[],seq=0,searchSeq=0,names:Promise<{games:Array<[number,string]>}>|undefined;
    const csv=action(actions,'Download comparison CSV',()=>downloadGames(games,'steam-comparison.csv'));csv.disabled=true;
    action(actions,'Copy shareable link',()=>{if(navigator.clipboard)void navigator.clipboard.writeText(location.href).catch(()=>{error.textContent='Copy the URL from your address bar.';});else error.textContent='Copy the URL from your address bar.';});
    search.addEventListener('input',()=>{void (async()=>{
      const request=++searchSeq,q=search.value.trim().toLowerCase();results.replaceChildren();if(q.length<3)return;
      try {
        names??=fetchAnalytics<{games:Array<[number,string]>}>('research/search.json').catch(e=>{names=undefined;throw e;});
        const rows=(await names).games;if(request!==searchSeq)return;
        const matches=rows.filter(([,name])=>name.toLowerCase().includes(q));
        el('p',undefined,results).textContent=`${fmtInt(matches.length)} matches; showing up to 20.`;
        for(const [id,name] of matches.slice(0,20))action(results,`${name} (${id})`,()=>{
          input.value=[...new Set([...games.map(g=>g.appid),id])].join(',');void render();
        });
      }catch(e){if(request===searchSeq)error.textContent=`Search unavailable: ${(e as Error).message}`;}
    })();});
    async function render(){
      const request=++seq;submit.disabled=true;csv.disabled=true;error.textContent='';host.replaceChildren();
      try {
        const parts=input.value.split(',').map(v=>v.trim()).filter(Boolean);
        const ids=[...new Set(parts.map(v=>{
          const match=v.match(/^(?:https?:\/\/store\.steampowered\.com\/app\/)?(\d+)(?:\/[^\s]*)?$/);
          if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])<=0)throw new Error(`Invalid App ID or Steam URL: ${v}`);
          return Number(match[1]);
        }))];
        if(ids.length>8)throw new Error('Choose at most eight games for this comparison.');
        games=await getResearchApps(ids);if(request!==seq)return;
        const missing=ids.filter(id=>!games.some(g=>g.appid===id));
        if(missing.length)error.textContent=`Not in this released-game snapshot: ${missing.join(', ')}.`;
        history.replaceState(null,'',`${location.pathname}${ids.length?'?apps='+ids.join(','):''}`);
        if(!games.length){el('p',undefined,host).textContent='Add App IDs or search for games to begin.';return;}
        csv.disabled=false;
        const table=el('table','tag-table',host),head=el('tr',undefined,el('thead',undefined,table));el('th',undefined,head).textContent='Measure';
        for(const g of games){const th=el('th',undefined,head),link=el('a',undefined,th);link.href=`https://store.steampowered.com/app/${g.appid}/`;link.textContent=g.name;
          action(th,'Remove',()=>{input.value=games.filter(x=>x.appid!==g.appid).map(x=>x.appid).join(',');void render();});}
        const body=el('tbody',undefined,table);
        const row=(label:string,values:string[])=>{const tr=el('tr',undefined,body);el('th',undefined,tr).textContent=label;for(const v of values)el('td',undefined,tr).textContent=v;};
        row('Release date',games.map(g=>g.date??`${g.year??'Unknown'} (day unknown)`));
        row('Lifetime reviews',games.map(g=>g.reviews===null?'Unknown':fmtInt(g.reviews)));
        row('Positive review share',games.map(g=>g.positive===null?'Unknown':fmtPct(g.positive)));
        row('Observed price',games.map(g=>g.price===null?'Unknown':g.price===0?'Zero price':g.currency==='USD'?`$${(g.price/100).toFixed(2)}`:'Currency unknown or non-USD'));
        row('Developer',games.map(g=>g.developer??'Unknown'));row('Publisher',games.map(g=>g.publisher??'Unknown'));
        row('Review observation',games.map(g=>g.reviewsAt??'Unknown'));row('Details refresh attempt',games.map(g=>g.detailsAt??'Unknown'));
        const tagIds=[...new Set(games.flatMap(g=>g.tags.map(([id])=>id)))];
        tagIds.sort((a,b)=>Math.min(...games.map(g=>g.tags.find(([id])=>id===a)?.[1]??999))-Math.min(...games.map(g=>g.tags.find(([id])=>id===b)?.[1]??999)));
        for(const id of tagIds)row(`${index.tags.find(t=>t.id===id)?.name??id} — tag rank`,games.map(g=>{const tag=g.tags.find(([tid])=>tid===id);return tag?tag[1]===null?'Present, rank unknown':String(tag[1]):g.tags.length?'Not present':'Tags unknown';}));
        for(const feature of [...new Set(games.flatMap(g=>g.categories??[]))].sort())row(feature,games.map(g=>g.categories===null?'Unknown':g.categories.includes(feature)?'Declared':'Not declared'));
        el('p','viz-caption',host).textContent='Not declared does not prove a feature is absent. Store categories and tags can change. Prices are current observations, may include discounts, and are not launch prices. Details timestamps record refresh attempts. Manually selected peers are not an estimate of the market.';
        const link=el('a',undefined,host);link.href=analyticsPath('benchmarks');link.textContent='Explore a broader niche benchmark';
      }catch(e){if(request===seq){games=[];host.replaceChildren();error.textContent=(e as Error).message;}}
      finally{if(request===seq)submit.disabled=false;}
    }
    form.addEventListener('submit',e=>{e.preventDefault();void render();});await render();
  }catch(e){root.textContent=`Comparison unavailable: ${(e as Error).message}`;}
}
