import { getReviewThreshold } from './review-threshold';
import { equalAgePanels } from './core/equal-age';
import type { ResearchGame } from './core/cohorts';
import type { LifecycleFile } from './core/lifecycle';
import { el, fmtPct } from './format';
import { tableTwin, columnChart, SERIES_1 } from './charts';
import { action, downloadCsv } from './research-ui';
import { csvCell } from './core/cohorts';
import { selectCohort } from './core/cohorts';
import { cohortControls } from './cohort-controls';
import { getResearchIndex, getResearchYears } from './research-data';
import { getLifecycleYears } from './lifecycle-data';

export async function initEqualAgeTrends(root:HTMLElement){
  try{
    const index=await getResearchIndex(),query=new URLSearchParams(location.search);
    if(!query.has('from')&&!query.has('year')){
      const years=index.years.flatMap(y=>y.year!==null&&y.year<=(index.defaultYear??0)?[y.year]:[]).sort((a,b)=>b-a).slice(0,3);
      if(years.length){query.set('from',String(years[years.length-1]));query.set('to',String(years[0]));}
    }
    el('p','analytics-intro',root).textContent='Compare release-year cohorts after the same number of complete months on sale. Choose a niche using the shared cohort filters.';
    const controls=cohortControls(root,index,query),host=el('div',undefined,root);let sequence=0;
    async function render(){
      const request=++sequence;controls.submit.disabled=true;host.textContent='Loading equal-age history coverage…';
      try{
        const state=controls.read(),[games,data]=await Promise.all([getResearchYears(index,state.from,state.to),getLifecycleYears(index,state.from,state.to)]);
        if(request!==sequence)return;host.replaceChildren();controls.publish(state);renderEqualAge(host,selectCohort(games,state.filter),data);
      }catch(e){if(request===sequence)host.textContent=`Equal-age outcomes unavailable: ${(e as Error).message}`;}
      finally{if(request===sequence)controls.submit.disabled=false;}
    }
    controls.form.addEventListener('submit',e=>{e.preventDefault();void render();});await render();
  }catch(e){root.textContent=`Equal-age outcomes unavailable: ${(e as Error).message}`;}
}

export function renderEqualAge(root:HTMLElement,games:ResearchGame[],data:LifecycleFile){
  el('h2',undefined,root).textContent='Equal-age outcomes by release year';
  el('p','viz-caption',root).textContent=`H3 and H6 count histogram reviews in the first three or six complete calendar months after the displayed release month. The partial release month is excluded. Eligibility is evaluated at ${data.asOf.slice(0,10)}. These counts differ from lifetime review summaries.`;
  const csv:unknown[][]=[['release_year','horizon','selected','eligible','coverage','suppression_reason','p25','median','p75','threshold','hits','rate','wilson_low','wilson_high','exclusions']];
  for(const h of [3,6] as const){
    const panels=equalAgePanels(games,data,h,getReviewThreshold()),section=el('section','viz-section',root);
    el('h3',undefined,section).textContent=`H${h} release-year panels`;
    const rows=panels.map(p=>{
      const s=p.summary,band=s.cumulative[h-1];
      for(const t of s.thresholds)csv.push([p.year,h,s.selected,s.n,p.coverage,p.reason,
        ...(p.comparable?band:[null,null,null]),t.threshold,p.comparable?t.hits:null,p.comparable?t.rate:null,
        p.comparable?t.interval?.[0]:null,p.comparable?t.interval?.[1]:null,JSON.stringify(s.excluded)]);
      return [String(p.year??'Unknown'),s.selected,s.n,fmtPct(p.coverage),p.reason??'Coverage guard passed',
        ...(p.comparable?band.map(v=>v??'Unknown'):['Suppressed','Suppressed','Suppressed'])];
    });
    tableTwin(section,['Release year','Selected','Eligible','Coverage','Comparison status','P25 reviews','Median reviews','P75 reviews'],rows);
    const shown=panels.filter(p=>p.comparable);
    if(shown.length>=2)columnChart(section,{categories:shown.map(p=>String(p.year)),series:[{name:`Median H${h} reviews`,color:SERIES_1,values:shown.map(p=>p.summary.cumulative[h-1][1]!)}],height:230});
    else el('p','coverage-warning',section).textContent='A year-to-year chart requires at least two release years that pass the coverage guard.';
    tableTwin(section,['Release year','Threshold','Reached / eligible','Share','95% Wilson interval'],shown.flatMap(p=>p.summary.thresholds.map(t=>[
      String(p.year??'Unknown'),`${t.threshold}+ reviews`,`${t.hits} / ${t.n}`,fmtPct(t.rate!),`${fmtPct(t.interval![0])}–${fmtPct(t.interval![1])}`])));
    tableTwin(section,['Release year','First failing eligibility rule','Games'],panels.flatMap(p=>Object.entries(p.summary.excluded).map(([reason,n])=>[String(p.year??'Unknown'),reason,n])));
  }
  if(!games.length)el('p',undefined,root).textContent='No games match these cohort filters.';
  el('p','viz-caption',root).textContent='Comparison values require at least 30 eligible games and 50% coverage of the selected release-year cohort. This display guard does not establish representativeness. Collection historically favored games with ten or more reviews; reported outcomes describe only games with validated histories. Each horizon has its own fixed eligible panel. Current tags and store features are applied retrospectively, and current-year cohorts can be especially incomplete.';
  action(root,'Download equal-age comparisons CSV',()=>downloadCsv(csv.map(row=>row.map(csvCell).join(',')).join('\r\n'),'steam-equal-age.csv'));
  for(const d of root.querySelectorAll('details'))d.open=true;
}
