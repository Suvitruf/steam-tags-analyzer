import { createGMFetch } from '../gm-adapters.js';
const PREFIX='steam-tag-research:history:';
export function liveTagLimit(url) {
  if(/^https:\/\/steam-tags-api\.aapanasik\.com\/app\/[1-9]\d*\?fresh=1$/.test(url))return 1_000_000;
  throw Error('Unexpected Steam lookup URL');
}
export function tagObservation(appid,data,now=Date.now()) {
  if(data.appid!==appid||data.type!=='game'||!Array.isArray(data.tags)||!data.tags.length||data.tags.length>100)throw Error('Steam returned no usable game tag list. The previous observation was kept.');
  if(data.tags.some(t=>!Number.isSafeInteger(t.tagid)||t.tagid<=0||typeof t.name!=='string'||!t.name.trim()||t.name.length>200)||new Set(data.tags.map(t=>t.tagid)).size!==data.tags.length)throw Error('Steam returned an invalid tag list. The previous observation was kept.');
  return {appid,name:typeof data.name==='string'?data.name:`App ${appid}`,at:new Date(now).toISOString(),
    fetchedAt:typeof data.fetched_at==='string'&&Number.isFinite(Date.parse(data.fetched_at))?data.fetched_at:null,
    tags:data.tags.slice(0,20).map((t,i)=>({id:t.tagid,name:t.name,rank:i+1}))};
}
export function tagDifference(before,after) {
  const old=new Map(before.tags.map(t=>[t.id,t])),current=new Map(after.tags.map(t=>[t.id,t]));
  return {added:after.tags.filter(t=>!old.has(t.id)),removed:before.tags.filter(t=>!current.has(t.id)),
    moved:after.tags.filter(t=>old.has(t.id)&&old.get(t.id).rank!==t.rank).map(t=>({...t,previous:old.get(t.id).rank})),
    renamed:after.tags.filter(t=>old.has(t.id)&&old.get(t.id).name!==t.name).map(t=>({...t,previous:old.get(t.id).name}))};
}
export function createTagHistory(gm,request=createGMFetch(GM_xmlhttpRequest,20000,liveTagLimit)) {
  const key=id=>{if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid App ID');return PREFIX+id;};
  async function read(id) {
    const value=await gm.getValue(key(id),null);
    return value?.version===1&&value.current?.appid===id&&Array.isArray(value.current.tags)?value:null;
  }
  async function check(id) {
    const response=await request(`https://steam-tags-api.aapanasik.com/app/${id}?fresh=1`,{cache:'no-cache'});
    if(!response.ok)throw Error(`Steam lookup failed (${response.status}). The previous observation was kept.`);
    const current=tagObservation(id,await response.json()),existing=await read(id);
    const value={version:1,previous:existing?.current??null,current};
    await gm.setValue(key(id),value);
    // Two small observations per game; retain at most 100 recently checked games.
    try {
      const entries=[];
      for(const k of(await gm.listValues()).filter(k=>k.startsWith(PREFIX))){const v=await gm.getValue(k,null);entries.push({key:k,at:v?.current?.at??''});}
      for(const entry of entries.sort((a,b)=>b.at.localeCompare(a.at)).slice(100))await gm.deleteValue(entry.key);
    } catch { /* Retention cleanup can retry after the next successful check. */ }
    return value;
  }
  return {read,check,remove:id=>gm.deleteValue(key(id))};
}
