import { el, fmtInt } from './format';
import { action, labeledInput, labeledSelect } from './research-ui';
import { analyticsPath } from './coverage';
import { parseCohortState, cohortQuery, readSavedCohorts, type CohortState } from './core/cohort-state';
import type { ResearchIndex } from './core/cohorts';
import { getReviewThreshold } from './review-threshold';

const STORAGE='steam-tags.saved-cohorts.v1';
export function cohortControls(root:HTMLElement,index:ResearchIndex,query=new URLSearchParams(location.search)){
  if(!query.has('threshold'))query.set('threshold',String(getReviewThreshold()));
  const initial=parseCohortState(query,index),f=initial.filter;
  const form=el('form','research-controls',root),list=el('datalist',undefined,form);list.id='cohort-tags';
  for(const tag of index.tags){const option=el('option',undefined,list);option.value=tag.name;}
  const names=(ids:number[])=>ids.map(id=>index.tags.find(t=>t.id===id)!.name).join(', ');
  const include=labeledInput(form,'Include tags (comma separated)',names(f.include)),exclude=labeledInput(form,'Exclude tags (comma separated)',names(f.exclude));
  include.setAttribute('list',list.id);exclude.setAttribute('list',list.id);
  const mode=labeledSelect(form,'Include matching',[['all','All selected tags'],['any','Any selected tag']],f.mode);
  const rank=labeledSelect(form,'Tag positions',[['5','Top five'],['20','Top twenty'],['any','Any stored rank']],String(f.rank??'any'));
  const years=index.years.filter(y=>y.year!==null).map(y=>[String(y.year),`${y.year} (${fmtInt(y.count)})`] as [string,string]);
  const from=labeledSelect(form,'Release year from',years,String(initial.from)),to=labeledSelect(form,'Through',years,String(initial.to));
  const price=labeledSelect(form,'Observed price',[['all','All observed-price states'],['zero','Zero price'],['positive','Positive price'],['usd','Positive verified USD price'],['unknown','Unknown price']],f.price);
  const parties=labeledSelect(form,'Publisher-name proxy',[['all','All name states'],['match','Matching developer/publisher names'],['different','Different names'],['unknown','Missing names']],f.parties);
  const features=labeledInput(form,'Required store categories (semicolon separated)',f.features.join('; '));features.placeholder='Steam Cloud; Single-player';
  const rated=labeledInput(form,'Only games with at least ten reviews','','checkbox');rated.checked=f.rated;
  const submit=el('button','research-button',form);submit.type='submit';submit.textContent='Apply filters';
  const navigation=el('nav','analytics-controls',root);navigation.setAttribute('aria-label','Explore this cohort');
  const savedHost=el('details',undefined,root);el('summary',undefined,savedHost).textContent='Saved cohorts on this device';
  const saveName=labeledInput(savedHost,'Cohort name','');saveName.maxLength=100;
  const savedList=el('div',undefined,savedHost),message=el('p','viz-caption',savedHost);message.setAttribute('role','status');
  let current:CohortState|null=null;
  function read(){
    const p=new URLSearchParams({from:from.value,to:to.value,include:include.value,exclude:exclude.value,mode:mode.value,rank:rank.value,price:price.value,parties:parties.value,rated:rated.checked?'1':'0'});
    for(const feature of features.value.split(';').map(s=>s.trim()).filter(Boolean))p.append('feature',feature);
    p.set('threshold',String(getReviewThreshold()));
    return parseCohortState(p,index);
  }
  function renderSaved(){
    savedList.replaceChildren();
    try{
      const saved=readSavedCohorts(localStorage.getItem(STORAGE));
      for(const item of saved){
        const row=el('div','analytics-controls',savedList),link=el('a',undefined,row);
        link.textContent=item.name;link.href=`${location.pathname}?${new URLSearchParams(item.query)}`;
        action(row,`Delete ${item.name}`,()=>{try{const latest=readSavedCohorts(localStorage.getItem(STORAGE));localStorage.setItem(STORAGE,JSON.stringify({version:1,cohorts:latest.filter(s=>s.query!==item.query||s.name!==item.name)}));renderSaved();}catch{message.textContent='Browser storage is unavailable.';}});
      }
    }catch{message.textContent='Browser storage is unavailable; shareable cohort links still work.';}
  }
  action(savedHost,'Save cohort on this device',()=>{
    if(!current){message.textContent='Apply valid filters before saving.';return;}
    const name=saveName.value.trim();if(!name){message.textContent='Enter a name for this cohort.';return;}
    try{const saved=readSavedCohorts(localStorage.getItem(STORAGE)).filter(s=>s.name!==name);
      localStorage.setItem(STORAGE,JSON.stringify({version:1,cohorts:[{name,query:cohortQuery(current).toString()},...saved].slice(0,30)}));
      message.textContent='Saved filters. Results use the current data snapshot when reopened.';renderSaved();
    }catch{message.textContent='Could not save: browser storage is unavailable or full.';}
  });renderSaved();
  function publish(state:CohortState,extra:Record<string,string>={}){
    current=state;const p=cohortQuery(state);for(const [key,value] of Object.entries(extra))p.set(key,value);
    history.replaceState(null,'',`${location.pathname}?${p}`);navigation.replaceChildren();
    for(const [page,title] of [['benchmarks','Benchmarks'],['lifecycle','Lifecycle'],['prices','Prices'],['features','Features'],['trends','Trends'],['publishers','Publishers']]){
      const link=el('a',undefined,navigation);link.href=`${analyticsPath(page)}?${p}`;link.textContent=title;
    }
  }
  return {form,submit,read,publish,query};
}
