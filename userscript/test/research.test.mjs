import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createResearchClient, analyticsLimit } from '../src/research/client.js';
import { researchFixture, memoryGM, base } from './research-fixture.mjs';
import { createSelection } from '../src/research/selection.js';
import { upcomingPeers, calendarWindow } from '../src/research/upcoming.js';
import { createTagHistory,tagDifference,tagObservation,liveTagLimit } from '../src/research/history-store.js';
const compiled = await build({entryPoints:[new URL('../src/research/model.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const model = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
test('analytics pins a manifest, verifies bytes and reuses persistent artifacts', async()=>{
  const fixture=researchFixture(), gm=memoryGM(), requests=[];
  const fetch=async url=>{requests.push(url);return new Response(fixture.files.get(url),{status:fixture.files.has(url)?200:404});};
  await createResearchClient(gm,fetch).get('research-index.json');
  assert.equal(requests.length,2);
  await createResearchClient(gm,fetch).get('research-index.json');
  assert.equal(requests.length,3);assert.equal(requests.at(-1),base+'manifest.json');
  const key=[...gm.data.keys()][0];gm.data.set(key,{text:'corrupt'});
  await createResearchClient(gm,fetch).get('research-index.json');assert.equal(requests.length,5);
  fixture.files.set(base+fixture.manifest.basePath+'/research/years/2025.json',Buffer.from('{}'));
  await assert.rejects(createResearchClient(gm,fetch).get('research/years/2025.json'),/size mismatch/);
  assert.throws(()=>analyticsLimit(base+'releases/test/../../secret.json'));
  assert.throws(()=>analyticsLimit('https://example.org/x.json'));
});
test('niche counts observed zero, drops missing metrics, excludes unknown ages',()=>{
  const fixture=researchFixture(), data=JSON.parse(fixture.files.get(base+'releases/research-test/research/years/2025.json'));
  const games=model.unpackGames(data), all=model.niche(games,1,'all'), aged=model.niche(games,1,'0:12');
  assert.equal(all.stats.selected,4);assert.equal(all.stats.observed,3);assert.equal(all.stats.zeros,1);assert.equal(all.stats.missing,1);
  assert.equal(all.stats.quantiles[1],250);assert.equal(all.stats.thresholds.find(t=>t.threshold===250).rate,2/3);
  assert.equal(aged.stats.selected,3);assert.equal(aged.exclusions.noReleaseDate,1);
});
test('peer context excludes self, other years and unknown prices from USD bands',()=>{
  const game={appid:1,year:2025,price:1000,currency:'USD',reviews:100,tags:[[1,1]],released:20000,observed:20300,ageData:true};
  const peers=Array.from({length:31},(_,i)=>({...game,appid:i+2,reviews:i,price:i===0?500:2000,currency:i===0?null:'USD'}));
  const result=model.peerContext(game,[game,...peers,{...game,appid:100,year:2024}],1,true);
  assert.equal(result.stats.selected,31);assert.equal(result.percentile,1);assert.deepEqual(result.priceBand,[2000,2000]);assert.equal(result.prices,30);
  assert.equal(model.peerContext(game,peers.slice(0,2),1,true).percentile,null);
});
test('comparison stores each app separately and enforces the selection limit',async()=>{
  const gm=memoryGM(),a=createSelection(gm),b=createSelection(gm);
  await Promise.all([a.set(10,true),b.set(11,true)]);assert.deepEqual(await a.list(),[10,11]);
  await b.set(10,false);assert.deepEqual(await a.list(),[11]);
  for(let id=20;id<31;id++)await a.set(id,true);
  await assert.rejects(a.set(40,true),/up to 12/);await assert.rejects(a.set(-1,true),/Invalid/);
});
test('release windows preserve broad dates, omit self and separate unknown dates',()=>{
  const fixture=researchFixture(),data=JSON.parse(fixture.files.get(base+'releases/research-test/upcoming.json'));
  assert.deepEqual(upcomingPeers(data,10,1,'2026-12',1,false).map(g=>g.appid),[11]);
  assert.deepEqual(upcomingPeers(data,10,1,'2026-12',1,true).map(g=>g.appid),[11,12]);
  assert.deepEqual(calendarWindow('2026-12',3),{from:'2026-12-01',to:'2027-03-01'});
  assert.throws(()=>calendarWindow('2026-13',1));
});
test('tag history compares ranks by ID and retains the last snapshot on failure',async()=>{
  const gm=memoryGM();let data={appid:10,type:'game',name:'Test',tags:[{tagid:1,name:'One'},{tagid:2,name:'Two'}]};
  const history=createTagHistory(gm,async()=>new Response(JSON.stringify(data)));
  const first=await history.check(10);assert.equal(first.previous,null);
  data.tags=[{tagid:2,name:'Two'},{tagid:3,name:'Three'}];
  const second=await history.check(10),diff=tagDifference(second.previous,second.current);
  assert.equal(diff.added[0].id,3);assert.equal(diff.removed[0].id,1);assert.equal(diff.moved[0].previous,2);
  data.tags=[];await assert.rejects(history.check(10),/previous observation was kept/);assert.deepEqual(await history.read(10),second);
  assert.throws(()=>tagObservation(11,{...data,tags:[{tagid:1,name:'A'}]}));
  assert.throws(()=>liveTagLimit('https://example.org/app/10?fresh=1'));
  await history.remove(10);assert.equal(await history.read(10),null);
});
