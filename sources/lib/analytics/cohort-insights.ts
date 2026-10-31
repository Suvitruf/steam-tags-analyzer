import { concentration, reception } from './core/insights';
import type { ResearchGame } from './core/cohorts';
import { el, fmtInt, fmtPct } from './format';
import { lineChart, columnChart, tableTwin, SERIES_1 } from './charts';
import { renderGameTable } from './research-ui';

export function renderConcentration(host:Element,games:ResearchGame[]):void{
  const c=concentration(games);el('h2',undefined,host).textContent='How concentrated is review activity?';
  el('p','viz-caption',host).textContent=`${fmtInt(c.n)} games with observed review counts; ${fmtInt(games.length-c.n)} unknown counts excluded. Shares describe lifetime reviews in this cohort.`;
  if(c.hhi===null){el('p',undefined,host).textContent='Concentration is undefined because this cohort has no observed reviews.';return;}
  tableTwin(host,['Top game share','Top five share','HHI','Effective contributors'],[[fmtPct(c.top1!),fmtPct(c.top5!),c.hhi.toFixed(4),c.effective!.toFixed(1)]]);
  lineChart(host,{categories:c.curve.map(([x])=>fmtPct(x)),values:c.curve.map(([,y])=>y*100),seriesName:'Cumulative review share — largest contributors first',valueFormat:v=>`${v.toFixed(1)}%`,height:210});
  el('p','viz-caption',host).textContent='Horizontal axis: cumulative share of games, largest contributors first. HHI is the sum of squared review shares; its reciprocal is the number of equally contributing games with the same concentration. It is not a customer count.';
  el('h3',undefined,host).textContent='Largest contributors to investigate';renderGameTable(host,c.leaders,5);
}
export function renderReception(host:Element,games:ResearchGame[]):void{
  const r=reception(games);el('h2',undefined,host).textContent='Reception across games';
  el('p','viz-caption',host).textContent=`Each game has equal weight. ${fmtInt(r.n)} games have at least ten reviews and a known positive ratio; ${fmtInt(games.length-r.n)} others excluded. No smoothing prior is applied.`;
  if(!r.n)return;
  tableTwin(host,['P25 positive','Median positive','P75 positive','P90 positive'],[r.quantiles.map(q=>fmtPct(q!))]);
  columnChart(host,{categories:r.bins.map((_,i)=>`${i*10}–${(i+1)*10}%${i<9?'*':''}`),series:[{name:'Games',color:SERIES_1,values:r.bins}],height:210});
  el('p','viz-caption',host).textContent='* Upper bin edge excluded, except the final bin which includes 100%. This is a distribution over games, not a pooled positive-review rate.';
}
