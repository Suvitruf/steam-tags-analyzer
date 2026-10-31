import { fetchAnalytics } from './snapshot';
import type { ResearchIndex, ResearchGame } from './core/cohorts';
import type { LifecycleFile } from './core/lifecycle';

const files=new Map<string,Promise<LifecycleFile>>();
export async function getLifecycleYears(index:ResearchIndex,from:number,to:number):Promise<LifecycleFile>{
  const keys=index.years.filter(y=>y.year!==null&&y.year>=from&&y.year<=to).map(y=>`lifecycle/years/${y.year}.json`);
  const data=await Promise.all(keys.map(file=>{
    let value=files.get(file);if(!value){value=fetchAnalytics<LifecycleFile>(file).catch(e=>{files.delete(file);throw e;});files.set(file,value);}return value;
  }));
  if(!data.length||new Set(data.map(d=>d.asOf)).size!==1)throw Error('Lifecycle observation dates are inconsistent or missing.');
  return {asOf:data[0].asOf,records:data.flatMap(d=>d.records)};
}
export function selectedLifecycle(games:ResearchGame[],data:LifecycleFile){
  const byId=new Map(data.records.map(r=>[r.appid,r]));
  return games.map(g=>{const record=byId.get(g.appid);if(!record)throw Error(`Lifecycle record missing for App ID ${g.appid}`);return record;});
}
