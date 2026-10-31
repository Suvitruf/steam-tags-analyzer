import { getTrending, type TrendingFile, type TrendingTag } from './data';
import { columnChart, tableTwin, SERIES_1 } from './charts';
import { el, fmtInt, fmtPct } from './format';
import { analyticsPath } from './coverage';

const HEATING_LIMIT = 20;
const COOLING_LIMIT = 12;
// Above this share of a tag's latest month, "the tag is moving" is really
// "one game is moving" — the row still shows, flagged.
const CONCENTRATION_WARN = 0.5;

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

function fmtChange(chg: number | null): string {
  if (chg === null) return '—';
  const pct = chg * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function steamLink(parent: Element, appid: number, name: string): void {
  const a = el('a', 'tag-link', parent);
  a.href = `https://store.steampowered.com/app/${appid}/`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = name || `App ${appid}`;
}

/** Ranked tag table — shared by the heating-up and cooling-off sections. */
function tagTable(parent: Element, rows: TrendingTag[]): void {
  const table = el('table', 'tag-table', parent);
  const thead = el('thead', undefined, table);
  const headRow = el('tr', undefined, thead);
  const columns: Array<[string, string]> = [
    ['Tag', ''],
    ['Momentum', 'Standard deviations from this tag\'s own trailing norm, measured on its share of observed tracked reviews'],
    ['vs typical', 'Latest month against the median of the trailing window'],
    ['Reviews', 'Reviews collected in the latest complete month'],
    ['Typical', 'Median monthly reviews over the trailing window'],
    ['Games', 'Distinct games that collected a review in the latest month'],
    ['Positive', 'Share of the latest month\'s reviews that were positive (trailing norm in parentheses)'],
    ['Driven by', 'Largest single contributor and its share of the month'],
  ];
  for (const [label, title] of columns) {
    const th = el('th', undefined, headRow);
    th.textContent = label;
    if (title) th.title = title;
  }

  const tbody = el('tbody', undefined, table);
  for (const t of rows) {
    const tr = el('tr', undefined, tbody);
    el('td', undefined, tr).textContent = t.name;

    const zCell = el('td', 'num', tr);
    zCell.textContent = `${t.z >= 0 ? '+' : ''}${t.z.toFixed(1)}σ`;
    zCell.className = `num ${t.z >= 0 ? 'delta-up' : 'delta-down'}`;

    const chgCell = el('td', 'num', tr);
    chgCell.textContent = fmtChange(t.chg);
    if (t.chg !== null) chgCell.className = `num ${t.chg >= 0 ? 'delta-up' : 'delta-down'}`;

    el('td', 'num', tr).textContent = fmtInt(t.revLast);
    el('td', 'num', tr).textContent = fmtInt(t.revBase);
    el('td', 'num', tr).textContent = fmtInt(t.games);
    el('td', 'num', tr).textContent = t.pos !== null
      ? `${fmtPct(t.pos, 0)}${t.posBase !== null ? ` (${fmtPct(t.posBase, 0)})` : ''}`
      : '—';

    const driver = el('td', undefined, tr);
    const top = t.top[0];
    if (top) {
      steamLink(driver, top.appid, top.name);
      const share = el('span', 'trend-share', driver);
      share.textContent = ` ${fmtPct(top.share, 0)}`;
      if (top.share >= CONCENTRATION_WARN) {
        share.classList.add('is-concentrated');
        share.title = 'One game accounts for most of this tag\'s month — potentially one game’s event rather than a broad shift';
        tr.classList.add('is-small-sample');
      }
    } else {
      driver.textContent = '—';
    }
  }
}

function gameTable(parent: Element, headers: string[], rows: Array<[number, string, Array<string | number>]>): void {
  const table = el('table', 'tag-table', parent);
  const thead = el('thead', undefined, table);
  const headRow = el('tr', undefined, thead);
  for (const h of headers) el('th', undefined, headRow).textContent = h;
  const tbody = el('tbody', undefined, table);
  for (const [appid, name, cells] of rows) {
    const tr = el('tr', undefined, tbody);
    steamLink(el('td', undefined, tr), appid, name);
    for (const c of cells) {
      el('td', 'num', tr).textContent = typeof c === 'number' ? fmtInt(c) : c;
    }
  }
}

export async function initTrending(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading trending data…';
  let data: TrendingFile;
  try {
    data = await getTrending();
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';
  const warning=el('p','coverage-warning',root);
  warning.textContent='This legacy aggregate includes histories without source-resolution validation. Weekly rollups may cross month boundaries, and coverage changes over time. It is not a stable-panel growth estimate. For validated calendar-month comparisons, use ';
  const lifecycle=el('a',undefined,warning);lifecycle.href=analyticsPath('lifecycle');lifecycle.textContent='Review Lifecycle';
  warning.append(' or ');const momentum=el('a',undefined,warning);momentum.href=analyticsPath('momentum');momentum.textContent='Validated Momentum';

  const latest = data.months[data.months.length - 1];
  const first = data.months[0];
  const ranked = data.tags.filter(t => t.rankable).sort((a, b) => b.z - a.z);
  const staleShare = data.coverage.eligible > 0 ? data.coverage.pending / data.coverage.eligible : 0;

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `Monthly review activity in the observed history sample. Last included calendar month: ${monthLabel(latest)} ` +
    `(the current month and the newest stored source month are excluded). Each tag's monthly total is expressed as a share ` +
    `of observed reviews among tracked, tagged games, then compared ` +
    `against that tag's own previous ${data.baseMonths} months. `;
  const introCaveat = el('span', 'viz-caption', intro);
  introCaveat.textContent =
    `Reviews are not sales, and a tag can surge because one game launched — the "Driven by" column shows when ` +
    `that is the case. Games with fewer than 10 reviews are not tracked.` +
    (staleShare > 0.05
      ? ` ⚠ ${fmtPct(staleShare, 0)} of tracked games have changed review counts since their last history fetch; the size of the resulting bias is unknown.`
      : '');

  // --- heating up ---
  const heat = el('section', 'viz-section', root);
  el('h3', undefined, heat).textContent = `Heating up — ${monthLabel(latest)}`;
  el('p', 'viz-caption', heat).textContent =
    `Tags whose share of tracked monthly reviews is furthest above their own trailing norm. ` +
    `Only tags with ≥${fmtInt(data.minReviews)} reviews and ≥${data.minGames} active games in the month are ranked ` +
    `(${fmtInt(ranked.length)} of ${fmtInt(data.tags.length)} qualify).`;
  tagTable(heat, ranked.slice(0, HEATING_LIMIT));

  // --- cooling off ---
  const cool = el('section', 'viz-section', root);
  el('h3', undefined, cool).textContent = 'Cooling off';
  el('p', 'viz-caption', cool).textContent =
    `The same ranking from the other end: observed review share declining relative to these tags’ own recent history. ` +
    `A negative month is not a verdict on a genre — check the multi-year shape below before reading much into it.`;
  tagTable(cool, ranked.slice(-COOLING_LIMIT).reverse());

  // --- per-tag history ---
  const detail = el('section', 'viz-section', root);
  el('h3', undefined, detail).textContent = 'Tag history';
  const controls = el('div', 'analytics-controls', detail);
  const tagLabel = el('label', 'combo-label', controls);
  tagLabel.textContent = 'Tag: ';
  const tagSelect = el('select', 'combo-select', controls);
  tagSelect.setAttribute('aria-label', 'Pick a tag to see its monthly review history');
  for (const t of [...data.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', undefined, tagSelect);
    opt.value = String(t.id);
    opt.textContent = t.rankable ? t.name : `${t.name} (small)`;
  }
  if (ranked.length) tagSelect.value = String(ranked[0].id);

  const metricLabel = el('label', 'combo-label', controls);
  metricLabel.textContent = ' Show: ';
  const metricSelect = el('select', 'combo-select', controls);
  metricSelect.setAttribute('aria-label', 'Pick which measure to chart');
  for (const [value, text] of [['share', 'Share of observed tracked reviews'], ['rev', 'Reviews per month']]) {
    const opt = el('option', undefined, metricSelect);
    opt.value = value;
    opt.textContent = text;
  }

  const chartHost = el('div', undefined, detail);
  const labels = data.months.map(monthLabel);

  const renderDetail = () => {
    chartHost.replaceChildren();
    const tag = data.tags.find(t => t.id === parseInt(tagSelect.value, 10));
    if (!tag) return;
    const asShare = metricSelect.value === 'share';
    const values = asShare
      ? tag.rev.map((v, i) => (data.all[i] > 0 ? (v / data.all[i]) * 100 : 0))
      : tag.rev;

    el('p', 'viz-caption', chartHost).textContent = asShare
      ? `${tag.name}'s share of observed reviews in tracked games that month, ${monthLabel(first)}–${monthLabel(latest)}. ` +
        `Latest: ${tag.share.toFixed(2)}% (${fmtChange(tag.chg)} vs the trailing median, ${tag.z >= 0 ? '+' : ''}${tag.z.toFixed(1)}σ).`
      : `Reviews collected per month by ${tag.name} games. Absolute counts follow Steam's own seasonality — ` +
        `use the share view to separate this tag's movement from the platform's.`;

    columnChart(chartHost, {
      categories: labels,
      series: [{ name: asShare ? 'Share of tracked reviews' : 'Reviews', color: SERIES_1, values }],
      valueFormat: asShare ? v => `${v.toFixed(2)}%` : undefined,
      labelEvery: 3,
      height: 200,
    });
    tableTwin(
      chartHost,
      ['Month', asShare ? 'Share of tracked reviews' : 'Reviews'],
      data.months.map((m, i) => [m, asShare ? `${values[i].toFixed(3)}%` : Math.round(values[i])]),
    );

    if (tag.top.length) {
      const drivers = el('p', 'viz-caption', chartHost);
      drivers.textContent = `Biggest contributors in ${monthLabel(latest)}: ` +
        tag.top.map(t => `${t.name} (${fmtInt(t.reviews)}, ${fmtPct(t.share, 0)})`).join(' · ');
    }
  };
  tagSelect.addEventListener('change', renderDetail);
  metricSelect.addEventListener('change', renderDetail);
  renderDetail();

  // --- games behind the movement ---
  if (data.rising.length) {
    const rise = el('section', 'viz-section', root);
    el('h3', undefined, rise).textContent = 'Games picking back up';
    el('p', 'viz-caption', rise).textContent =
      `Established games whose review flow in ${monthLabel(latest)} was far above their trailing median — updates, ` +
      `sales, streamer attention. Debuts are listed separately since a first month has nothing to compare against.`;
    gameTable(rise, ['Game', 'Latest month', 'Typical month', 'Multiple'],
      data.rising.map(g => [g.appid, g.name, [g.last, g.base, `${g.ratio.toFixed(1)}×`]]));
  }

  if (data.debuts.length) {
    const deb = el('section', 'viz-section', root);
    el('h3', undefined, deb).textContent = 'Biggest debuts';
    el('p', 'viz-caption', deb).textContent =
      `Games whose first reviews landed inside this window and that collected the most in ${monthLabel(latest)}.`;
    gameTable(deb, ['Game', 'Reviews in month'], data.debuts.map(g => [g.appid, g.name, [g.last]]));
  }

  const foot = el('p', 'viz-caption', root);
  foot.textContent =
    `Based on ${fmtInt(data.coverage.games)} games with review history, of ${fmtInt(data.coverage.eligible)} tracked. ` +
    `Updated ${new Date(data.generatedAt).toISOString().slice(0, 10)}.`;
}
