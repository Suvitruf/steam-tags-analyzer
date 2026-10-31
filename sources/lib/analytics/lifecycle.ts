import { getReviewThreshold } from './review-threshold';
import { cohortControls } from './cohort-controls';
import { getLifecycleYears, selectedLifecycle } from './lifecycle-data';
import { getResearchIndex, getResearchYears, hydrateGames } from './research-data';
import { selectCohort, csvCell } from './core/cohorts';
import { summarizeLifecycle, lifecycleExclusion } from './core/lifecycle';
import { labeledSelect, action, downloadCsv, renderGameTable } from './research-ui';
import { el, fmtInt, fmtPct } from './format';
import { multiLineChart, tableTwin, SERIES_1, SERIES_2, SERIES_3 } from './charts';

const REASONS:Record<string,string>={
  'missing-release-date':'Displayed release date is partial or invalid',
  'missing-history':'No stored review history',
  'unvalidated-history':'Legacy history has no successful source validation',
  'weekly-source':'Weekly rollups cannot establish exact calendar months',
  'incomplete-source':'Source has gaps or unverified month coverage',
  'reviews-before-release':'Reviews precede the displayed release month',
  'not-old-enough':'Too young for the selected complete-month horizon',
  'incomplete-followup':'Requested follow-up months are missing or not yet confirmed complete',
};

export async function initLifecycle(root:HTMLElement):Promise<void>{
  try{
    const index=await getResearchIndex();root.replaceChildren();
    el('p','analytics-intro',root).textContent='Review activity during the first 3, 6, or 12 complete calendar months after the displayed release month. The partial release month is reported separately. These are histogram reviews, not day-30 sales, player retention, or the lifetime-review population.';
    const shared=cohortControls(root,index),query=shared.query,controls=el('div','research-controls',root);
    const horizon=labeledSelect(controls,'Complete months after release month',[['3','H3 — three months'],['6','H6 — six months'],['12','H12 — twelve months']],['3','6','12'].includes(query.get('horizon')??'')?query.get('horizon')!:'6');
    const mode=labeledSelect(controls,'Chart',[['monthly','Reviews per month'],['cumulative','Cumulative reviews after release month']],(query.get('chart')??query.get('mode'))==='cumulative'?'cumulative':'monthly');
    const actions=el('div','analytics-controls',root),status=el('p','coverage-warning',root),host=el('div',undefined,root);status.setAttribute('role','status');
    let exportCsv:()=>Promise<void>=async()=>{},sequence=0;
    const download=action(actions,'Download eligibility and monthly observations CSV',()=>exportCsv());
    async function render(){
      const request=++sequence;download.disabled=true;host.textContent='Validating the selected cohort…';status.textContent='';
      try{
        const state=shared.read();
        const [games,data]=await Promise.all([getResearchYears(index,state.from,state.to),getLifecycleYears(index,state.from,state.to)]);if(request!==sequence)return;
        const selected=selectCohort(games,state.filter),records=selectedLifecycle(selected,data),byId=new Map(records.map(r=>[r.appid,r]));
        const h=Number(horizon.value),summary=summarizeLifecycle(records,h,data.asOf,getReviewThreshold()),eligibleIds=new Set(summary.eligible.map(r=>r.appid));
        host.replaceChildren();shared.publish(state,{horizon:horizon.value,chart:mode.value});
        status.textContent=`${fmtInt(summary.n)} of ${fmtInt(selected.length)} selected games have validated H${h} observations. ${fmtInt(selected.length-summary.n)} excluded. Eligibility is evaluated at the snapshot date ${data.asOf.slice(0,10)}.`;
        el('h2',undefined,host).textContent='Coverage and release-anchor validation';
        tableTwin(host,['Eligibility','Games'],[['Eligible at every plotted month',summary.n],...Object.entries(summary.excluded).map(([reason,n])=>[REASONS[reason]??reason,n])]);
        el('p','viz-caption',host).textContent='Exclusions use the first failing rule, so counts sum to the selected cohort. Collection has historically focused on games with at least ten reviews. Results are conditional on validated history coverage and cannot estimate an unconditional launch success rate. Missing months are never filled with zero. A store date may describe a later launch such as leaving Early Access; pre-release review months invalidate that anchor, while differences within the same month remain undetectable.';
        const stamps=summary.eligible.flatMap(r=>r.observedAt?[r.observedAt]:[]).sort();
        if(stamps.length)el('p','viz-caption',host).textContent=`Successful history observations: ${stamps[0]} through ${stamps[stamps.length-1]}. Completed earlier horizons remain usable when later history is unavailable.`;
        if(summary.n){
          el('h2',undefined,host).textContent=`H${h} — ${mode.value==='cumulative'?'cumulative review activity':'monthly review activity'}`;
          const bands=mode.value==='cumulative'?summary.cumulative:summary.monthly;
          multiLineChart(host,{categories:bands.map((_,i)=>`M${i+1}`),series:[{name:'P25',color:SERIES_2,values:bands.map(b=>b[0]!)},{name:'Median',color:SERIES_1,values:bands.map(b=>b[1]!)},{name:'P75',color:SERIES_3,values:bands.map(b=>b[2]!)}],height:260});
          el('p','viz-caption',host).textContent=`The same ${summary.n} games contribute at every point. M1 is the first full calendar month after the displayed release month. Lines show empirical quartiles across games, not confidence intervals. Cumulative values exclude the partial release month.`;
          tableTwin(host,[`H${h} threshold`,'Reached','Eligible games','Share','95% Wilson interval'],summary.thresholds.map(t=>[`${t.threshold}+ histogram reviews`,t.hits,t.n,fmtPct(t.rate!),`${fmtPct(t.interval![0])}–${fmtPct(t.interval![1])}`]));
          el('h3',undefined,host).textContent='Eligible games';
          tableTwin(host,['App ID','Partial release month','Horizon reviews','First review month','Complete through'],summary.eligible.slice(0,100).map(r=>[r.appid,r.launch??'Unknown',r.months.slice(0,h).reduce<number>((sum,v)=>sum+v!,0),r.firstReviewMonth??'No positive counts',r.completeThrough??'Unknown']));
          renderGameTable(host,selected.filter(g=>eligibleIds.has(g.appid)));
          el('p','viz-caption',host).textContent='The game list shows lifetime review counts for context; these need not match histogram totals. The eligibility CSV includes all selected games, including exclusions, and all exported monthly observations.';
        }else el('p',undefined,host).textContent='No validated comparison curve is available for this selection. The coverage table explains the missing evidence. Fresh monthly source validation is collected by the regular history refresh.';
        const headers=['appid','name','anchor_status','horizon','eligible','exclusion_reason','release_month','first_review_month','complete_through','history_observed_at','partial_release_month',...Array.from({length:12},(_,i)=>`M${i+1}`)];
        exportCsv=async()=>{
          const full=await hydrateGames(selected);
          const csv=[headers,...full.map(g=>{const r=byId.get(g.appid)!;return[g.appid,g.name,r.status,h,eligibleIds.has(g.appid),lifecycleExclusion(r,h,data.asOf),r.releaseMonth,r.firstReviewMonth,r.completeThrough,r.observedAt,r.launch,...Array.from({length:12},(_,i)=>r.months[i]??null)];})].map(row=>row.map(csvCell).join(',')).join('\r\n');
          downloadCsv(csv,'steam-review-lifecycle.csv');
        };download.disabled=false;

        for(const d of host.querySelectorAll('details'))d.open=true;
      }catch(e){if(request===sequence){host.replaceChildren();status.textContent=`Lifecycle unavailable: ${(e as Error).message}`;}}
    }
    shared.form.addEventListener('submit',e=>{e.preventDefault();void render();});
    for(const input of [horizon,mode])input.addEventListener('change',()=>{void render();});await render();
  }catch(e){root.textContent=`Lifecycle unavailable: ${(e as Error).message}`;}
}
