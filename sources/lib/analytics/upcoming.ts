import { fetchAnalytics } from './snapshot';
import { el,fmtInt } from './format';
import { labeledInput,labeledSelect,action,downloadCsv } from './research-ui';
import { columnChart,SERIES_1 } from './charts';
import { csvCell } from './core/cohorts';
import { selectUpcoming,upcomingMonths,type UpcomingFile,type UpcomingGame } from './core/discovery';

export async function initUpcoming(root:HTMLElement):Promise<void>{
  try{
    const data=await fetchAnalytics<UpcomingFile>('upcoming.json');root.replaceChildren();
    el('p','analytics-intro',root).textContent='Explore announced release windows for games still marked coming soon. Month, quarter and year announcements keep their original precision. Dates can change; these are observed plans, not confirmed launch dates.';
    el('p','research-counts',root).textContent=`${fmtInt(data.games.length)} verified coming-soon pages / ${fmtInt(data.catalogUnreleased)} unreleased catalog entries. ${fmtInt(data.unverified)} lack a tracked successful coming-soon observation and are excluded.`;
    const overdue=data.games.filter(g=>g.end!==null&&g.end<=data.asOf.slice(0,10)).length;
    const cutoff=new Date(Date.parse(data.asOf)-30*86400000).toISOString().slice(0,10),stale=data.games.filter(g=>g.observedAt.slice(0,10)<cutoff).length;
    el('p','viz-caption',root).textContent=`${fmtInt(stale)} coming-soon observations are over 30 days old. The last observed date is shown for each page.`;
    el('p','viz-caption',root).textContent=`As of ${data.asOf.slice(0,10)}, ${fmtInt(overdue)} announcements have passed their stated window while the page still says coming soon. Select an earlier month to inspect them. This calendar is not a complete Steam release schedule.`;
    const query=new URLSearchParams(location.search),form=el('form','research-controls',root);
    const month=labeledInput(form,'From month',/^\d{4}-(0[1-9]|1[0-2])$/.test(query.get('from')??'')?query.get('from')!:data.asOf.slice(0,7),'month');
    const horizon=labeledSelect(form,'Window',[['3','Three months'],['6','Six months'],['12','Twelve months']],['3','6','12'].includes(query.get('months')??'')?query.get('months')!:'6');
    const precision=labeledSelect(form,'Announcement precision',[['all','Any precision'],['day','Exact day'],['month','Month'],['quarter','Quarter'],['year','Year'],['unknown','Undated']],['day','month','quarter','year','unknown'].includes(query.get('precision')??'')?query.get('precision')!:'all');
    const tag=labeledSelect(form,'Any stored tag',[['all','All tags'],...data.tags.map(t=>[String(t.id),t.name] as [string,string])],data.tags.some(t=>String(t.id)===query.get('tag'))?query.get('tag')!:'all');
    const unknown=labeledInput(form,'Include undated announcements','','checkbox');unknown.checked=query.get('undated')!=='0';
    const apply=el('button','research-button',form);apply.type='submit';apply.textContent='Apply calendar filters';
    const error=el('p','coverage-warning',root);error.setAttribute('role','alert');
    let selected:UpcomingGame[]=[];
    action(root,'Download upcoming releases CSV',()=>downloadCsv([
      ['appid','name','announced_release','precision','window_start','window_end_exclusive','first_tracked','last_successful_observation','distinct_announcements'],
      ...selected.map(g=>[g.appid,g.name,g.raw,g.precision,g.start,g.end,g.firstObserved,g.observedAt,g.announcementVersions]),
    ].map(row=>row.map(csvCell).join(',')).join('\r\n'),'steam-upcoming.csv'));
    const host=el('section',undefined,root);
    const render=()=>{
      error.textContent='';host.replaceChildren();selected=[];
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)){error.textContent='Choose a valid starting month.';return;}
      const [year,m]=month.value.split('-').map(Number),from=`${month.value}-01`,to=new Date(Date.UTC(year,m-1+Number(horizon.value),1)).toISOString().slice(0,10);
      selected=selectUpcoming(data.games,from,to,precision.value,tag.value==='all'?null:Number(tag.value),unknown.checked).sort((a,b)=>(a.start??'9999').localeCompare(b.start??'9999')||a.name.localeCompare(b.name));
      const params=new URLSearchParams({from:month.value,months:horizon.value,precision:precision.value,tag:tag.value,undated:unknown.checked?'1':'0'});history.replaceState(null,'',`${location.pathname}?${params}`);
      el('h2',undefined,host).textContent='Announced release windows';
      const broad=selected.filter(g=>g.precision==='quarter'||g.precision==='year').length,undated=selected.filter(g=>g.precision==='unknown').length;
      el('p','research-counts',host).textContent=`${fmtInt(selected.length)} matching pages: ${fmtInt(broad)} broad windows and ${fmtInt(undated)} undated. Broad windows match when they overlap your selected months; undated pages are shown independently of the window.`;
      const buckets=upcomingMonths(selected);
      if(buckets.length)columnChart(host,{categories:buckets.map(b=>b.month),series:[{name:'Day or month announced',color:SERIES_1,values:buckets.map(b=>b.count)}],height:240});
      el('p','viz-caption',host).textContent='The chart counts only day/month announcements once. Quarter/year windows and undated games are listed below and never allocated to an invented launch month.';
      if(!selected.length){el('p',undefined,host).textContent='No tracked announcements match these filters. Coverage grows after successful details refreshes.';return;}
      const table=el('table','tag-table',el('div','research-table-scroll',host)),head=el('tr',undefined,el('thead',undefined,table));
      for(const h of ['Game','Announcement','Precision','Last observed','First tracked','Distinct announcements'])el('th',undefined,head).textContent=h;
      const body=el('tbody',undefined,table);
      for(const g of selected.slice(0,200)){
        const row=el('tr',undefined,body),link=el('a',undefined,el('td',undefined,row));link.href=`https://store.steampowered.com/app/${g.appid}/`;link.textContent=g.name;
        for(const value of [g.raw||'Unknown',g.precision,g.observedAt,g.firstObserved,String(g.announcementVersions)])el('td',undefined,row).textContent=value;
      }
      if(selected.length>200)el('p','viz-caption',host).textContent='Showing 200 pages; CSV includes every matching page.';
      for(const d of host.querySelectorAll('details'))d.open=true;
    };
    form.addEventListener('submit',e=>{e.preventDefault();render();});render();
  }catch(e){root.textContent=`Upcoming releases unavailable: ${(e as Error).message}. This page needs an export from the updated collector.`;}
}
