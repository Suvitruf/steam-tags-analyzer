import { getReviewThreshold } from './review-threshold';
import { thresholdTiming } from './threshold-data';
import { getTiming, type TimingFile, type TimingTag } from './data';
import { columnChart, lineChart, multiLineChart, SERIES_1, SERIES_2 } from './charts';
import { el, fmtInt, fmtPct } from './format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN_MONTH_RELEASES = 20; // a month's hit-rate below this sample is noise

function hitRates(rel: number[], hits: number[]): number[] {
  return rel.map((r, i) => (r > 0 ? (hits[i] / r) * 100 : 0));
}

export async function initTiming(root: HTMLElement): Promise<void> {
  const threshold=getReviewThreshold();
  root.textContent = 'Loading timing data…';
  let data: TimingFile;
  try {
    data = await thresholdTiming(await getTiming(),threshold);
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const [y0, y1] = data.years;
  const totalRel = data.all.rel.reduce((s, v) => s + v, 0);

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `When games release, and how often each month's releases succeed — ${fmtInt(totalRel)} games ` +
    `released ${y0}–${y1} (complete years only, full dates only). "Hit rate" = share reaching ${threshold}+ reviews. ` +
    `Caveats: correlation, not causation — a month's rate mixes crowding, seasonal sales, and what kinds of ` +
    `games choose it; the most recent December has also had the least time to accumulate reviews.`;

  const controls = el('div', 'analytics-controls', root);
  const label = el('label', 'combo-label', controls);
  label.textContent = 'Show: ';
  const select = el('select', 'combo-select', controls);
  select.setAttribute('aria-label', 'Pick a tag for its release timing');
  const optAll = el('option', undefined, select);
  optAll.value = '';
  optAll.textContent = 'All selected games';
  for (const t of [...data.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', undefined, select);
    opt.value = String(t.id);
    opt.textContent = t.name;
  }

  const host = el('div', undefined, root);

  const render = () => {
    host.replaceChildren();
    const tag: TimingTag | null = select.value === ''
      ? null
      : data.tags.find(t => t.id === parseInt(select.value, 10)) ?? null;
    const rel = tag ? tag.rel : data.all.rel;
    const hits = tag ? tag.hits : data.all.hits;
    const subject = tag ? tag.name : 'all selected games';

    const relSection = el('section', 'viz-section', host);
    el('h3', undefined, relSection).textContent = `Releases by month — ${subject}`;
    el('p', 'viz-caption', relSection).textContent =
      tag
        ? `When ${tag.name} games launched, ${y0}–${y1} (${fmtInt(rel.reduce((s, v) => s + v, 0))} releases).`
        : `October–November carry the pre-holiday rush; the count alone says nothing about success.`;
    columnChart(relSection, {
      categories: MONTHS,
      series: [{ name: 'Releases', color: SERIES_1, values: rel }],
      labelEvery: 1,
      height: 170,
    });

    const hitSection = el('section', 'viz-section', host);
    el('h3', undefined, hitSection).textContent = `Hit rate by month — ${subject}`;
    const small = tag ? MONTHS.filter((_, i) => rel[i] < MIN_MONTH_RELEASES) : [];
    el('p', 'viz-caption', hitSection).textContent =
      `Share of each month's ${y0}–${y1} releases that reached ${threshold}+ reviews.` +
      (tag ? ` The gray line is the selected-population baseline.` : '') +
      (small.length ? ` ⚠ Months with <${MIN_MONTH_RELEASES} releases (${small.join(', ')}) are noise.` : '');

    if (tag) {
      multiLineChart(hitSection, {
        categories: MONTHS,
        series: [
          { name: tag.name, color: SERIES_1, values: hitRates(tag.rel, tag.hits) },
          { name: 'All selected games', color: SERIES_2, values: hitRates(data.all.rel, data.all.hits) },
        ],
        valueFormat: v => `${v.toFixed(1)}%`,
        height: 200,
      });
    } else {
      lineChart(hitSection, {
        categories: MONTHS,
        values: hitRates(data.all.rel, data.all.hits),
        seriesName: `% reaching ${threshold}+ reviews`,
        valueFormat: v => `${v.toFixed(1)}%`,
        height: 200,
      });
    }
  };

  select.addEventListener('change', render);
  render();
}
