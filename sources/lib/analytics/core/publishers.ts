import type { ResearchGame } from './cohorts';

export interface PublisherEntry {key:string;names:string[];apps:number[]}
export interface PublisherIndex {asOf:string;buckets:number;publishers:PublisherEntry[];unknown:number}
/** Case/whitespace grouping only; no splitting, suffix removal, or corporate resolution. */
export function publisherKey(name:string|null):string|null {
  return name?.trim().replace(/\s+/g,' ').toLowerCase()||null;
}
export function publisherBucket(key:string,buckets=128):number {
  let hash=2166136261;for(let i=0;i<key.length;i++){hash^=key.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0)%buckets;
}
export function publishersInCohort(index:PublisherIndex,games:ResearchGame[]){
  const ids=new Set(games.map(g=>g.appid));
  const publishers=index.publishers.map(p=>({...p,matched:p.apps.filter(id=>ids.has(id)).length})).filter(p=>p.matched>0).sort((a,b)=>b.matched-a.matched||a.key.localeCompare(b.key));
  return {publishers,unknown:games.length-publishers.reduce((n,p)=>n+p.matched,0)};
}
export function portfolioComposition(games:ResearchGame[],rank:number|null){
  const counts=new Map<number,number>();let tagged=0;
  for(const g of games){const tags=[...new Set(g.tags.filter(([,r])=>rank===null||(r!==null&&r<=rank)).map(([id])=>id))];if(tags.length)tagged++;
    for(const id of tags)counts.set(id,(counts.get(id)??0)+1);}
  return {tagged,unknown:games.length-tagged,tags:[...counts].map(([id,count])=>({id,count})).sort((a,b)=>b.count-a.count||a.id-b.id)};
}
