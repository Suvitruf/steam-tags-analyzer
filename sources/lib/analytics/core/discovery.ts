import type { ResearchGame } from './cohorts';
export type ReleasePrecision = 'day'|'month'|'quarter'|'year'|'unknown';

export interface UpcomingGame {
  appid:number;name:string;raw:string|null;precision:ReleasePrecision;start:string|null;end:string|null;
  firstObserved:string;observedAt:string;announcementVersions:number;tags:Array<[number,number|null]>;
}
export interface UpcomingFile {
  asOf:string;catalogUnreleased:number;unverified:number;games:UpcomingGame[];tags:Array<{id:number;name:string}>;
}
export function selectUpcoming(games:UpcomingGame[],from:string,to:string,precision:string,tag:number|null,unknown:boolean):UpcomingGame[]{
  return games.filter(g=>(tag===null||g.tags.some(([id])=>id===tag))&&(precision==='all'||g.precision===precision)
    &&(g.start===null||g.end===null?unknown:g.start<to&&g.end>from));
}
/** Only day/month precision belongs in a monthly count; broad windows stay separate. */
export function upcomingMonths(games:UpcomingGame[]){
  const counts=new Map<string,number>();
  for(const g of games)if((g.precision==='day'||g.precision==='month')&&g.start)counts.set(g.start.slice(0,7),(counts.get(g.start.slice(0,7))??0)+1);
  return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([month,count])=>({month,count}));
}

export interface MomentumRecord {
  appid:number;name:string;tags:ResearchGame['tags'];values:Array<number|null>;reason:string|null;entrant:boolean;
}
export function summarizeMomentum(records:MomentumRecord[]){
  const excluded:Record<string,number>={},panel:MomentumRecord[]=[];
  for(const r of records){if(r.reason)excluded[r.reason]=(excluded[r.reason]??0)+1;else panel.push(r);}
  const sum=(values:Array<number|null>)=>values.reduce<number>((a,b)=>a+b!,0);
  const pairs=panel.map(r=>({appid:r.appid,name:r.name,previous:sum(r.values.slice(0,3)),current:sum(r.values.slice(3))}));
  const previous=pairs.reduce((s,r)=>s+r.previous,0),current=pairs.reduce((s,r)=>s+r.current,0);
  const leader=[...pairs].sort((a,b)=>b.current-a.current||a.appid-b.appid)[0]??null;
  const withoutPrevious=previous-(leader?.previous??0),withoutCurrent=current-(leader?.current??0);
  return {selected:records.length,panelGames:panel.length,excluded,entrants:records.filter(r=>r.entrant).length,
    previous,current,delta:current-previous,growth:previous?current/previous-1:null,
    growingGames:pairs.filter(r=>r.current>r.previous).length,
    growingShare:pairs.length?pairs.filter(r=>r.current>r.previous).length/pairs.length:null,
    monthly:Array.from({length:6},(_,i)=>panel.reduce((s,r)=>s+r.values[i]!,0)),leader,
    withoutLargest:{previous:withoutPrevious,current:withoutCurrent,delta:withoutCurrent-withoutPrevious,growth:withoutPrevious?withoutCurrent/withoutPrevious-1:null},
  };
}
export type MomentumSummary=ReturnType<typeof summarizeMomentum>;
export interface MomentumFile {
  asOf:string;months:string[];all:MomentumSummary;
  rankings:Array<{rank:number;tags:Array<{id:number;name:string;stats:MomentumSummary;previousShare:number|null;currentShare:number|null}>}>;
}
