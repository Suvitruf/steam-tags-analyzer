import { loadApps, price } from './apps.js';
import { el, lazyPanel, table, number, percent, gameLink, action, link } from './ui.js';
import { createSelection } from './selection.js';
import { steamAppId } from '../shared/links.js';

export function comparison(gm, client) {
  const selection=createSelection(gm), controls=new Map();
  let refreshList;
  async function sync() {
    const ids=await selection.list();
    for(const [id,buttons] of controls)for(const b of buttons)b.textContent=ids.includes(id)?'Remove from comparison':'Add to comparison';
    await refreshList?.(ids);
  }
  function add(anchor,id) {
    if(anchor.dataset.staCompare)return;
    anchor.dataset.staCompare='true';
    const host=el('div');anchor.insertAdjacentElement('afterend',host);
    const root=host.attachShadow({mode:'open'});
    el('style',':host{display:block;margin:4px 0}button{background:#28485d;color:#dce8f1;border:1px solid #6d8b9e;border-radius:3px;padding:5px;cursor:pointer}span{color:#ddd;font:12px Arial}',root);
    const b=el('button','Add to comparison',root),status=el('span','',root);status.setAttribute('role','status');
    b.title=`Compare Steam App ${id}`;
    if(!controls.has(id))controls.set(id,[]);controls.get(id).push(b);
    b.addEventListener('click',async()=>{
      b.disabled=true;status.textContent='';
      try {await selection.set(id,!(await selection.list()).includes(id));await sync();}
      catch(e){status.textContent=e.message;}
      finally{b.disabled=false;}
    });
    selection.list().then(ids=>{if(ids.includes(id))b.textContent='Remove from comparison';}).catch(()=>{});
  }
  async function panel(root) {
    el('p','Choose up to 12 games using Add to comparison. Your selection is stored locally in the userscript manager.',root,'note');
    const chosen=el('div',null,root), output=el('div',null,root);
    let lastIds;
    refreshList=async ids=>{
      if(lastIds===ids.join(','))return;
      lastIds=ids.join(',');
      chosen.replaceChildren();output.replaceChildren();
      el('p',`${ids.length} games selected`,chosen);
      for(const id of ids) {
        const row=el('div',null,chosen);
        row.append(gameLink({appid:id,name:`App ${id}`}));
        action(row,`Remove ${id}`,async()=>{await selection.set(id,false);await sync();});
      }
    };
    action(root,'Compare selected games',async()=>{
      const ids=await selection.list();
      if(ids.length<2)throw Error('Select at least two games to compare.');
      const games=await loadApps(client,ids), index=await client.get('research-index.json'), manifest=await client.getManifest();
      output.replaceChildren();
      const missing=ids.filter(id=>!games.some(g=>g.appid===id));
      el('p',`Snapshot ${manifest.generatedAt.slice(0,10)}. ${missing.length?`Not in the released-game snapshot: ${missing.join(', ')}.`:''}`,output,'note');
      if(!games.length)return;
      table(output,['Game','Release','Reviews','Positive','Observed USD price','Publisher','Observation dates'],games.map(g=>[gameLink(g),g.date??g.year,number(g.reviews),percent(g.positive),price(g),g.publisher,`Reviews: ${g.reviewsAt?.slice(0,10)??'unknown'}; details: ${g.detailsAt?.slice(0,10)??'unknown'}`]));
      el('h3','Tag order (top 20)',output);
      const tags=[...new Set(games.flatMap(g=>g.tags.filter(([,r])=>r!==null&&r<=20).map(([id])=>id)))];
      table(output,['Tag',...games.map(g=>g.name)],tags.map(id=>[index.tags.find(t=>t.id===id)?.name??`Tag ${id}`,...games.map(g=>g.tags.find(([t])=>t===id)?.[1]??(g.tags.length?'—':'Unknown'))]));
      el('h3','Declared store features',output);
      const features=[...new Set(games.flatMap(g=>g.categories??[]))].sort();
      if(!features.length)el('p','No known store-feature lists in this selection.',output);
      else table(output,['Feature',...games.map(g=>g.name)],features.map(feature=>[feature,...games.map(g=>g.categories===null?'Unknown':g.categories.includes(feature)?'Yes':'—')]));
      el('p','Prices are observed USD snapshots and may include discounts. Review totals have different ages; this table does not rank performance.',output,'note');
      link(output,'Open comparison on Steam Tag Analyzer',`https://steam-tags-analyzer.apanasik.com/compare/?apps=${ids.join(',')}`);
    });
    await sync();
  }
  function attach(url) {
    const appid=steamAppId(url.href),search=/^\/search\/?$/.test(url.pathname);
    if(!appid&&!search)return;
    const anchor=appid?document.querySelector('.glance_tags_ctn, #game_highlights, #appHubAppName'):document.querySelector('.searchbar, #search_results, main');
    if(!anchor)return;
    lazyPanel(anchor,'steam-tag-research-compare','Steam Tag Analyzer · Compare games',panel);
    if(appid)add(anchor,appid);
    if(search)for(const row of document.querySelectorAll('a.search_result_row[href]')) {
      const id=steamAppId(row.href);if(id)add(row,id);
    }
  }
  window.addEventListener('focus',()=>sync().catch(()=>{}));
  return {attach};
}
