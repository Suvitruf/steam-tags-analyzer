
export const DEFAULT_REVIEW_THRESHOLD=250;
export function reviewThreshold(value:string|number|null|undefined):number {
  if(value===null||value===undefined)return DEFAULT_REVIEW_THRESHOLD;
  const text=String(value).trim(),n=Number(text);
  if(!/^\d+$/.test(text)||!Number.isSafeInteger(n)||n<1)throw Error('Review threshold must be a positive whole number.');
  return n;
}
/** Keep the reference levels while including the selected cutoff exactly once. */
export const comparisonThresholds=(selected=DEFAULT_REVIEW_THRESHOLD)=>[...new Set([50,reviewThreshold(selected),1000])].sort((a,b)=>a-b);

export interface ThresholdFile {
  format:'review-threshold-v1';timingYears:[number,number];
  // Exact review count, year, timing month, party-name state, tag ID * 4 + rank bucket.
  games:Array<[number,number|null,number|null,number,number[]]>;
}
export interface ThresholdCounts {
  n:number;hits:number;ranks:number[];byYear:Record<string,[number,number]>;
  months:{rel:number[];hits:number[]};selfPub:{n:number;hits:number};published:{n:number;hits:number};
}
function empty():ThresholdCounts{return {n:0,hits:0,ranks:[0,0,0,0],byYear:{},months:{rel:Array(12).fill(0),hits:Array(12).fill(0)},selfPub:{n:0,hits:0},published:{n:0,hits:0}};}
export function aggregateThresholds(data:ThresholdFile,threshold:number){
  reviewThreshold(threshold);if(data.format!=='review-threshold-v1')throw Error('Unsupported review threshold data.');
  const all=empty(),tags=new Map<number,ThresholdCounts>();
  const add=(group:ThresholdCounts,hit:number,year:number|null,month:number|null,party:number)=>{
    group.n++;group.hits+=hit;
    if(year!==null){const row=group.byYear[year]??=[0,0];row[0]++;row[1]+=hit;}
    if(month!==null){group.months.rel[month-1]++;group.months.hits[month-1]+=hit;}
    const names=party===1?group.selfPub:party===2?group.published:null;if(names){names.n++;names.hits+=hit;}
  };
  for(const [reviews,year,month,party,encoded] of data.games){
    const hit=Number(reviews>=threshold);add(all,hit,year,month,party);
    for(const value of encoded){const id=Math.floor(value/4);let tag=tags.get(id);if(!tag){tag=empty();tags.set(id,tag);}add(tag,hit,year,month,party);tag.ranks[value%4]+=hit;}
  }
  return {all,tags,timingYears:data.timingYears};
}
