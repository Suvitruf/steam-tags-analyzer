import { test, expect } from '@playwright/test';
import { harness, visit } from './manager.mjs';
import { fixture } from '../fixture.mjs';
import { researchFixture } from '../research-fixture.mjs';
for (const kind of ['violentmonkey','tampermonkey']) test(`${kind}: niche panel is lazy, consistent and cached`, async()=>{
  const h=await harness(kind,await fixture()), data=researchFixture();
  for(const [url,bytes] of data.files) h.extraFiles.set(url,bytes);
  try {
    const page=await h.launch();
    await page.route('https://store.steampowered.com/**',r=>r.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"},body:'<main><div id="application_config" data-ch_hub_data=\'{"strHubType":"tags","nTagID":1}\'></div></main>'}));
    await page.goto('https://store.steampowered.com/tags/ru/test/');
    const panel=page.locator('#steam-tag-research-niche');
    await expect(panel).toBeVisible();expect(h.requests).toHaveLength(0);
    await panel.locator('summary').click();
    await expect(panel).toContainText('4 games selected; 1 missing review counts; 1 observed zero counts.');
    await expect(panel).toContainText('66.7%');
    expect(h.requests).toHaveLength(3);expect(h.requests.every(r=>r.url.includes('/analytics/'))).toBe(true);
    await page.reload();await panel.locator('summary').click();
    await expect(panel).toContainText('4 games selected');expect(h.requests).toHaveLength(4);
    await panel.getByLabel('Age at review observation').selectOption('0:12');
    await panel.getByRole('button',{name:'Apply selection'}).click();
    await expect(panel).toContainText('3 games selected; 0 missing review counts');
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {await h.close();}
});
for(const kind of ['violentmonkey','tampermonkey'])test(`${kind}: local tag history records changes and survives Steam failures`,async()=>{
  const h=await harness(kind,await fixture()),url='https://steam-tags-api.aapanasik.com/app/10?fresh=1';
  const publish=tags=>h.extraFiles.set(url,Buffer.from(JSON.stringify({appid:10,type:'game',name:'Game 10',tags,fetched_at:'2026-11-20T00:00:00Z'})));
  publish([{tagid:1,name:'One'},{tagid:2,name:'Two'}]);
  try{
    const page=await h.launch();await visit(page,10);const panel=page.locator('#steam-tag-research-history');
    await panel.locator('summary').click();await expect(panel).toContainText('First observation saved');
    publish([{tagid:2,name:'Two'},{tagid:3,name:'<img src=x onerror=alert(1)>'}]);
    await page.reload();await panel.locator('summary').click();
    await expect(panel).toContainText('Entered top 20');await expect(panel).toContainText('Left top 20');await expect(panel).toContainText('Moved');
    await expect(panel.locator('img')).toHaveCount(0);
    publish([]);await panel.getByRole('button',{name:'Check current tags',exact:true}).click();
    await expect(panel).toContainText('previous observation was kept');await expect(panel).toContainText('Entered top 20');
    expect(h.requests.every(r=>r.url===url)).toBe(true);
    await panel.getByRole('button',{name:'Forget local tag history'}).click();await expect(panel).toContainText('No saved observation yet.');
  }finally{await h.close();}
});
for(const kind of ['violentmonkey','tampermonkey'])test(`${kind}: upcoming calendar is explicit and preserves date precision`,async()=>{
  const h=await harness(kind,await fixture()),data=researchFixture();
  for(const [url,bytes]of data.files)h.extraFiles.set(url,bytes);
  try{
    const page=await h.launch();await visit(page,10);
    await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div class="game_area_comingsoon">Coming soon</div>'));
    const panel=page.locator('#steam-tag-research-upcoming');await panel.locator('summary').click();
    await expect(panel).toContainText('MB of JSON');expect(h.requests).toHaveLength(1);
    await panel.getByRole('button',{name:'Load release calendar'}).click();
    await expect(panel).toContainText('1 known announcements overlap the window. 0 undated');
    await expect(panel.getByRole('link',{name:'Upcoming 11',exact:true})).toBeVisible();
    await expect(panel).not.toContainText('Upcoming 13');
    await panel.getByLabel('Also show undated games').check();await panel.getByRole('button',{name:'Find upcoming peers'}).click();
    await expect(panel).toContainText('Undated — not assigned to this window');expect(h.requests).toHaveLength(2);
  }finally{await h.close();}
});
for(const kind of ['violentmonkey','tampermonkey'])test(`${kind}: publisher portfolio matches credits and filters tags`,async()=>{
  const h=await harness(kind,await fixture()),data=researchFixture();
  for(const [url,bytes]of data.files)h.extraFiles.set(url,bytes);
  try{
    const page=await h.launch();
    await page.route('https://store.steampowered.com/**',r=>r.fulfill({contentType:'text/html',body:'<main><div id="curator_header_area_ctn_id"><h2 class="curator_name"> FIXTURE   Publisher </h2></div></main>'}));
    await page.goto('https://store.steampowered.com/publisher/fixture/');
    const panel=page.locator('#steam-tag-research-publisher');await expect(panel).toBeVisible();expect(h.requests).toHaveLength(0);
    await panel.locator('summary').click();await expect(panel).toContainText('2 released games in this publisher’s observed catalog');
    await expect(panel).not.toContainText('Do not include');
    await panel.getByLabel('Portfolio niche').selectOption('2');await panel.getByRole('button',{name:'Look up portfolio'}).click();
    await expect(panel).toContainText('1 in the selected niche');
    expect(h.requests).toHaveLength(3);
  }finally{await h.close();}
});
for (const kind of ['violentmonkey','tampermonkey']) test(`${kind}: search selection persists and compares without a model`, async()=>{
  const h=await harness(kind,await fixture()),data=researchFixture();
  for(const [url,bytes] of data.files)h.extraFiles.set(url,bytes);
  try {
    const page=await h.launch();
    await page.route('https://store.steampowered.com/**',r=>r.fulfill({contentType:'text/html',body:'<main><div class="searchbar">Search</div><div id="search_results"><a class="search_result_row" href="/app/10/">Game 10</a></div></main>'}));
    await page.goto('https://store.steampowered.com/search/?tags=1');
    await page.getByRole('button',{name:'Add to comparison',exact:true}).click();
    await page.evaluate(()=>document.querySelector('#search_results').insertAdjacentHTML('beforeend','<a class="search_result_row" href="/app/11/">Game 11</a>'));
    await page.getByRole('button',{name:'Add to comparison',exact:true}).click();
    expect(h.requests).toHaveLength(0);
    await page.reload();
    const panel=page.locator('#steam-tag-research-compare');await panel.locator('summary').click();
    await expect(panel).toContainText('2 games selected');
    await panel.getByRole('button',{name:'Compare selected games',exact:true}).click();
    await expect(panel).toContainText('Tag order (top 20)');
    await expect(panel.getByRole('link',{name:'Game 11',exact:true})).toBeVisible();
    expect(h.requests.every(r=>r.url.includes('/analytics/'))).toBe(true);
    await panel.getByRole('button',{name:'Remove 10',exact:true}).click();
    await expect(panel).toContainText('1 games selected');
  } finally {await h.close();}
});
for (const kind of ['violentmonkey','tampermonkey']) test(`${kind}: game context stays separate from model loading`, async()=>{
  const h=await harness(kind,await fixture()), data=researchFixture();
  for(const [url,bytes] of data.files)h.extraFiles.set(url,bytes);
  try {
    const page=await h.launch();await visit(page,10);
    const panel=page.locator('#steam-tag-research-context');
    await expect(panel).toBeVisible();expect(h.requests).toHaveLength(0);
    await panel.locator('summary').click();
    await expect(panel).toContainText('2 other released games from 2025');
    await expect(panel).toContainText('Insufficient data');
    await expect(panel.getByRole('link',{name:'Game 11'})).toBeVisible();
    expect(h.requests.every(r=>r.url.includes('/analytics/'))).toBe(true);
    await visit(page,99);await panel.locator('summary').click();
    await expect(panel).toContainText('This game is absent from the released-game research snapshot.');
    expect(h.requests.some(r=>/\.onnx|\.wasm/.test(r.url))).toBe(false);
  } finally {await h.close();}
});
