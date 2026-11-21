import { selectUpcoming } from '../shared/research-core.js';
import { el, select, action, table, gameLink, link } from './ui.js';

export function calendarWindow(month, length) {
  if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)||![1,3,6,12].includes(length))throw Error('Choose a valid starting month and window.');
  const [year,m]=month.split('-').map(Number);
  return {from:`${month}-01`,to:new Date(Date.UTC(year,m-1+length,1)).toISOString().slice(0,10)};
}
export function upcomingPeers(data,appid,tag,month,length,unknown) {
  const {from,to}=calendarWindow(month,length);
  return selectUpcoming(data.games,from,to,'all',tag,unknown).filter(g=>g.appid!==appid)
    .sort((a,b)=>(a.start??'9999').localeCompare(b.start??'9999')||a.appid-b.appid);
}
export async function upcomingPanel(root,client,appid) {
  const manifest=await client.getManifest(),ref=manifest.artifacts['upcoming.json'];
  if(!ref)throw Error('No release calendar in this snapshot');
  el('p',`Load the observed release calendar (${(ref.bytes/1e6).toFixed(1)} MB of JSON before transfer compression; cached after loading). No model is needed.`,root);
  const body=el('div',null,root);
  const load=async()=>{
    const data=await client.get('upcoming.json'),game=data.games.find(g=>g.appid===appid);
    body.replaceChildren();
    el('p',`${data.games.length} tracked coming-soon pages; ${data.unverified} unverified catalog entries excluded. Snapshot ${manifest.generatedAt.slice(0,10)}. This is an incomplete observed calendar; announced dates can change.`,body,'note');
    if(game)el('p',`This game: ${game.raw??'No announced date'} (${game.precision}); last observed ${game.observedAt.slice(0,10)}.`,body);
    else el('p','This game has no tracked calendar record yet. Select a tag and window manually.',body);
    const controls=el('div',null,body,'controls');
    const pageTagNames=[...document.querySelectorAll('.glance_tags a.app_tag[href]')].map(a=>a.textContent.trim().toLowerCase());
    const defaultTag=game?.tags[0]?.[0]??data.tags.find(t=>pageTagNames.includes(t.name.toLowerCase()))?.id??'';
    const tag=select(controls,'Shared tag',[['','Choose a tag'],...data.tags.map(t=>[t.id,t.name])],defaultTag);
    const label=el('label','From month',controls),month=el('input',null,label);month.type='month';month.value=(game?.start??data.asOf).slice(0,7);
    const horizon=select(controls,'Window',[['1','One month'],['3','Three months'],['6','Six months'],['12','Twelve months']],game?.precision==='quarter'?'3':game?.precision==='year'?'12':'1');
    const unknownLabel=el('label','Also show undated games',controls),unknown=el('input',null,unknownLabel);unknown.type='checkbox';
    const result=el('div',null,body);
    const render=()=>{
      if(!tag.value)throw Error('Choose a shared tag.');
      const matches=upcomingPeers(data,appid,+tag.value,month.value,+horizon.value,unknown.checked);
      result.replaceChildren();
      const dated=matches.filter(g=>g.start!==null&&g.end!==null),undated=matches.filter(g=>g.start===null||g.end===null);
      el('p',`${dated.length} known announcements overlap the window. ${undated.length} undated matches shown separately. The current game is excluded.`,result);
      const show=(title,games)=>{
        el('h3',title,result);
        table(result,['Game','Announcement','Precision','Last observed'],games.slice(0,50).map(g=>[gameLink(g),g.raw??'Unknown',g.precision,`${g.observedAt.slice(0,10)}${Date.parse(data.asOf)-Date.parse(g.observedAt)>30*86400000?' (over 30 days old)':''}`]));
        if(games.length>50)el('p',`Showing 50 of ${games.length}. Narrow the window or open the full calendar.`,result,'note');
      };
      show('Overlapping announced windows',dated);if(undated.length)show('Undated — not assigned to this window',undated);
      el('p','Quarter/year announcements match by overlap; they are not assigned an invented release month. Similarity here means a shared tag.',result,'note');
      const websiteMonths=Math.max(3,+horizon.value);
      link(result,`Open full calendar (${websiteMonths}-month window)`,`https://steam-tags-analyzer.apanasik.com/upcoming/?tag=${tag.value}&from=${month.value}&months=${websiteMonths}&undated=${unknown.checked?'1':'0'}`);
    };
    action(body,'Find upcoming peers',render);
    if(defaultTag)render();
  };
  action(root,'Load release calendar',load);
}
