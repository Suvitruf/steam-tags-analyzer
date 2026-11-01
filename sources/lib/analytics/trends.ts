import { tagPageUrl } from '../site-path';
import { getReviewThreshold } from './review-threshold';
import { thresholdTrends } from './threshold-data';
import { getTrends, type TrendsFile, type TrendTag } from './data';
import { multiLineChart, SERIES_1, SERIES_2, SERIES_3, SERIES_4 } from './charts';
import { el, fmtInt, fmtPct, fmtLift } from './format';
import { initEqualAgeTrends } from './equal-age';

const SERIES_COLORS = [SERIES_1, SERIES_2, SERIES_3, SERIES_4];
const MAX_COMPARE = 4;
const MIN_RECENT_RELEASES = 30; // sample floor for the risers/fallers tables

interface Momentum {
  tag: TrendTag;
  recentShare: number;   // avg share of all Steam releases, last 2 complete years
  priorShare: number;    // avg share, the 2 years before that
  ratio: number;
  recentReleases: number;
  recentHitRate: number;
}

// Share-of-all-releases controls for Steam's own growth: a tag whose raw
// release count grew 20% while Steam grew 20% didn't actually trend.
function computeMomentum(data: TrendsFile): Momentum[] {
  const { years, baseline } = data;
  const lastComplete = years.length - 2; // current year is partial — exclude
  const recentIdx = [lastComplete - 1, lastComplete];
  const priorIdx = [lastComplete - 3, lastComplete - 2];
  if (priorIdx[0] < 0) return [];

  const share = (t: TrendTag, idx: number[]) => {
    let tagSum = 0;
    let baseSum = 0;
    for (const i of idx) {
      tagSum += t.rel[i] ?? 0;
      baseSum += baseline.rel[i] ?? 0;
    }
    return baseSum > 0 ? tagSum / baseSum : 0;
  };

  return data.tags
    .map(tag => {
      const recentShare = share(tag, recentIdx);
      const priorShare = share(tag, priorIdx);
      const recentReleases = recentIdx.reduce((s, i) => s + (tag.rel[i] ?? 0), 0);
      const recentHits = recentIdx.reduce((s, i) => s + (tag.hits[i] ?? 0), 0);
      return {
        tag,
        recentShare,
        priorShare,
        ratio: priorShare > 0 ? recentShare / priorShare : Infinity,
        recentReleases,
        recentHitRate: recentReleases > 0 ? recentHits / recentReleases : 0,
      };
    })
    .filter(m => m.recentReleases >= MIN_RECENT_RELEASES && m.priorShare > 0);
}

export async function initTrends(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  void initEqualAgeTrends(el('section','viz-section',root));
  const legacy=el('section','viz-section',root);
  el('h2',undefined,legacy).textContent='Platform-wide tag supply and lifetime snapshots';
  el('p','viz-caption',legacy).textContent='The cohort filters above apply to equal-age panels. The platform-wide charts below have their own tag picker and lifetime observation windows.';
  await initLegacyTrends(el('div',undefined,legacy));
}

async function initLegacyTrends(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading trend data…';
  let data: TrendsFile;
  try {
    data = await thresholdTrends(await getTrends(),getReviewThreshold());
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const years = data.years;
  const lastComplete = years[years.length - 2];
  const recentLabel = `${lastComplete - 1}–${lastComplete}`;
  const priorLabel = `${lastComplete - 3}–${lastComplete - 2}`;

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `Which tags are rising or collapsing. "Share" = a tag's slice of ALL Steam releases that year, so Steam's own ` +
    `growth is factored out. Momentum compares ${recentLabel} against ${priorLabel}; ${years[years.length - 1]} is ` +
    `partial and excluded from momentum. Tags with fewer than ${MIN_RECENT_RELEASES} recent releases are hidden. ` +
    `Caveats: release counts before ~2021 partly reflect Valve's tagging-tool changes, and genres run hype cycles ` +
    `shorter than dev cycles — a rising tag now can be saturated by your launch.`;

  const momentum = computeMomentum(data);

  // --- comparison chart with tag picker ---
  const compareSection = el('section', 'viz-section', root);
  el('h3', undefined, compareSection).textContent = 'Compare tags: share of all Steam releases per year';

  const picker = el('div', 'analytics-controls trend-picker', compareSection);
  const select = el('select', 'combo-select', picker);
  select.setAttribute('aria-label', 'Add a tag to the comparison');
  const placeholder = el('option', undefined, select);
  placeholder.value = '';
  placeholder.textContent = 'Add a tag…';
  for (const t of [...data.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', undefined, select);
    opt.value = String(t.id);
    opt.textContent = t.name;
  }
  const chipRow = el('div', 'trend-chips', picker);
  const chartHost = el('div', undefined, compareSection);

  const risers = [...momentum].sort((a, b) => b.ratio - a.ratio);
  let selected: TrendTag[] = risers.slice(0, 3).map(m => m.tag);

  const renderCompare = () => {
    chipRow.replaceChildren();
    for (const t of selected) {
      const chip = el('span', 'trend-chip', chipRow);
      const dot = el('span', 'viz-legend-swatch', chip);
      dot.style.background = SERIES_COLORS[selected.indexOf(t)];
      const name = el('span', undefined, chip);
      name.textContent = t.name;
      const remove = el('button', 'trend-chip-x', chip);
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${t.name}`);
      remove.addEventListener('click', () => {
        selected = selected.filter(s => s !== t);
        renderCompare();
      });
    }

    chartHost.replaceChildren();
    if (selected.length === 0) {
      el('p', 'viz-caption', chartHost).textContent = 'Add tags above to compare their release share over time.';
      return;
    }
    multiLineChart(chartHost, {
      categories: years.map(String),
      series: selected.map((t, i) => ({
        name: t.name,
        color: SERIES_COLORS[i],
        values: years.map((_, yi) => {
          const base = data.baseline.rel[yi] ?? 0;
          return base > 0 ? ((t.rel[yi] ?? 0) / base) * 100 : 0;
        }),
      })),
      valueFormat: v => `${v.toFixed(v < 1 ? 2 : 1)}%`,
    });
  };

  select.addEventListener('change', () => {
    const id = parseInt(select.value, 10);
    const tag = data.tags.find(t => t.id === id);
    select.value = '';
    if (!tag || selected.includes(tag)) return;
    if (selected.length >= MAX_COMPARE) selected = selected.slice(1); // oldest out
    selected = [...selected, tag];
    renderCompare();
  });
  renderCompare();

  // --- risers / fallers tables ---
  const tables = el('div', 'trend-tables', root);
  const buildTable = (title: string, rows: Momentum[], note: string) => {
    const section = el('section', 'viz-section trend-table-col', tables);
    el('h3', undefined, section).textContent = title;
    const table = el('table', 'tag-table', section);
    const thead = el('thead', undefined, table);
    const tr = el('tr', undefined, thead);
    for (const h of ['Tag', `Share ${recentLabel}`, 'vs prior 2y', 'Releases', `${getReviewThreshold()}+ reviews`]) {
      el('th', undefined, tr).textContent = h;
    }
    const tbody = el('tbody', undefined, table);
    for (const m of rows) {
      const row = el('tr', undefined, tbody);
      const cell = el('td', undefined, row);
      const link = el('a', 'tag-link', cell);
      link.href = tagPageUrl(m.tag.id, m.tag.name, getReviewThreshold());
      link.textContent = m.tag.name;
      el('td', 'num', row).textContent = fmtPct(m.recentShare, 2);
      const ratioCell = el('td', 'num', row);
      ratioCell.textContent = fmtLift(m.ratio);
      ratioCell.classList.add(m.ratio >= 1 ? 'combo-up' : 'combo-down');
      el('td', 'num', row).textContent = fmtInt(m.recentReleases);
      el('td', 'num', row).textContent = fmtPct(m.recentHitRate);
    }
    el('p', 'viz-caption', section).textContent = note;
  };

  buildTable('Rising tags', risers.slice(0, 15),
    'Biggest gains in release share. Rising supply means competition is coming — check the hit rate before following the crowd.');
  buildTable('Declining tags', [...momentum].sort((a, b) => a.ratio - b.ratio).slice(0, 15),
    'Shrinking release share. A decline with a healthy hit rate can be an underserved niche opening up.');
}
