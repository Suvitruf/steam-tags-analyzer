import { monthNumber } from './history';
import { quantile, wilson } from './shared';
import { comparisonThresholds, DEFAULT_REVIEW_THRESHOLD } from './thresholds';

export interface HistorySource {resolution:string|null;validation:string|null;complete_through:string|null;successful_at:string|null}
export type AnchorStatus='validated'|'missing-release-date'|'missing-history'|'unvalidated-history'|'weekly-source'|'incomplete-source'|'reviews-before-release';
export interface LifecycleRecord {
  appid:number;status:AnchorStatus;releaseMonth:string|null;firstReviewMonth:string|null;
  completeThrough:string|null;observedAt:string|null;launch:number|null;months:Array<number|null>;
}
export interface LifecycleFile {asOf:string;records:LifecycleRecord[]}

export function lifecycleExclusion(r:LifecycleRecord,horizon:number,asOf:string):string|null{
  if(r.status!=='validated')return r.status;
  const latestComplete=monthNumber(asOf.slice(0,7))-1;
  if(monthNumber(r.releaseMonth!)+horizon>latestComplete)return 'not-old-enough';
  if(r.months.length<horizon||r.months.slice(0,horizon).some(v=>v===null))return 'incomplete-followup';
  return null;
}

export function summarizeLifecycle(records:LifecycleRecord[],horizon:number,asOf:string,threshold=DEFAULT_REVIEW_THRESHOLD){
  if(![3,6,12].includes(horizon))throw new Error('Lifecycle horizon must be 3, 6, or 12 months');
  const excluded:Record<string,number>={},eligible:LifecycleRecord[]=[];
  for(const r of records){
    const reason=lifecycleExclusion(r,horizon,asOf);
    if(reason===null){eligible.push(r);continue;}
    excluded[reason]=(excluded[reason]??0)+1;
  }
  const cumulative=eligible.map(r=>{let total=0;return r.months.slice(0,horizon).map(v=>total+=v!);});
  const bands=(values:number[][])=>Array.from({length:horizon},(_,i)=>{
    const sorted=values.map(v=>v[i]).sort((a,b)=>a-b);return [.25,.5,.75].map(p=>quantile(sorted,p));
  });
  const totals=cumulative.map(r=>r[horizon-1]),n=eligible.length;
  return {selected:records.length,n,eligible,excluded,monthly:bands(eligible.map(r=>r.months.slice(0,horizon) as number[])),cumulative:bands(cumulative),
    thresholds:comparisonThresholds(threshold).map(threshold=>{const hits=totals.filter(v=>v>=threshold).length;return {threshold,hits,n,rate:n?hits/n:null,interval:wilson(hits,n)};})};
}
