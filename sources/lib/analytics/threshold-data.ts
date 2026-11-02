import { aggregateThresholds, DEFAULT_REVIEW_THRESHOLD, type ThresholdFile } from './core/thresholds';
import { getManifest } from './snapshot';
import { fetchPopulation, populationPath } from './game-type';
import type { TagsSummaryFile, TagSummary, TagDetail, TrendsFile, TimingFile } from './data';

let raw:Promise<ThresholdFile>|undefined;
const counts=new Map<number,Promise<ReturnType<typeof aggregateThresholds>>>();
async function load(){
  const manifest=await getManifest();
  if(!manifest?.artifacts[populationPath('review-thresholds.json')])throw Error('Custom review thresholds are unavailable in this data snapshot. Use 250 until newer data is published.');
  return fetchPopulation<ThresholdFile>('review-thresholds.json');
}
export function thresholdCounts(threshold:number){
  let p=counts.get(threshold);if(!p){raw??=load().catch(e=>{raw=undefined;throw e;});p=raw.then(data=>aggregateThresholds(data,threshold)).catch(e=>{counts.delete(threshold);throw e;});counts.set(threshold,p);}return p;
}
export type ThresholdTag=TagSummary&{rate:number;lift:number|null};
export type ThresholdSummary=Omit<TagsSummaryFile,'tags'>&{tags:ThresholdTag[];baselineRate:number;threshold:number};
export async function thresholdSummary(data:TagsSummaryFile,threshold:number):Promise<ThresholdSummary>{
  const counts=threshold===DEFAULT_REVIEW_THRESHOLD?null:await thresholdCounts(threshold);
  const baselineRate=counts?(counts.all.n?counts.all.hits/counts.all.n:0):data.baseline.h250;
  if(counts&&counts.all.n!==data.gameCount)throw Error('Review threshold population does not match this snapshot.');
  return {...data,baselineRate,threshold,tags:data.tags.map(t=>{
    const c=counts?.tags.get(t.id);if(counts&&(c?.n??0)!==t.count)throw Error(`Review threshold population mismatch for ${t.name}`);
    const rate=counts?(c?.n?c.hits/c.n:0):t.hitRates.h250;
    return {...t,rate,lift:baselineRate>0?(counts?rate/baselineRate:t.liftVsBaseline.h250):null};
  })};
}
export async function thresholdDetail(data:TagDetail,threshold:number){
  const c=threshold===DEFAULT_REVIEW_THRESHOLD?null:(await thresholdCounts(threshold)).tags.get(data.id);
  if(threshold!==DEFAULT_REVIEW_THRESHOLD&&(!c||c.n!==data.count))throw Error('Tag review threshold data is incomplete.');
  return {...data,ranks:{...data.ranks,hits:c?.ranks??data.ranks.hits250},
    byYear:Object.fromEntries(Object.entries(data.byYear).map(([year,row])=>[year,c?(c.byYear[year]??[0,0]):row])),
    selfPub:c?.selfPub??data.selfPub,published:c?.published??data.published};
}
export async function thresholdTrends(data:TrendsFile,threshold:number):Promise<TrendsFile>{
  if(threshold===DEFAULT_REVIEW_THRESHOLD)return data;
  const c=await thresholdCounts(threshold),hits=(years:Record<string,[number,number]>)=>data.years.map(y=>years[y]?.[1]??0);
  return {...data,baseline:{...data.baseline,hits:hits(c.all.byYear)},tags:data.tags.map(t=>({...t,hits:hits(c.tags.get(t.id)?.byYear??{})}))};
}
export async function thresholdTiming(data:TimingFile,threshold:number):Promise<TimingFile>{
  if(threshold===DEFAULT_REVIEW_THRESHOLD)return data;
  const c=await thresholdCounts(threshold);if(c.timingYears.join(',')!==data.years.join(','))throw Error('Release timing window does not match threshold data.');
  return {...data,all:c.all.months,tags:data.tags.map(t=>({...t,...(c.tags.get(t.id)?.months??{rel:Array(12).fill(0),hits:Array(12).fill(0)})}))};
}
