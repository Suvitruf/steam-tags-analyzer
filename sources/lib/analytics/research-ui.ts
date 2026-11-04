import { getReviewThreshold } from './review-threshold';
import { el, fmtInt, fmtPct, histBucketLabel } from './format';
import { columnChart, tableTwin, SERIES_1 } from './charts';
import { analyticsPath } from './coverage';
import { gamesCsv, summarizeCohort, type ResearchGame, ageFilterActive, exposureExclusions, type CohortFilter } from './core/cohorts';
import { hydrateGames } from './research-data';

export async function downloadGames(games: ResearchGame[], name: string): Promise<void> {
  downloadCsv(gamesCsv(await hydrateGames(games)),name);
}
export function downloadCsv(csv:string,name:string):void{
  const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
  const link=el('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function labeledInput(parent: Element, title: string, value='', type='text'): HTMLInputElement {
  const label=el('label','research-field',parent);el('span',undefined,label).textContent=title;
  const input=el('input',undefined,label);input.type=type;input.value=value;return input;
}
export function labeledSelect(parent: Element, title: string, values: Array<[string,string]>, value: string): HTMLSelectElement {
  const label=el('label','research-field',parent);el('span',undefined,label).textContent=title;
  const select=el('select',undefined,label);select.setAttribute('aria-label',title);
  for(const [key,name] of values){const option=el('option',undefined,select);option.value=key;option.textContent=name;}
  select.value=value;return select;
}
export function action(parent: Element, title: string, onClick:()=>void|Promise<void>): HTMLButtonElement {
  const button=el('button','research-button',parent);button.type='button';button.textContent=title;
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try {await onClick();} catch(e) {const error=el('p','coverage-warning',parent);error.setAttribute('role','alert');error.textContent=(e as Error).message;}
    finally {button.disabled=false;}
  });return button;
}
/** What the months-since-release window did to the cohort, so dropped games are never silent. */
export function exposureNoteText(loaded: ResearchGame[], filter: CohortFilter): string | null {
  if(!ageFilterActive(filter))return null;
  const x=exposureExclusions(loaded,filter);
  const window=filter.ageMin!==null&&filter.ageMax!==null?`${filter.ageMin}–${filter.ageMax} months`:filter.ageMin!==null?`at least ${filter.ageMin} months`:`at most ${filter.ageMax} months`;
  const dropped=([[x.outsideWindow,'outside the window'],[x.noReleaseDate,'without a day-precise release date'],[x.noObservation,'without an observed review count'],[x.unsupported,'from a data snapshot without release-day data']] as Array<[number,string]>)
    .filter(([n])=>n>0).map(([n,why])=>`${fmtInt(n)} ${why}`);
  return `Months since release: ${window}, measured from the exact release date to each game’s review observation. Kept ${fmtInt(x.kept)} of ${fmtInt(x.candidates)} games matching the other filters${dropped.length?`; dropped ${dropped.join(', ')}`:''}. Review counts remain lifetime totals at observation, so games at the two ends of the window still differ in time on sale.`;
}
export function renderExposureNote(parent: Element, loaded: ResearchGame[], filter: CohortFilter): void {
  const text=exposureNoteText(loaded,filter);
  if(text)el('p','research-counts',parent).textContent=text;
}

export function renderCohortSummary(parent: Element, games: ResearchGame[], title='Observed review outcomes', exposure?: {loaded: ResearchGame[]; filter: CohortFilter}): void {
  const stats=summarizeCohort(games,getReviewThreshold());
  el('h2',undefined,parent).textContent=title;
  if(exposure)renderExposureNote(parent,exposure.loaded,exposure.filter);
  el('p','research-counts',parent).textContent=`${fmtInt(stats.selected)} selected games; ${fmtInt(stats.observed)} observed review counts, including ${fmtInt(stats.zeros)} zeros; ${fmtInt(stats.missing)} unknown counts excluded from outcomes.`;
  if(!stats.observed){el('p',undefined,parent).textContent='No observed outcomes for this selection. Broaden the filters or choose another year.';return;}
  const tiles=el('div','stat-row',parent);
  for(const [i,label] of ['P25','Median','P75','P90'].entries()) {
    const tile=el('div','stat-tile',tiles);el('div','stat-value',tile).textContent=fmtInt(Math.round(stats.quantiles[i]!));el('div','stat-label',tile).textContent=`${label} reviews`;
  }
  tableTwin(parent,['Threshold','Reached','Observed games','Share','95% Wilson interval'],stats.thresholds.map(t=>[
    `${t.threshold}+ reviews`,t.hits,t.n,fmtPct(t.rate!),`${fmtPct(t.interval![0])}–${fmtPct(t.interval![1])}`,
  ]));
  el('p','viz-caption',parent).textContent='Lifetime outcomes at each game’s last observation. These games have different time on sale. Intervals do not account for missing data, selection bias, or predict your game’s outcome.';
  const used=stats.bins.reduce((last,n,i)=>n>0?i+1:last,1);
  columnChart(parent,{categories:stats.bins.slice(0,used).map((_,i)=>i===20?'1,048,575+':histBucketLabel(i)),series:[{name:'Games',color:SERIES_1,values:stats.bins.slice(0,used)}],height:220});
  for(const details of parent.querySelectorAll('details')) details.open=true;
}
export function renderGameTable(parent: Element, games: ResearchGame[], limit=100): void {
  if(games.some(g=>g.detailsLoaded===false)){
    const load=el('div',undefined,parent);
    el('p','viz-caption',load).textContent='Game names, exact release dates and observation times load on request. Filters and statistics already include every selected game.';
    action(load,'Load names and store details',async()=>{
      const full=await hydrateGames(games);load.remove();wrap.remove();renderGameTable(parent,full,limit);
    });
  }
  const wrap=el('div','research-table-scroll',parent), table=el('table','tag-table',wrap);
  const head=el('tr',undefined,el('thead',undefined,table));
  for(const h of ['Game','Release','Reviews','Positive','Observed price','Review observation','Compare']) el('th',undefined,head).textContent=h;
  const body=el('tbody',undefined,table);
  for(const g of games.slice(0,limit)) {
    const row=el('tr',undefined,body),name=el('td',undefined,row),a=el('a',undefined,name);
    a.href=`https://store.steampowered.com/app/${g.appid}/`;a.textContent=g.name;a.rel='noopener';a.target='_blank';
    for(const value of [g.date ?? String(g.year ?? 'Unknown'),g.reviews===null?'Unknown':fmtInt(g.reviews),g.positive===null?'Unknown':fmtPct(g.positive),
      g.price===null?'Unknown':g.price===0?'Zero price':g.currency==='USD'?`$${(g.price/100).toFixed(2)}`:'Currency unknown or non-USD',g.detailsLoaded===false?'Load details':g.reviewsAt?.slice(0,10) ?? 'Unknown']) el('td',undefined,row).textContent=value;
    const compare=el('a',undefined,el('td',undefined,row));compare.href=`${analyticsPath('compare')}?apps=${g.appid}`;compare.textContent='Compare';
  }
  if(games.length>limit) el('p','viz-caption',parent).textContent=`Showing ${limit} of ${fmtInt(games.length)} games. CSV includes the full selected cohort.`;
}
