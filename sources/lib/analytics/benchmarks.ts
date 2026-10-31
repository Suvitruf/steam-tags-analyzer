import { getReviewThreshold } from './review-threshold';
import { cohortControls } from './cohort-controls';
import { getLifecycleYears } from './lifecycle-data';
import { renderEqualAge } from './equal-age';
import { getResearchIndex, getResearchYears, hydrateGames } from './research-data';
import { el, fmtInt } from './format';
import { labeledSelect, action, downloadGames, renderCohortSummary, renderGameTable } from './research-ui';
import { DEFAULT_FILTER, selectCohort, summarizeCohort, type ResearchGame, type CohortFilter } from './core/cohorts';
import { tableTwin } from './charts';
import { renderConcentration, renderReception } from './cohort-insights';

export async function initBenchmarks(root: HTMLElement): Promise<void> {
  try {
    const threshold=getReviewThreshold();
    const index=await getResearchIndex();root.replaceChildren();
    el('p','analytics-intro',root).textContent='Choose a comparison group of released games. Low-review and zero-review games are included by default. Each year loads separately; no model or full database is required.';
    const controls=cohortControls(root,index),{form,submit}=controls;
    const error=el('p','coverage-warning',root);error.setAttribute('role','alert');
    const actions=el('div','analytics-controls',root),host=el('div',undefined,root),comparison=el('div',undefined,root);
    let selected:ResearchGame[]=[],loaded:ResearchGame[]=[],current: CohortFilter=DEFAULT_FILTER,seq=0;
    let saved: ReturnType<typeof summarizeCohort>|null=null,savedUrl='';
    const csv=action(actions,'Download selected games CSV',()=>downloadGames(selected,'steam-benchmark.csv'));
    const copy=action(actions,'Copy shareable link',()=>{if(navigator.clipboard)void navigator.clipboard.writeText(location.href).then(()=>{copy.textContent='Link copied';}).catch(()=>{error.textContent='Copy the URL from your address bar to share these filters.';});else error.textContent='Copy the URL from your address bar to share these filters.';});
    const save=action(actions,'Save this cohort for comparison',()=>{saved=summarizeCohort(selected,threshold);savedUrl=location.href;renderComparison();});
    function renderComparison(){
      comparison.replaceChildren();if(!saved)return;
      const previous=saved;
      const now=summarizeCohort(selected,threshold);
      el('h2',undefined,comparison).textContent='Saved selection vs current selection';
      const savedLink=el('a',undefined,comparison);savedLink.href=savedUrl;savedLink.textContent='Open saved selection and its filters';
      tableTwin(comparison,['Metric','Saved selection','Current selection'],[
        ['Selected games',saved.selected,now.selected],['Observed review counts',saved.observed,now.observed],
        ['Median reviews',saved.quantiles[1] ?? 'Unknown',now.quantiles[1] ?? 'Unknown'],
        ...now.thresholds.map((t,i)=>[`${t.threshold}+ reviews`,`${previous.thresholds[i].hits} / ${previous.observed}`,`${t.hits} / ${now.observed}`]),
      ]);comparison.querySelector('details')!.open=true;
      el('p','viz-caption',comparison).textContent='Selections may overlap and may have different ages. This is a descriptive comparison, not an independent experiment.';
    }
    async function render(){
      const request=++seq;error.textContent='';submit.disabled=true;csv.disabled=true;save.disabled=true;selected=[];comparison.replaceChildren();
      try {
        const state=controls.read();current=state.filter;
        host.textContent='Loading selected release years…';
        loaded=await getResearchYears(index,state.from,state.to);if(request!==seq)return;
        selected=selectCohort(loaded,current);host.replaceChildren();
        csv.disabled=false;save.disabled=false;
        controls.publish(state);
        const equalAge=el('section','viz-section',host);equalAge.textContent='Loading equal-age history coverage…';
        void getLifecycleYears(index,state.from,state.to).then(data=>{
          if(request!==seq)return;equalAge.replaceChildren();renderEqualAge(equalAge,selected,data);
        }).catch(e=>{if(request===seq)equalAge.textContent=`Equal-age outcomes unavailable: ${(e as Error).message}`;});
        renderCohortSummary(host,selected);
        renderConcentration(host,selected);renderReception(host,selected);
        const variants=[['Current',current],['Top-five tags',{...current,rank:5}],['Any tag rank',{...current,rank:null}],['All review counts',{...current,rated:false}],['Ten reviews or more',{...current,rated:true}]] as Array<[string,CohortFilter]>;
        const sensitivity=el('section','viz-section',host);el('h2',undefined,sensitivity).textContent='Sensitivity to cohort rules';
        tableTwin(sensitivity,['Rule','Selected','Observed',`Reached ${threshold} reviews`],variants.map(([name,f])=>{const s=summarizeCohort(selectCohort(loaded,f),threshold);return[name,s.selected,s.observed,`${s.thresholds.find(t=>t.threshold===threshold)!.hits} / ${s.observed}`];}));
        el('h2',undefined,host).textContent='Games in this cohort';
        const sort=labeledSelect(host,'Game order',[['reviews','Review count, low to high'],['name','Name'],['highest','Review count, high to low']],'reviews');
        const games=el('div',undefined,host);
        const show=async()=>{try {
          if(sort.value==='name'){sort.disabled=true;const full=await hydrateGames(selected);if(request!==seq)return;selected=full;}
          games.replaceChildren();const rows=[...selected].sort((a,b)=>sort.value==='name'?a.name.localeCompare(b.name):sort.value==='highest'?(b.reviews??-1)-(a.reviews??-1):(a.reviews??-1)-(b.reviews??-1));renderGameTable(games,rows);
        }catch(err){error.textContent=(err as Error).message;}finally{sort.disabled=false;}};
        sort.addEventListener('change',()=>void show());void show();renderComparison();
      } catch(err){if(request===seq){host.replaceChildren();error.textContent=(err as Error).message;}}
      finally {if(request===seq)submit.disabled=false;}
    }
    form.addEventListener('submit',e=>{e.preventDefault();void render();});await render();
  } catch(err){root.textContent=`Benchmarks unavailable: ${(err as Error).message}`;}
}
