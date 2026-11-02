import { gameType } from './game-type';
import { DEFAULT_FILTER, type CohortFilter, type ResearchIndex } from './cohorts';
import { reviewThreshold } from './thresholds';

export interface CohortState {from:number;to:number;filter:CohortFilter;threshold?:number}
export function parseCohortState(query:URLSearchParams,index:ResearchIndex):CohortState {
  const fallback=index.defaultYear??index.years.find(y=>y.year!==null)?.year;
  if(fallback==null)throw Error('No release-year cohorts are available.');
  const year=(key:string)=>{
    const raw=query.get(key)??query.get('year'),value=raw===null?fallback:Number(raw);
    if(!index.years.some(y=>y.year===value))throw Error(`Release year unavailable: ${raw}`);
    return value;
  };
  const tags=(raw:string)=>[...new Set(raw.split(',').map(s=>s.trim()).filter(Boolean).map(s=>{
    const tag=index.tags.find(t=>String(t.id)===s||t.name.toLowerCase()===s.toLowerCase());
    if(!tag)throw Error(`Unknown tag: ${s}`);return tag.id;
  }))];
  const choice=<T extends string>(key:string,choices:T[],defaultValue:T):T=>{
    const value=query.get(key);if(value===null)return defaultValue;
    if(!choices.includes(value as T))throw Error(`Invalid ${key} filter: ${value}`);return value as T;
  };
  const from=year('from'),to=year('to');if(from>to)throw Error('The first release year must not be after the last.');
  const rank=choice('rank',['5','20','any'],'20');
  // Old Lifecycle links used mode for the chart; canonical cohort mode means tag matching.
  const mode=query.get('mode')==='cumulative'||query.get('mode')==='monthly'?'all':choice('mode',['all','any'],'all');
  return {from,to,threshold:reviewThreshold(query.get('threshold')),filter:{...DEFAULT_FILTER,include:tags(query.get('include')??query.get('tag')??''),exclude:tags(query.get('exclude')??''),mode,
    gameType:gameType(query.get('gameType')),rank:rank==='any'?null:Number(rank),price:choice('price',['all','zero','positive','usd','unknown'],'all'),
    parties:choice('parties',['all','match','different','unknown'],'all'),rated:query.get('rated')==='1'||query.get('population')==='rated',
    features:[...new Set(query.getAll('feature').map(s=>s.trim()).filter(Boolean))]}};
}
export function cohortQuery(state:CohortState):URLSearchParams {
  const f=state.filter,p=new URLSearchParams({from:String(state.from),to:String(state.to),mode:f.mode,rank:f.rank===null?'any':String(f.rank),gameType:f.gameType??'all',price:f.price,parties:f.parties,threshold:String(reviewThreshold(state.threshold))});
  if(f.include.length)p.set('include',f.include.join(','));if(f.exclude.length)p.set('exclude',f.exclude.join(','));
  if(f.rated)p.set('rated','1');for(const feature of f.features)p.append('feature',feature);return p;
}
export interface SavedCohort {name:string;query:string}
export function readSavedCohorts(raw:string|null):SavedCohort[]{
  try {const data=JSON.parse(raw??'null');if(data?.version!==1||!Array.isArray(data.cohorts))return [];
    return data.cohorts.filter((s:SavedCohort)=>typeof s?.name==='string'&&s.name.length>0&&s.name.length<=100&&typeof s.query==='string'&&s.query.length<=8000).slice(0,30);
  }catch{return [];}
}
