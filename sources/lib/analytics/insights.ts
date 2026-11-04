import { getGameType } from './game-type';
import { getReviewThreshold } from './review-threshold';
import { cohortControls } from './cohort-controls';
import { getResearchIndex, getResearchYears } from './research-data';
import { el, fmtInt, fmtPct } from './format';
import { action, downloadGames, labeledSelect, renderCohortSummary, renderExposureNote, renderGameTable } from './research-ui';
import { DEFAULT_FILTER, selectCohort, summarizeCohort, type ResearchGame } from './core/cohorts';
import { ACCESSIBILITY, CORE_FEATURES, PRICE_LABELS, comboGroups, featureComparison, outcome, pricing, concentration, groupByTag } from './core/insights';
import { columnChart, scatterChart, tableTwin, horizontalBars, SERIES_1, SERIES_2 } from './charts';
import { renderConcentration, renderReception } from './cohort-insights';
import { analyticsPath } from './coverage';

type View='map'|'features'|'prices'|'combos';
type Outcome=ReturnType<typeof outcome>;
const pct=(n:number|null)=>n===null?'Unknown':fmtPct(n,1);
const interval=(s:Outcome)=>s.interval?`${pct(s.interval[0])}–${pct(s.interval[1])}`:'Unknown';
const outcomeCells=(s:Outcome)=>[s.selected,s.n,s.hits,pct(s.rate),interval(s)];
function openTables(host:Element){for(const d of host.querySelectorAll('details'))d.open=true;}

export async function initInsights(root:HTMLElement,view:View):Promise<void>{
  const threshold=getReviewThreshold();
  if(view==='features'||view==='prices')return initFilteredInsights(root,view);
  try{
    const index=await getResearchIndex();root.replaceChildren();
    const query=new URLSearchParams(location.search);
    el('p','analytics-intro',root).textContent='Choose a release-year cohort, tag positions, and review-count population. Observed zero-review games are included by default. Outcomes are lifetime snapshots with different time on sale, not causal estimates or sales forecasts.';
    const controls=el('div','research-controls',root);
    const years=index.years.filter(y=>y.year!==null).map(y=>[String(y.year),`${y.year} (${fmtInt(y.count)})`] as [string,string]);
    const year=labeledSelect(controls,'Release year',years,years.some(([y])=>y===query.get('year'))?query.get('year')!:String(index.defaultYear));
    const tags:Array<[string,string]>=[['','All tags'],...index.tags.map(t=>[String(t.id),t.name] as [string,string])];
    const tag=labeledSelect(controls,view==='combos'?'First tag':'Tag',tags,tags.some(([id])=>id===query.get('tag'))?query.get('tag')!:'');
    const second=view==='combos'?labeledSelect(controls,'Second tag',tags,tags.some(([id])=>id===query.get('second'))?query.get('second')!:''):null;
    const rank=labeledSelect(controls,'Tag positions',[['5','Top five'],['20','Top twenty'],['any','Any stored rank']],['5','20','any'].includes(query.get('rank')??'')?query.get('rank')!:'20');
    const population=labeledSelect(controls,'Review-count population',[['all','All counts, including zero and unknown'],['rated','At least ten reviews']],query.get('population')==='rated'?'rated':'all');
    const actions=el('div','analytics-controls',root),status=el('p','coverage-warning',root),host=el('div',undefined,root);status.setAttribute('role','status');
    let selected:ResearchGame[]=[],sequence=0;
    const csv=action(actions,'Download selected cohort CSV',()=>downloadGames(selected,`steam-${view}.csv`));
    const benchmark=el('a',undefined,actions);benchmark.textContent='More filters in Niche Benchmarks';
    async function render(){
      const request=++sequence;csv.disabled=true;host.textContent='Loading cohort…';status.textContent='';
      const tagRank=rank.value==='any'?null:Number(rank.value);
      try{
        const all=await getResearchYears(index,Number(year.value),Number(year.value));if(request!==sequence)return;
        const base=selectCohort(all,{...DEFAULT_FILTER,gameType:getGameType(),rated:population.value==='rated'});
        selected=selectCohort(base,{...DEFAULT_FILTER,rank:tagRank,include:tag.value?[Number(tag.value)]:[]});
        host.replaceChildren();csv.disabled=false;
        const params=new URLSearchParams({gameType:getGameType(),year:year.value,tag:tag.value,rank:rank.value,population:population.value,threshold:String(threshold)});if(second)params.set('second',second.value);
        history.replaceState(null,'',`${location.pathname}?${params}`);
        benchmark.href=`${analyticsPath('benchmarks')}?gameType=${getGameType()}&from=${year.value}&to=${year.value}&include=${tag.value}${second?.value?','+second.value:''}&rank=${rank.value}&threshold=${threshold}${population.value==='rated'?'&rated=1':''}`;
        status.textContent=`${fmtInt(all.length)} released games in ${year.value}; ${fmtInt(base.length)} after the review-count rule; ${fmtInt(selected.length)} in the selected tag. Unknown-year games are outside this view.`;
        if(view==='map'){
          const grouped=groupByTag(base,tagRank);
          const rows=index.tags.map(t=>{const games=grouped.get(t.id)??[];return {...t,games,s:outcome(games,threshold),c:concentration(games)};}).filter(t=>t.games.length>0);
          el('h2',undefined,host).textContent=`Release supply and review outcomes — ${year.value}`;
          const shown=rows.filter(t=>t.s.n>=30);
          el('p','viz-caption',host).textContent=`Each point uses the same release year and population on both axes. ${shown.length} tags with at least 30 observed counts are plotted; ${rows.length-shown.length} smaller tags remain in the table. Tags overlap, so their counts do not sum to the market. Select a point or tag to inspect concentration.`;
          scatterChart(host,{points:shown.map(t=>({id:t.id,label:t.name,x:t.s.selected,y:t.s.rate!,size:t.s.n})),xLabel:'Releases in selected year',yLabel:`Share with ${threshold}+ reviews`,onSelect:id=>{tag.value=String(id);void render();}});
          tableTwin(host,['Tag','Released','Observed',`${threshold}+ reviews`,'Share','95% interval','Top game share','Effective contributors'],rows.sort((a,b)=>b.s.selected-a.s.selected).map(t=>[t.name,...outcomeCells(t.s),pct(t.c.top1),t.c.effective?.toFixed(1)??'Undefined']));
          renderConcentration(host,selected);renderReception(host,selected);
        }
        if(view==='combos'){
          if(!tag.value||!second?.value||tag.value===second.value){el('p',undefined,host).textContent='Choose two different tags to compare their overlap and exclusive groups.';csv.disabled=true;return;}
          const groups=comboGroups(base,Number(tag.value),Number(second.value),tagRank);selected=groups.both;
          const a=index.tags.find(t=>String(t.id)===tag.value)!.name,b=index.tags.find(t=>String(t.id)===second.value)!.name;
          el('h2',undefined,host).textContent=`${a} + ${b}`;
          el('p','viz-caption',host).textContent=`Jaccard overlap: ${pct(groups.jaccard)} (both / either tag). ${groups.unknown} games without stored tags are excluded from all tag groups. Inclusive parents contain the pair; exclusive groups below remove that overlap.`;
          const rows:Array<[string,ResearchGame[]]>=[['Both tags',groups.both],[`${a} without ${b}`,groups.onlyA],[`${b} without ${a}`,groups.onlyB],[`${a} including pair`,groups.a],[`${b} including pair`,groups.b]];
          tableTwin(host,['Group','Selected','Observed',`${threshold}+ reviews`,'Share','95% interval','Exact median reviews'],rows.map(([label,games])=>[label,...outcomeCells(outcome(games,threshold)),summarizeCohort(games).quantiles[1]??'Unknown']));
          const pair=outcome(groups.both,threshold),exclusive=outcome(groups.onlyA,threshold);
          el('p','viz-caption',host).textContent=pair.n<30||exclusive.n<30?'Either the pair or exclusive baseline has fewer than 30 observed games. No comparative difference is summarized.':`Pair minus ${a} without ${b}: ${((pair.rate!-exclusive.rate!)*100).toFixed(1)} percentage points reaching ${threshold} reviews. Descriptive association; the groups differ in more than tags.`;
          renderCohortSummary(host,groups.both,'Pair review distribution');renderConcentration(host,groups.both);renderGameTable(host,groups.both);
        }
        openTables(host);
      }catch(e){if(request===sequence){selected=[];csv.disabled=true;host.replaceChildren();status.textContent=`Unable to load cohort: ${(e as Error).message}`;}}
    }
    for(const input of [year,tag,second,rank,population])input?.addEventListener('change',()=>{void render();});await render();
  }catch(e){root.textContent=`Analytics unavailable: ${(e as Error).message}`;}
}

async function initFilteredInsights(root:HTMLElement,view:'features'|'prices'){
  try{
    const index=await getResearchIndex();root.replaceChildren();
    el('p','analytics-intro',root).textContent='Explore the same cohort across features, prices, benchmarks and lifecycle. Observed outcomes are descriptive associations; unknown observations stay distinct from zero.';
    const controls=cohortControls(root,index),actions=el('div','analytics-controls',root),status=el('p','coverage-warning',root),host=el('div',undefined,root);
    status.setAttribute('role','status');let selected:ResearchGame[]=[],sequence=0;
    const csv=action(actions,'Download selected cohort CSV',()=>downloadGames(selected,`steam-${view}.csv`));
    async function render(){
      const request=++sequence;csv.disabled=true;controls.submit.disabled=true;status.textContent='';host.textContent='Loading cohort…';
      try{
        const state=controls.read(),all=await getResearchYears(index,state.from,state.to);if(request!==sequence)return;
        selected=selectCohort(all,state.filter);host.replaceChildren();controls.publish(state);
        renderExposureNote(host,all,state.filter);
        status.textContent=`${fmtInt(selected.length)} selected games from ${state.from} through ${state.to}; ${fmtInt(all.length)} games before cohort filters. Unknown-year games are outside this view.`;
        if(view==='features')renderFeatures(host,selected);else renderPrices(host,selected);
        openTables(host);csv.disabled=false;
      }catch(e){if(request===sequence){selected=[];host.replaceChildren();status.textContent=(e as Error).message;}}
      finally{if(request===sequence)controls.submit.disabled=false;}
    }
    controls.form.addEventListener('submit',e=>{e.preventDefault();void render();});await render();
  }catch(e){root.textContent=`Analytics unavailable: ${(e as Error).message}`;}
}

function renderFeatures(host:Element,games:ResearchGame[]){
  const threshold=getReviewThreshold();
  const known=games.filter(g=>g.categories!==null);
  el('h2',undefined,host).textContent='Declared features and accessibility';
  el('p','viz-caption',host).textContent=`${fmtInt(known.length)} games have usable English category metadata; ${fmtInt(games.length-known.length)} unknown, localized, or invalid records are excluded. Not declared does not mean unsupported. Each prevalence denominator is all games with usable categories; outcome denominators additionally require an observed review count.`;
  const other=[...new Set(known.flatMap(g=>g.categories!))].filter(c=>!ACCESSIBILITY.includes(c)&&!CORE_FEATURES.includes(c)).sort();
  for(const [title,features] of [['Accessibility declarations',ACCESSIBILITY],['Controller, multiplayer and integration',CORE_FEATURES],['Other declarations',other]] as Array<[string,string[]]>){
    const section=el('section','research-table-scroll',host);el('h3',undefined,section).textContent=title;
    const rows=features.map(f=>({name:f,...featureComparison(games,f,threshold)}));
    tableTwin(section,['Declaration','Declared / known','Prevalence',`Declared: ${threshold}+ / observed`,'Rate (95% interval)',`Not declared: ${threshold}+ / observed`,'Rate (95% interval)','Difference (pp)'],rows.map(r=>[
      r.name,`${r.declared} / ${r.known}`,pct(r.prevalence),`${r.withFeature.hits} / ${r.withFeature.n}`,`${pct(r.withFeature.rate)} (${interval(r.withFeature)})`,`${r.withoutFeature.hits} / ${r.withoutFeature.n}`,`${pct(r.withoutFeature.rate)} (${interval(r.withoutFeature)})`,
      r.withFeature.n<30||r.withoutFeature.n<30?'Small sample':r.difference===null?'Unknown':(r.difference*100).toFixed(1),
    ]));
    if(title==='Accessibility declarations'&&known.length)horizontalBars(section,rows.map(r=>r.name),rows.map(r=>100*r.prevalence!),'Declared share of known metadata');
  }
  el('p','viz-caption',host).textContent='Store declarations reflect observation-time metadata. Features can be added after release. Differences are associations, not feature ROI; Trading Cards and similar commercial eligibility flags are especially subject to reverse causation. Group intervals do not estimate uncertainty of a causal difference.';
  renderReception(host,games);
}

function renderPrices(host:Element,games:ResearchGame[]){
  const threshold=getReviewThreshold();
  const p=pricing(games,threshold);el('h2',undefined,host).textContent='Observed price and review outcomes';
  el('p','viz-caption',host).textContent=`${p.clean} verified USD positive prices; ${p.unverified} positive prices with unknown or other currency; ${p.unknown.selected} unknown prices. Price levels below use verified USD only. Zero price is not verified free-to-play status. These are final prices at observation, possibly discounted, not launch prices.`;
  tableTwin(host,['Price state','Games','Observed reviews',`${threshold}+ reviews`,'Share','95% interval'],[['Zero price',...outcomeCells(p.zero)],['Positive price, any currency',...outcomeCells(p.positive)],['Price unknown',...outcomeCells(p.unknown)]]);
  if(!p.clean){el('p',undefined,host).textContent='No verified USD positive prices in this cohort.';return;}
  tableTwin(host,['P25 price','Median price','P75 price','P90 price'],[p.quantiles.map(q=>`$${(q!/100).toFixed(2)}`)]);
  columnChart(host,{categories:PRICE_LABELS,series:[{name:'Games with verified USD price',color:SERIES_1,values:p.buckets.map(b=>b.selected)},{name:`Reached ${threshold} reviews`,color:SERIES_2,values:p.buckets.map(b=>b.hits)}],height:240});
  tableTwin(host,['USD price','Games','Observed reviews',`${threshold}+ reviews`,'Share','95% interval'],p.buckets.map((b,i)=>[PRICE_LABELS[i],...outcomeCells(b)]));
  el('p','viz-caption',host).textContent='Exact price quantiles include all verified USD observations, even when reviews are unknown. Rates exclude unknown review counts. Small buckets have wide uncertainty; price and outcomes can share causes such as budget and genre. This view cannot estimate an optimal price or price elasticity. Review dates and details-attempt timestamps are available in Compare Games.';
  renderReception(host,games);
}
