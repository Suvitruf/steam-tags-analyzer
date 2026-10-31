import { fetchAnalytics } from './snapshot';
import { unpackGames, type ResearchGame, type ResearchIndex, type ResearchShard, type CohortShard } from './core/cohorts';

let index: Promise<ResearchIndex> | undefined;
const shards = new Map<string,Promise<ResearchGame[]>>();
export function getResearchIndex(): Promise<ResearchIndex> {
  return index ??= fetchAnalytics<ResearchIndex>('research-index.json').catch(err=>{index=undefined;throw err;});
}
export function getResearchShard(file: string): Promise<ResearchGame[]> {
  let promise=shards.get(file);
  if(!promise){promise=fetchAnalytics<ResearchShard|CohortShard>(file).then(unpackGames).catch(err=>{shards.delete(file);throw err;});shards.set(file,promise);}
  return promise;
}
export async function hydrateGames(games: ResearchGame[]): Promise<ResearchGame[]> {
  const missing=games.filter(g=>g.detailsLoaded===false);if(!missing.length)return games;
  const index=await getResearchIndex(),years=new Set(missing.map(g=>g.year));
  const files=index.years.filter(y=>years.has(y.year)).map(y=>y.detailsFile??y.file);
  const details=new Map((await Promise.all(files.map(getResearchShard))).flat().map(g=>[g.appid,g]));
  return games.map(g=>{
    if(g.detailsLoaded!==false)return g;
    const full=details.get(g.appid);if(!full||full.detailsLoaded===false)throw Error(`Details unavailable for App ${g.appid}`);
    return full;
  });
}
export async function getResearchYears(index: ResearchIndex, from: number, to: number): Promise<ResearchGame[]> {
  return (await Promise.all(index.years.filter(y=>y.year!==null && y.year>=from && y.year<=to).map(y=>getResearchShard(y.file)))).flat();
}
export async function getResearchApps(ids: number[]): Promise<ResearchGame[]> {
  const index=await getResearchIndex();
  const files=[...new Set(ids.map(id=>`research/apps/${id%index.appBuckets}.json`))];
  const rows=(await Promise.all(files.map(getResearchShard))).flat();
  const map=new Map(rows.map(g=>[g.appid,g]));
  return ids.flatMap(id=>map.has(id)?[map.get(id)!]:[]);
}
