import { cohortControls } from './cohort-controls';
import { getResearchIndex, getResearchYears, getResearchShard } from './research-data';
import { fetchPopulation, populationPath } from './game-type';
import { el, fmtInt, fmtPct } from './format';
import { action, labeledInput, downloadGames, renderGameTable } from './research-ui';
import { tableTwin, horizontalBars } from './charts';
import { selectCohort, type ResearchGame } from './core/cohorts';
import type { CohortState } from './core/cohort-state';
import { publisherKey, publisherBucket, publishersInCohort, portfolioComposition, type PublisherIndex, type PublisherEntry } from './core/publishers';

export async function initPublishers(root:HTMLElement){
  try{
    const [index,directory]=await Promise.all([getResearchIndex(),fetchPopulation<PublisherIndex>('publisher-index.json')]);root.replaceChildren();
    el('p','analytics-intro',root).textContent='Find publishers with observed releases in your niche, then inspect relevant titles and their wider catalog. These are store-page publisher credits, including self-publishing and joint credits. Catalog overlap does not measure publisher effectiveness or current submission interests.';
    const controls=cohortControls(root,index),status=el('p','coverage-warning',root),search=labeledInput(root,'Find a publisher',''),list=el('div',undefined,root),portfolio=el('section','viz-section',root);
    status.setAttribute('role','status');search.type='search';
    let selected:ResearchGame[]=[],state:CohortState,cohort:ReturnType<typeof publishersInCohort>,sequence=0,detailSequence=0;
    let chosen=controls.query.get('publisher')??'';
    const names=new Map(index.tags.map(t=>[t.id,t.name]));
    function renderDirectory(){
      list.replaceChildren();if(!cohort)return;
      const query=search.value.trim().toLowerCase(),found=cohort.publishers.filter(p=>p.names.some(name=>name.toLowerCase().includes(query)));
      el('h2',undefined,list).textContent='Publishers in this niche';
      el('p','viz-caption',list).textContent=`${fmtInt(found.length)} matching publisher-name groups. Showing up to 100, ordered by the number of matching releases. ${fmtInt(cohort.unknown)} selected games have no usable publisher name. Search to narrow the list.`;
      const wrap=el('div','research-table-scroll',list),table=el('table','tag-table',wrap),head=el('tr',undefined,el('thead',undefined,table));
      for(const label of ['Publisher credit','Titles in this cohort','Observed catalog titles','Cohort / catalog'])el('th',undefined,head).textContent=label;
      const body=el('tbody',undefined,table);
      for(const entry of found.slice(0,100)){
        const row=el('tr',undefined,body);action(el('td',undefined,row),entry.names[0],()=>openPortfolio(entry));
        for(const value of [fmtInt(entry.matched),fmtInt(entry.apps.length),fmtPct(entry.matched/entry.apps.length)])el('td',undefined,row).textContent=value;
      }
      if(!found.length)el('p',undefined,list).textContent='No publisher credits match this search and cohort.';
    }
    async function openPortfolio(entry:PublisherEntry){
      const request=++detailSequence,cohortRequest=sequence;
      chosen=entry.key;controls.publish(state,{publisher:chosen});portfolio.textContent='Loading observed publisher catalog…';
      try{
        const rows=await getResearchShard(populationPath(`publishers/portfolios/${publisherBucket(entry.key,directory.buckets)}.json`));
        if(request!==detailSequence||cohortRequest!==sequence)return;
        const games=rows.filter(g=>publisherKey(g.publisher)===entry.key),expected=new Set(entry.apps);
        if(games.length!==expected.size||games.some(g=>!expected.has(g.appid)))throw Error('Publisher catalog is incomplete in this snapshot.');
        const ids=new Set(selected.map(g=>g.appid)),relevant=games.filter(g=>ids.has(g.appid));
        const year=new Date(directory.asOf).getUTCFullYear(),recent=games.filter(g=>g.year!==null&&g.year>=year-1&&g.year<=year&&(!g.date||g.date<=directory.asOf.slice(0,10)));
        portfolio.replaceChildren();el('h2',undefined,portfolio).textContent=`Observed catalog: ${entry.names[0]}`;
        el('p',undefined,portfolio).textContent=`${fmtInt(relevant.length)} titles match your cohort; ${fmtInt(games.length)} released titles across all observed years. ${fmtInt(recent.length)} releases in ${year-1}–${year}. ${fmtInt(games.filter(g=>g.year===null).length)} catalog titles have unknown release years. Snapshot: ${directory.asOf.slice(0,10)}.`;
        el('h3',undefined,portfolio).textContent='Raw publisher credits';
        const raw=el('ul',undefined,portfolio);for(const name of entry.names)el('li',undefined,raw).textContent=name;
        el('p','viz-caption',portfolio).textContent='Only case and whitespace are normalized for grouping. Joint credits remain intact; subsidiaries, name changes and acquisitions are not reconciled. The catalog contains released games observed by this project, not a verified complete company portfolio. Credits can change after launch.';
        const actions=el('div','analytics-controls',portfolio);
        action(actions,'Download relevant titles CSV',()=>downloadGames(relevant,'steam-publisher-niche.csv'));
        action(actions,'Download observed catalog CSV',()=>downloadGames(games,'steam-publisher-catalog.csv'));
        el('h3',undefined,portfolio).textContent='Relevant titles in your cohort';renderGameTable(portfolio,[...relevant].sort((a,b)=>(b.year??0)-(a.year??0)||a.name.localeCompare(b.name)));
        el('h3',undefined,portfolio).textContent=`Recent observed releases (${year-1}–${year})`;
        if(recent.length)renderGameTable(portfolio,[...recent].sort((a,b)=>(b.date??'').localeCompare(a.date??'')));
        else el('p',undefined,portfolio).textContent='No releases in this period are present in the observed catalog.';
        el('h3',undefined,portfolio).textContent='Catalog tag composition';
        const composition=portfolioComposition(games,state.filter.rank);
        el('p','viz-caption',portfolio).textContent=`Tag positions: ${state.filter.rank===null?'any stored rank':`top ${state.filter.rank}`}. ${composition.tagged} catalog games have tags in those positions; ${composition.unknown} do not. Shares use all ${games.length} observed catalog games; tags overlap and do not sum to 100%. Current tags may differ from launch tags.`;
        horizontalBars(portfolio,composition.tags.slice(0,12).map(t=>names.get(t.id)??String(t.id)),composition.tags.slice(0,12).map(t=>100*t.count/games.length),'Share of observed catalog');
        tableTwin(portfolio,['Tag','Catalog games','Share of catalog'],composition.tags.map(t=>[names.get(t.id)??String(t.id),t.count,fmtPct(t.count/games.length)]));
        const years=new Map<number|null,number>();for(const g of games)years.set(g.year,(years.get(g.year)??0)+1);
        tableTwin(portfolio,['Release year','Observed titles'],[...years].sort(([a],[b])=>(b??0)-(a??0)).map(([y,n])=>[String(y??'Unknown'),n]));
        for(const d of portfolio.querySelectorAll('details'))d.open=true;
      }catch(e){if(request===detailSequence&&cohortRequest===sequence)portfolio.textContent=`Publisher catalog unavailable: ${(e as Error).message}`;}
    }
    async function render(){
      const request=++sequence;++detailSequence;controls.submit.disabled=true;status.textContent='Loading cohort…';list.replaceChildren();portfolio.replaceChildren();
      try{
        const next=controls.read(),games=await getResearchYears(index,next.from,next.to);if(request!==sequence)return;
        state=next;selected=selectCohort(games,state.filter);cohort=publishersInCohort(directory,selected);
        status.textContent=`${fmtInt(selected.length)} selected games; ${fmtInt(cohort.publishers.length)} publisher-name groups. ${fmtInt(directory.unknown)} released catalog games have no usable publisher name overall.`;
        controls.publish(state,chosen?{publisher:chosen}:{});renderDirectory();
        const entry=cohort.publishers.find(p=>p.key===chosen);
        if(entry)await openPortfolio(entry);else if(chosen)el('p',undefined,portfolio).textContent='The publisher in this link has no titles in the current cohort. Choose another publisher or broaden the filters.';
      }catch(e){if(request===sequence){cohort={publishers:[],unknown:0};status.textContent=`Publishers unavailable: ${(e as Error).message}`;}}
      finally{if(request===sequence)controls.submit.disabled=false;}
    }
    controls.form.addEventListener('submit',e=>{e.preventDefault();void render();});search.addEventListener('input',renderDirectory);await render();
  }catch(e){root.textContent=`Publishers unavailable: ${(e as Error).message}`;}
}
