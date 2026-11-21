import { createHash } from 'node:crypto';
export const base = 'https://projects.cdn.aapanasik.com/steam-tags/analytics/';
export function researchFixture() {
  const manifest = { schemaVersion:2,snapshotId:'research-test',basePath:'releases/research-test',generatedAt:'2026-11-19T00:00:00Z',artifacts:{} };
  const files = new Map();
  function put(file, data) {
    const body = Buffer.from(JSON.stringify({...data,snapshotId:manifest.snapshotId,schemaVersion:2}));
    files.set(base+manifest.basePath+'/'+file,body);
    manifest.artifacts[file]={bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
    files.set(base+'manifest.json',Buffer.from(JSON.stringify(manifest)));
  }
  put('research-index.json',{tags:[{id:1,name:'Colony Sim'},{id:2,name:'Strategy'}],years:[{year:2025,file:'research/years/2025.json',count:4}],defaultYear:2025,appBuckets:128});
  put('research/apps/99.json',{parties:[],categories:[],games:[]});
  const upcoming=(appid,precision,start,end)=>({appid,name:`Upcoming ${appid}`,raw:precision,precision,start,end,firstObserved:'2026-11-01',observedAt:'2026-11-18',announcementVersions:1,tags:[[1,1]]});
  put('upcoming.json',{asOf:'2026-11-19T00:00:00Z',catalogUnreleased:5,unverified:1,tags:[{id:1,name:'Colony Sim'}],games:[
    upcoming(10,'month','2026-12-01','2027-01-01'),upcoming(11,'quarter','2026-10-01','2027-01-01'),upcoming(12,'unknown',null,null),upcoming(13,'day','2027-01-01','2027-01-02')
  ]});
  put('publishers/portfolios/0.json',{parties:['Fixture Publisher','Unrelated'],categories:[],games:[
    [10,'Game 10',2025,'2025-01-01',0,null,1000,'USD',null,0,[],[1,1],'2025-11-01','2025-11-01'],
    [11,'Game 11',2025,'2025-02-01',250,.9,2000,'USD',null,0,[],[1,1,2,2],'2025-11-01','2025-11-01'],
    [12,'Do not include',2025,'2025-02-01',1000,.9,2000,'USD',null,1,[],[1,1],'2025-11-01','2025-11-01']
  ]});
  for(const id of [10,11,12,13])put(`research/apps/${id}.json`,{parties:[],categories:[],games:[
    [id,`Game ${id}`,2025,'2025-01-01',id===13?null:id===10?0:id===11?250:1000,.9,1000,'USD',null,null,[],[1,1,2,2],'2025-11-01','2025-11-01']
  ]});
  put('research/years/2025.json',{format:'cohort-v2',year:2025,categories:[],tags:[1,2],games:[
    [10,0,null,1000,1,0,[],[33,65],20000,20300],
    [11,250,.9,2000,1,0,[],[33,65],20000,20300],
    [12,1000,.8,3000,1,0,[],[33],20000,20300],
    [13,null,null,null,0,0,null,[33],null,null],
  ].map(row=>{row[7]=row[7].map(t=>t-32);return row;})});
  return {files,manifest,put};
}
export function memoryGM() { const data = new Map(); return {data,getValue:async(k,d)=>data.has(k)?data.get(k):d,setValue:async(k,v)=>{data.set(k,v);},deleteValue:async k=>{data.delete(k);},listValues:async()=>[...data.keys()]}; }
