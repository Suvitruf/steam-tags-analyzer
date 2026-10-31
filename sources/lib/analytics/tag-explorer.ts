import { getTagsSummary, getTagDetail } from './data';
import { getReviewThreshold } from './review-threshold';
import { thresholdSummary, thresholdDetail, type ThresholdSummary, type ThresholdTag } from './threshold-data';
import { columnChart, lineChart, SERIES_1, SERIES_2 } from './charts';
import { el, fmtInt, fmtCompact, fmtPct, fmtLift, histBucketLabel } from './format';

type SortKey = 'name' | 'count' | 'releases365' | 'medianReviews' | 'rate' | 'lift' | 'love';

const sortValue: Record<SortKey, (t: ThresholdTag) => number | string> = {
  name: t => t.name.toLowerCase(),
  count: t => t.count,
  releases365: t => t.releases365,
  medianReviews: t => t.medianReviews,
  rate: t => t.rate,
  lift: t => (t.lift??0),
  love: t => t.love ?? 0,
};

// Keep the layout breadcrumb in sync with the client-side route: on a tag
// detail page "Tag Explorer" becomes a link back to the list and the tag name
// is appended as the current crumb.
function setBreadcrumb(tagName: string | null): void {
  const crumb = document.querySelector<HTMLElement>('#breadcrumb-current');
  if (!crumb) return;
  if (!crumb.dataset.baseTitle) crumb.dataset.baseTitle = crumb.textContent ?? '';

  crumb.replaceChildren();
  if (tagName === null) {
    crumb.textContent = crumb.dataset.baseTitle;
  } else {
    const back = el('a', undefined, crumb);
    back.href = '#';
    back.textContent = crumb.dataset.baseTitle;
    const sep = el('span', 'crumb-sep', crumb);
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = ' › ';
    const current = el('span', undefined, crumb);
    current.textContent = tagName;
  }
}

export async function initTagExplorer(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading tag data…';
  let summary: ThresholdSummary;
  try {
    summary = await thresholdSummary(await getTagsSummary(),getReviewThreshold());
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const listView = el('div', 'tag-list-view', root);
  const detailView = el('div', 'tag-detail-view', root);

  buildList(listView, summary);

  const route = () => {
    const id = parseInt(location.hash.slice(1), 10);
    const tag = summary.tags.find(t => t.id === id);
    setBreadcrumb(tag?.name ?? null);
    if (tag) {
      listView.style.display = 'none';
      detailView.style.display = '';
      void renderDetail(detailView, tag, summary);
      window.scrollTo(0, 0);
    } else {
      detailView.style.display = 'none';
      listView.style.display = '';
    }
  };
  window.addEventListener('hashchange', route);
  route();
}

function buildList(view: HTMLElement, summary: ThresholdSummary): void {
  const threshold=summary.threshold;
  const intro = el('p', 'analytics-intro', view);
  intro.textContent =
    `Every stat below is relative and review-based — no revenue estimates. ` +
    `"Hit rate" = share of a tag's games reaching ${threshold}+ reviews (Steam-wide baseline: ${fmtPct(summary.baselineRate)}). ` +
    `Universe: ${fmtInt(summary.gameCount)} released games. Updated ${summary.generatedAt.slice(0, 10)}.`;

  const controls = el('div', 'analytics-controls', view);
  const search = el('input', 'tag-search', controls);
  search.type = 'search';
  search.placeholder = 'Filter tags…';
  search.setAttribute('aria-label', 'Filter tags');

  const table = el('table', 'tag-table', view);
  const thead = el('thead', undefined, table);
  const headRow = el('tr', undefined, thead);
  const columns: Array<{ key: SortKey; label: string; title?: string }> = [
    { key: 'name', label: 'Tag' },
    { key: 'count', label: 'Games' },
    { key: 'releases365', label: 'Last 365d', title: 'Games released in the last 365 days' },
    { key: 'medianReviews', label: 'Median reviews' },
    { key: 'rate', label: 'Hit rate', title: `Share of games reaching ${threshold}+ reviews` },
    { key: 'lift', label: 'vs Steam avg', title: 'Hit rate relative to the all-Steam baseline' },
    { key: 'love', label: 'Positive', title: 'Average positive-review ratio (Bayesian-adjusted, ≥10-review games) — observed review reception' },
  ];
  let sortKey: SortKey = 'count';
  let sortDesc = true;

  for (const col of columns) {
    const th = el('th', undefined, headRow);
    const btn = el('button', 'tag-sort', th);
    btn.textContent = col.label;
    if (col.title) btn.title = col.title;
    btn.addEventListener('click', () => {
      if (sortKey === col.key) sortDesc = !sortDesc;
      else { sortKey = col.key; sortDesc = col.key !== 'name'; }
      render();
    });
  }
  const tbody = el('tbody', undefined, table);

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const rows = summary.tags
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = sortValue[sortKey](a);
        const vb = sortValue[sortKey](b);
        const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sortDesc ? -cmp : cmp;
      });

    tbody.replaceChildren();
    for (const t of rows) {
      const tr = el('tr', undefined, tbody);
      const nameCell = el('td', undefined, tr);
      const link = el('a', 'tag-link', nameCell);
      link.href = `#${t.id}`;
      link.textContent = t.name;
      const smallN = t.count < 30;
      if (smallN) tr.classList.add('is-small-sample');

      el('td', 'num', tr).textContent = fmtInt(t.count);
      el('td', 'num', tr).textContent = fmtInt(t.releases365);
      el('td', 'num', tr).textContent = fmtInt(t.medianReviews);
      el('td', 'num', tr).textContent = fmtPct(t.rate);
      el('td', 'num', tr).textContent = smallN || t.lift===null ? '—' : fmtLift(t.lift);
      // != null also catches `undefined` from a stale cached summary that
      // predates the love field (same schema-rollout rule as the detail view)
      el('td', 'num', tr).textContent = t.love != null && t.rated >= 30 ? fmtPct(t.love, 0) : '—';
    }
  };
  search.addEventListener('input', render);
  render();
}

function statTile(parent: Element, label: string, value: string, note?: string): void {
  const tile = el('div', 'stat-tile', parent);
  el('div', 'stat-label', tile).textContent = label;
  el('div', 'stat-value', tile).textContent = value;
  if (note) el('div', 'stat-note', tile).textContent = note;
}

// Guards against overlapping renders (rapid hash changes): only the latest
// call may keep writing into the view after its awaits resolve.
let renderSeq = 0;

async function renderDetail(view: HTMLElement, tag: ThresholdTag, summary: ThresholdSummary): Promise<void> {
  const threshold=summary.threshold;
  const seq = ++renderSeq;
  view.replaceChildren();

  const back = el('a', 'tag-back', view);
  back.href = '#';
  back.textContent = '← All tags';

  const h = el('h2', 'tag-heading', view);
  h.textContent = tag.name;

  view.appendChild(el('p', 'analytics-loading')).textContent = 'Loading…';
  let detail;
  try {
    detail = await thresholdDetail(await getTagDetail(tag.id),getReviewThreshold());
  } catch (err) {
    view.lastElementChild!.textContent = `Failed to load tag data: ${(err as Error).message}`;
    return;
  }
  if (seq !== renderSeq) return; // a newer navigation superseded this render
  view.querySelector('.analytics-loading')?.remove();

  // stat tiles
  const tiles = el('div', 'stat-row', view);
  statTile(tiles, 'Games', fmtCompact(detail.count));
  statTile(tiles, 'Released last 365d', fmtCompact(detail.releases365));
  statTile(tiles, 'Median reviews', fmtInt(detail.medianReviews));
  statTile(tiles, `Reach ${threshold}+ reviews`, fmtPct(tag.rate),
    tag.lift===null?'No baseline games reached this threshold':tag.count >= 30 ? `${fmtLift(tag.lift)} the Steam average (${fmtPct(summary.baselineRate)})` : 'small sample — read with care');

  // player love: how forgiving this tag's audience reviews.
  // != null (loose) also skips `undefined` from a stale cached JSON that
  // predates this field — schema rollout must never crash the page.
  if (detail.love != null && detail.rated >= 30 && summary.baseline.love != null) {
    const delta = detail.love - summary.baseline.love;
    const mood =
      delta >= 0.03 ? 'above-average reception' :
      delta <= -0.03 ? 'below-average reception' : 'near-average reception';
    statTile(tiles, 'Positive reviews', fmtPct(detail.love, 0),
      `${mood} (Steam average ${fmtPct(summary.baseline.love, 0)})`);
  }

  if (detail.count < 30) {
    el('p', 'small-sample-warning', view).textContent =
      `Only ${detail.count} games carry this tag — every number on this page is a small sample.`;
  }

  // review distribution
  const distSection = el('section', 'viz-section', view);
  el('h3', undefined, distSection).textContent = 'Review-count distribution';
  el('p', 'viz-caption', distSection).textContent =
    'How many reviews games with this tag actually have (log-scale buckets). Includes games with observed review counts, including zeros; missing counts are excluded.';
  const usedBuckets = detail.histogram.length;
  columnChart(distSection, {
    categories: Array.from({ length: usedBuckets }, (_, i) => histBucketLabel(i)),
    series: [{ name: 'Games', color: SERIES_1, values: detail.histogram }],
    directLabelMax: true,
  });

  // tag rank distribution (the data nobody else has)
  const rankSection = el('section', 'viz-section', view);
  el('h3', undefined, rankSection).textContent = 'Where games put this tag';
  el('p', 'viz-caption', rankSection).textContent =
    `Position of this tag in each game's tag list. Compare all games with games that reached ${threshold}+ reviews.`;
  const totalAll = detail.ranks.all.reduce((a, b) => a + b, 0) || 1;
  const totalHits = detail.ranks.hits.reduce((a, b) => a + b, 0) || 1;
  columnChart(rankSection, {
    categories: detail.ranks.buckets.map(b => `rank ${b}`),
    series: [
      { name: 'All games', color: SERIES_1, values: detail.ranks.all.map(v => (v / totalAll) * 100) },
      { name: `${threshold}+ reviews`, color: SERIES_2, values: detail.ranks.hits.map(v => (v / totalHits) * 100) },
    ],
    valueFormat: v => `${Math.round(v)}%`,
    labelEvery: 1,
    height: 160,
  });

  // trends (two small multiples — never a dual axis)
  const years = Object.keys(detail.byYear).map(Number).sort((a, b) => a - b);
  if (years.length >= 3) {
    const currentYear = new Date().getFullYear();
    const trendSection = el('section', 'viz-section', view);
    el('h3', undefined, trendSection).textContent = 'Releases and hits per year';
    el('p', 'viz-caption', trendSection).textContent =
      `Games tagged ${tag.name} by release year, and how many of them reached ${threshold}+ reviews` +
      `${years[years.length - 1] === currentYear ? ` (${currentYear} is partial)` : ''}.`;
    columnChart(trendSection, {
      categories: years.map(String),
      series: [
        { name: 'Releases', color: SERIES_1, values: years.map(y => detail.byYear[y][0]) },
        { name: `Reached ${threshold}+ reviews`, color: SERIES_2, values: years.map(y => detail.byYear[y][1]) },
      ],
      height: 170,
    });

    const hitSection = el('section', 'viz-section', view);
    el('h3', undefined, hitSection).textContent = 'Hit rate by release-year cohort';
    el('p', 'viz-caption', hitSection).textContent =
      `Share of each year's releases that reached ${threshold}+ reviews. Recent cohorts have had less time to accumulate reviews.`;
    lineChart(hitSection, {
      categories: years.map(String),
      values: years.map(y => {
        const [rel, hits] = detail.byYear[y];
        return rel > 0 ? (hits / rel) * 100 : 0;
      }),
      seriesName: `% reaching ${threshold}+ reviews`,
      valueFormat: v => `${Math.round(v)}%`,
      height: 150,
    });
  }

  // related tags with lift
  if (detail.related.length > 0) {
    const relSection = el('section', 'viz-section', view);
    el('h3', undefined, relSection).textContent = 'Tags that over-perform in this segment';
    el('p', 'viz-caption', relSection).textContent =
      `Among games whose main tag is ${tag.name}, these tags appear disproportionately often on the top performers. ` +
      `Lift is confidence-weighted; n = games in segment carrying the tag. Praise-flavored tags (Great Soundtrack, ` +
      `Classic…) are added by players after success — treat their lift as an effect, not a cause. This segment lift uses percentile-based scoring independently of the selected review threshold.`;
    const relTable = el('table', 'tag-table related-table', relSection);
    const rthead = el('thead', undefined, relTable);
    const rtr = el('tr', undefined, rthead);
    for (const label of ['Tag', 'Lift among top performers', 'n']) {
      el('th', undefined, rtr).textContent = label;
    }
    const rtbody = el('tbody', undefined, relTable);
    for (const r of detail.related) {
      const tr = el('tr', undefined, rtbody);
      const td = el('td', undefined, tr);
      const link = el('a', 'tag-link', td);
      link.href = `#${r.id}`;
      link.textContent = r.name;
      el('td', 'num', tr).textContent = fmtLift(r.lift);
      el('td', 'num', tr).textContent = fmtInt(r.n);
    }
  }

  // publisher lens — honest framings only (docs/analytics-phase2.md §C):
  // publishers SELECT promising games, so the gap is mostly selection, never
  // present it as "get a publisher → success".
  const sp = detail.selfPub;
  const pub = detail.published;
  if (sp && pub && sp.n >= 50 && pub.n >= 30) {
    const pubSection = el('section', 'viz-section', view);
    el('h3', undefined, pubSection).textContent = 'Publisher-name groups at this review threshold';
    const totalHits = sp.hits + pub.hits;
    const pubShare = totalHits > 0 ? pub.hits / totalHits : 0;
    const rows = el('div', 'stat-row', pubSection);
    statTile(rows, 'Matching developer/publisher names', fmtPct(sp.hits / sp.n),
      `of ${fmtCompact(sp.n)} games with matching names reached ${threshold}+ reviews`);
    statTile(rows, 'Different names: share of threshold games', fmtPct(pubShare, 0),
      `${fmtCompact(pub.n)} games with different names reach ${threshold}+ at ${fmtPct(pub.hits / Math.max(pub.n, 1))}`);
    el('p', 'viz-caption', pubSection).textContent =
      'Names are a proxy, not verified publishing or funding arrangements. Differences are observational and do not measure the effect of hiring a publisher.';
  }

  // top games
  if (detail.topGames.length > 0) {
    const topSection = el('section', 'viz-section', view);
    el('h3', undefined, topSection).textContent = 'Most-reviewed games with this tag';
    const list = el('ol', 'top-games', topSection);
    for (const g of detail.topGames) {
      const li = el('li', undefined, list);
      const a = el('a', undefined, li);
      a.href = `https://store.steampowered.com/app/${g.appid}/`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = g.name;
      const span = el('span', 'top-games-reviews', li);
      span.textContent = ` — ${fmtCompact(g.reviews)} reviews`;
    }
  }

  // cross-link to the analyzer (relative so the site baseurl is preserved),
  // prefilled with this tag as the main genre/tag
  const cta = el('p', 'analytics-cta', view);
  const ctaLink = el('a', undefined, cta);
  ctaLink.href = `../analyzer?tag=${encodeURIComponent(tag.name)}`;
  ctaLink.textContent = 'Making a game like this? Get tag recommendations →';
}
