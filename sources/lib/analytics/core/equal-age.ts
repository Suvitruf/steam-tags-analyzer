import type { ResearchGame } from './cohorts';
import { summarizeLifecycle, type LifecycleFile } from './lifecycle';
import { DEFAULT_REVIEW_THRESHOLD } from './thresholds';

// A display guard, not evidence that the covered subset is representative.
export const EQUAL_AGE_MIN_N=30;
export const EQUAL_AGE_MIN_COVERAGE=0.5;
export function equalAgePanels(games:ResearchGame[],data:LifecycleFile,horizon:3|6,threshold=DEFAULT_REVIEW_THRESHOLD){
  const byId=new Map(data.records.map(r=>[r.appid,r]));
  const years=[...new Set(games.map(g=>g.year))].sort((a,b)=>(a??0)-(b??0));
  return years.map(year=>{
    const group=games.filter(g=>g.year===year),records=group.map(g=>{
      const record=byId.get(g.appid);if(!record)throw Error(`Lifecycle record missing for App ID ${g.appid}`);return record;
    });
    const summary=summarizeLifecycle(records,horizon,data.asOf,threshold),coverage=summary.selected?summary.n/summary.selected:0;
    const reason=summary.n<EQUAL_AGE_MIN_N?'Fewer than 30 eligible games':coverage<EQUAL_AGE_MIN_COVERAGE?'Less than 50% history coverage':null;
    return {year,horizon,summary,coverage,reason,comparable:reason===null};
  });
}
