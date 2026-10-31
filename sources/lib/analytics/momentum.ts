import { fetchAnalytics } from './snapshot';
import { el,fmtInt,fmtPct } from './format';
import { labeledInput,labeledSelect,action,downloadCsv } from './research-ui';
import { columnChart,tableTwin,SERIES_1,SERIES_2 } from './charts';
import { csvCell } from './core/cohorts';
import type { MomentumFile } from './core/discovery';

export async function initMomentum(root:HTMLElement):Promise<void>{
  try{
    const data=await fetchAnalytics<MomentumFile>('momentum.json');root.replaceChildren();
    el('p','analytics-intro',root).textContent=`Compare ${data.months[0]}–${data.months[2]} with ${data.months[3]}–${data.months[5]}. Both periods use the same games with six explicitly observed complete months and first review activity before this window.`;
    el('p','research-counts',root).textContent=`${fmtInt(data.all.panelGames)} eligible games / ${fmtInt(data.all.selected)} released games. ${fmtInt(data.all.entrants)} games have first observed review activity in the recent period; they are counted separately and excluded from growth.`;
    const reasons:Record<string,string>={'unvalidated-source':'No successful source validation','non-monthly-or-incomplete-source':'Weekly or incomplete monthly source','stale-source':'Source does not cover the latest complete month','first-activity-within-window':'First activity within the comparison window','missing-month':'One or more comparison months missing'};
    tableTwin(root,['Excluded from the fixed comparison','Games'],Object.entries(data.all.excluded).map(([reason,n])=>[reasons[reason]??reason,n]));
    el('p','viz-caption',root).textContent='Missing months, weekly sources and unvalidated histories are excluded, not filled with zeros. First observed review activity is not proof of a new release. The panel is selective and does not represent all Steam games. Current tags apply to both periods; tag shares overlap. Histogram reviews differ from lifetime review totals.';
    const query=new URLSearchParams(location.search),form=el('form','research-controls',root);
    const rank=labeledSelect(form,'Tag positions',[['5','Top five'],['20','Top twenty']],query.get('rank')==='5'?'5':'20');
    const minimum=labeledSelect(form,'Minimum eligible games',[['30','30 games'],['100','100 games'],['10','10 games'],['0','All sample sizes']],['0','10','30','100'].includes(query.get('min')??'')?query.get('min')!:'30');
    const sort=labeledSelect(form,'Sort momentum',[['delta','Added reviews'],['growth','Relative growth'],['breadth','Share of games growing']],['growth','breadth'].includes(query.get('sort')??'')?query.get('sort')!:'delta');
    const search=labeledInput(form,'Tag name contains',query.get('q')??'');
    const apply=el('button','research-button',form);apply.type='submit';apply.textContent='Apply momentum filters';
    let rows:MomentumFile['rankings'][number]['tags']=[],focus=query.get('focus')??'';
    action(root,'Download momentum CSV',()=>downloadCsv([
      ['tag','stored_games','eligible_games','previous_reviews','recent_reviews','added_reviews','growth_ratio','growing_games','growing_share','previous_panel_share','recent_panel_share','largest_appid','without_largest_previous','without_largest_recent','without_largest_added','without_largest_growth','recent_first_activity_games',...data.months],
      ...rows.map(r=>[r.name,r.stats.selected,r.stats.panelGames,r.stats.previous,r.stats.current,r.stats.delta,r.stats.growth,r.stats.growingGames,r.stats.growingShare,r.previousShare,r.currentShare,r.stats.leader?.appid,r.stats.withoutLargest.previous,r.stats.withoutLargest.current,r.stats.withoutLargest.delta,r.stats.withoutLargest.growth,r.stats.entrants,...r.stats.monthly]),
    ].map(row=>row.map(csvCell).join(',')).join('\r\n'),'steam-momentum.csv'));
    const host=el('section',undefined,root),growth=(n:number|null)=>n===null?'No positive baseline':fmtPct(n);
    const render=()=>{
      rows=(data.rankings.find(r=>r.rank===Number(rank.value))?.tags??[]).filter(r=>r.stats.panelGames>=Number(minimum.value)&&r.name.toLowerCase().includes(search.value.trim().toLowerCase()));
      const metric=(r:typeof rows[number])=>sort.value==='growth'?(r.stats.growth??-Infinity):sort.value==='breadth'?(r.stats.growingShare??-Infinity):r.stats.delta;
      rows.sort((a,b)=>metric(b)-metric(a)||a.name.localeCompare(b.name));
      if(!rows.some(r=>String(r.id)===focus))focus=String(rows[0]?.id??'');
      const share=()=>history.replaceState(null,'',`${location.pathname}?${new URLSearchParams({rank:rank.value,min:minimum.value,sort:sort.value,q:search.value.trim(),focus})}`);share();
      host.replaceChildren();el('h2',undefined,host).textContent='Growth breadth and concentration';
      el('p',undefined,host).textContent=`${fmtInt(rows.length)} matching tags. Growth percentages have no estimate when the previous period has zero reviews. Small samples are exploratory.`;
      if(!rows.length){el('p',undefined,host).textContent='No tags meet these filters. More validated monthly histories are needed, or choose a smaller sample threshold.';return;}
      columnChart(host,{categories:rows.slice(0,12).map(r=>r.name),series:[{name:'Previous three months',color:SERIES_1,values:rows.slice(0,12).map(r=>r.stats.previous)},{name:'Recent three months',color:SERIES_2,values:rows.slice(0,12).map(r=>r.stats.current)}],height:280});
      tableTwin(host,['Tag','Stored games','Eligible games','Previous reviews','Recent reviews','Growth','Games growing','Previous panel share','Recent panel share','Added without largest','Growth without largest','Recent first activity'],rows.slice(0,100).map(r=>[
        r.name,r.stats.selected,r.stats.panelGames,r.stats.previous,r.stats.current,growth(r.stats.growth),`${r.stats.growingGames} / ${r.stats.panelGames}`,r.previousShare===null?'Unknown':fmtPct(r.previousShare),r.currentShare===null?'Unknown':fmtPct(r.currentShare),r.stats.withoutLargest.delta,growth(r.stats.withoutLargest.growth),r.stats.entrants,
      ]));
      el('p','viz-caption',host).textContent='“Without largest” removes the game with the most recent-period reviews from BOTH periods. Read this alongside the share of games growing: a tag can gain reviews while most games decline. These observations do not forecast demand or prove a tag caused growth.';
      const trajectory=labeledSelect(host,'Monthly trajectory',rows.map(r=>[String(r.id),r.name]),focus),monthly=el('section',undefined,host);
      const draw=()=>{focus=trajectory.value;share();monthly.replaceChildren();const r=rows.find(r=>String(r.id)===focus)!;
        columnChart(monthly,{categories:data.months,series:[{name:`${r.name}: same ${r.stats.panelGames} games`,color:SERIES_1,values:r.stats.monthly}],height:220});
      };trajectory.addEventListener('change',draw);draw();
      el('h3',undefined,host).textContent='Largest contributors to inspect';
      const list=el('ul',undefined,host);
      for(const r of rows.slice(0,12))if(r.stats.leader){const item=el('li',undefined,list);item.append(`${r.name}: `);const link=el('a',undefined,item);link.href=`https://store.steampowered.com/app/${r.stats.leader.appid}/`;link.textContent=`${r.stats.leader.name} (${fmtInt(r.stats.leader.current)} recent reviews)`;}
      if(rows.length>100)el('p','viz-caption',host).textContent='Showing 100 tags; CSV includes all matching tags.';
      for(const d of host.querySelectorAll('details'))d.open=true;
    };
    form.addEventListener('submit',e=>{e.preventDefault();render();});render();
    for(const d of root.querySelectorAll('details'))d.open=true;
  }catch(e){root.textContent=`Momentum unavailable: ${(e as Error).message}. This page needs an export with validated monthly histories.`;}
}
