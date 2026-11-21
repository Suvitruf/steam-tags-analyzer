import { niche, unpackGames } from './model.ts';
import { el, select, table, stat, number, percent, action, link } from './ui.js';

export function currentTagId(doc = document) {
  try {
    const data = JSON.parse(doc.querySelector('[data-ch_hub_data]')?.getAttribute('data-ch_hub_data') ?? 'null');
    return data?.strHubType === 'tags' && Number.isSafeInteger(data.nTagID) && data.nTagID > 0 ? data.nTagID : null;
  } catch { return null; }
}
export async function tagPanel(root, client, url, tagId) {
  const [index, manifest] = await Promise.all([client.get('research-index.json'), client.getManifest()]);
  let name; try { name = decodeURIComponent(url.pathname.split('/')[3] ?? '').replaceAll('+',' '); } catch { name = ''; }
  const tag = index.tags.find(t => t.id === tagId) ?? index.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
  const controls = el('div', null, root, 'controls');
  const choice = select(controls, 'Tag', [['','Choose a tag'], ...index.tags.map(t=>[t.id,t.name])], tag?.id ?? '');
  const years = index.years.filter(y=>y.year !== null).sort((a,b)=>b.year-a.year);
  const options = years.map(y=>[y.year,y.year]);
  const from = select(controls, 'From year', options, index.defaultYear), to = select(controls, 'Through year', options, index.defaultYear);
  const age = select(controls, 'Age at review observation', [['all','Any age'],['0:12','0–12 months'],['12:36','12–36 months'],['36:1200','36+ months']], 'all');
  el('p', `Snapshot ${manifest.generatedAt.slice(0,10)}. Released games carrying the tag in their first 20 positions. Zero reviews are included; missing observations are excluded from review statistics.`, root, 'note');
  const output = el('div', null, root);
  const render = async () => {
    if (!choice.value) throw Error('Choose a tag.');
    if (+from.value > +to.value) throw Error('The first year must not be after the last year.');
    const rows = [];
    for (const year of years.filter(y=>y.year>=+from.value && y.year<=+to.value)) rows.push(...unpackGames(await client.get(year.file)));
    const result = niche(rows, +choice.value, age.value), {stats} = result;
    output.replaceChildren();
    const cards = el('div', null, output, 'stats');
    stat(cards, 'Games with observed reviews', number(stats.observed));
    stat(cards, 'Median reviews', number(stats.quantiles[1]));
    stat(cards, 'Middle 50% of games', `${number(stats.quantiles[0])}–${number(stats.quantiles[2])} reviews`);
    stat(cards, 'Top five share of reviews', percent(result.topFiveShare));
    el('p', `${stats.selected} games selected; ${stats.missing} missing review counts; ${stats.zeros} observed zero counts. ${result.exclusions.candidates-result.exclusions.kept} excluded by the age window (including missing dates).`, output, 'note');
    if (stats.observed < 30) el('p', 'Small sample: fewer than 30 observed games. Rates are descriptive and unstable.', output);
    table(output, ['Review threshold','Games','Share (95% interval)'], stats.thresholds.filter(t=>[250,1000].includes(t.threshold)).map(t=>[`${t.threshold}+`,`${t.hits} / ${t.n}`,`${percent(t.rate)} (${t.interval?.map(percent).join('–') ?? 'Unknown'})`]));
    const byYear = new Map();
    for (const game of result.selected) byYear.set(game.year,(byYear.get(game.year)??0)+1);
    table(output, ['Release year','Games in this selection'], [...byYear].sort((a,b)=>a[0]-b[0]));
    el('h3', 'Other tags in the top five', output);
    table(output,['Tag','Games'],result.related.map(([id,n])=>[index.tags.find(t=>t.id===id)?.name??`Tag ${id}`,`${n} / ${stats.selected}`]));
    el('p', 'Review totals are measured at each game’s observation, not at one fixed age. Shared tags do not establish that a tag causes better results.', output, 'note');
    link(output, 'Explore this niche on Steam Tag Analyzer', `https://steam-tags-analyzer.apanasik.com/benchmarks/?include=${choice.value}&from=${from.value}&to=${to.value}`);
  };
  action(root, 'Apply selection', render);
  if (tag) await render();
  else el('p', 'Choose the tag manually; this page could not be mapped to a dataset tag.', output);
}
