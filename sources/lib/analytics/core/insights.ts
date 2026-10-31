import { quantile, wilson } from './shared';
import { DEFAULT_FILTER, selectCohort, type ResearchGame } from './cohorts';
import { DEFAULT_REVIEW_THRESHOLD } from './thresholds';

export function outcome(games: ResearchGame[], threshold=DEFAULT_REVIEW_THRESHOLD) {
  const observed=games.filter(g=>g.reviews!==null),hits=observed.filter(g=>g.reviews!>=threshold).length;
  return {selected:games.length,n:observed.length,hits,rate:observed.length?hits/observed.length:null,interval:wilson(hits,observed.length)};
}

export function concentration(games: ResearchGame[]) {
  const observed=games.filter(g=>g.reviews!==null).sort((a,b)=>b.reviews!-a.reviews! || a.appid-b.appid);
  const total=observed.reduce((sum,g)=>sum+g.reviews!,0);
  if(!total)return {n:observed.length,total,top1:null,top5:null,hhi:null,effective:null,curve:[] as Array<[number,number]>,leaders:observed.slice(0,5)};
  const hhi=observed.reduce((sum,g)=>sum+(g.reviews!/total)**2,0);
  const prefix=[0];for(const g of observed)prefix.push(prefix[prefix.length-1]+g.reviews!);
  // Sample the exact cumulative distribution at deciles, largest contributors first.
  const curve:Array<[number,number]>=Array.from({length:11},(_,i)=>{const k=Math.ceil(i*observed.length/10);return [k/observed.length,prefix[k]/total];});
  return {n:observed.length,total,top1:observed[0].reviews!/total,top5:observed.slice(0,5).reduce((s,g)=>s+g.reviews!,0)/total,hhi,effective:1/hhi,curve,leaders:observed.slice(0,5)};
}

export function reception(games:ResearchGame[],minimumReviews=10){
  const eligible=games.filter(g=>g.reviews!==null && g.reviews>=minimumReviews && g.positive!==null);
  const ratios=eligible.map(g=>g.positive!).sort((a,b)=>a-b);
  const bins=Array.from({length:10},()=>0);for(const r of ratios)bins[Math.min(9,Math.floor(r*10))]++;
  return {n:ratios.length,minimumReviews,quantiles:[.25,.5,.75,.9].map(p=>quantile(ratios,p)),bins};
}

export const ACCESSIBILITY = ['Adjustable Difficulty','Adjustable Text Size','Camera Comfort','Captions available','Chat Speech-to-text','Chat Text-to-speech','Color Alternatives','Custom Volume Controls','Keyboard Only Option','Mouse Only Option','Narrated Game Menus','Playable without Timed Input','Save Anytime','Stereo Sound','Subtitle Options','Surround Sound','Touch Only Option'];
export const CORE_FEATURES = ['Full controller support','Partial Controller Support','Online Co-op','Shared/Split Screen Co-op','LAN Co-op','Online PvP','Shared/Split Screen PvP','Steam Cloud','Steam Workshop','Includes level editor'];
export function featureComparison(games:ResearchGame[],feature:string,threshold=DEFAULT_REVIEW_THRESHOLD){
  const known=games.filter(g=>g.categories!==null),yes=known.filter(g=>g.categories!.includes(feature)),no=known.filter(g=>!g.categories!.includes(feature));
  const withFeature=outcome(yes,threshold),withoutFeature=outcome(no,threshold);
  return {known:known.length,unknown:games.length-known.length,declared:yes.length,prevalence:known.length?yes.length/known.length:null,
    withFeature,withoutFeature,difference:withFeature.rate===null||withoutFeature.rate===null?null:withFeature.rate-withoutFeature.rate};
}

export const PRICE_LABELS=['<$5','$5–9.99','$10–14.99','$15–19.99','$20–29.99','$30+'];
export const priceBucket=(cents:number)=>cents<500?0:cents<1000?1:cents<1500?2:cents<2000?3:cents<3000?4:5;
export function pricing(games:ResearchGame[],threshold=DEFAULT_REVIEW_THRESHOLD){
  const clean=games.filter(g=>g.price!==null && g.price>0 && g.currency==='USD'),sorted=clean.map(g=>g.price!).sort((a,b)=>a-b);
  const positive=games.filter(g=>g.price!==null&&g.price>0),zero=games.filter(g=>g.price===0),unknown=games.filter(g=>g.price===null);
  return {positive:outcome(positive,threshold),zero:outcome(zero,threshold),unknown:outcome(unknown,threshold),unverified:positive.length-clean.length,clean:clean.length,
    quantiles:[.25,.5,.75,.9].map(p=>quantile(sorted,p)),buckets:PRICE_LABELS.map((_,i)=>outcome(clean.filter(g=>priceBucket(g.price!)===i),threshold))};
}

export function comboGroups(games:ResearchGame[],a:number,b:number,rank:number|null){
  const known=games.filter(g=>g.tags.length>0);
  const cohort=(include:number[],exclude:number[]=[])=>selectCohort(known,{...DEFAULT_FILTER,rank,include,exclude});
  const both=cohort([a,b]),onlyA=cohort([a],[b]),onlyB=cohort([b],[a]);
  const union=both.length+onlyA.length+onlyB.length;
  return {both,onlyA,onlyB,a:cohort([a]),b:cohort([b]),unknown:games.length-known.length,jaccard:union?both.length/union:null};
}

export function groupByTag(games:ResearchGame[],rank:number|null):Map<number,ResearchGame[]>{
  const groups=new Map<number,ResearchGame[]>();
  for(const game of games)for(const [id,position] of game.tags){
    if(rank!==null&&(position===null||position>rank))continue;
    if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(game);
  }
  return groups;
}
