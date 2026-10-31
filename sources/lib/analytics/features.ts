import { getFeatures, type FeaturesFile, type FeatureTag, type FeatureCell } from './data';
import { columnChart, tableTwin, SERIES_1, SERIES_2 } from './charts';
import { el, fmtInt, fmtPct } from './format';

interface Row {
  label: string;
  outcome: boolean;
  withN: number;
  withRate: number;
  withoutN: number;
  withoutRate: number;
  ratio: number;
  small: boolean;
}

function buildRows(file: FeaturesFile, subject: { rated: number; hits: number; flags: FeatureCell[] }): Row[] {
  return file.flags.map((f, i) => {
    const [withN, withHits] = subject.flags[i];
    const withoutN = subject.rated - withN;
    const withoutHits = subject.hits - withHits;
    const withRate = withN > 0 ? withHits / withN : 0;
    const withoutRate = withoutN > 0 ? withoutHits / withoutN : 0;
    return {
      label: f.label,
      outcome: f.outcome,
      withN, withRate, withoutN, withoutRate,
      ratio: withoutRate > 0 ? withRate / withoutRate : 0,
      small: withN < file.minN || withoutN < file.minN,
    };
  });
}

function rowTable(parent: Element, rows: Row[], threshold: number): void {
  const table = el('table', 'tag-table', parent);
  const thead = el('thead', undefined, table);
  const head = el('tr', undefined, thead);
  const cols: Array<[string, string]> = [
    ['Feature', ''],
    ['With', `Games carrying the feature that reached ${threshold}+ reviews`],
    ['n', 'Games carrying the feature'],
    ['Without', `Games without it that reached ${threshold}+ reviews`],
    ['n', 'Games without the feature'],
    ['Ratio', 'With-rate divided by without-rate. Association only.'],
  ];
  for (const [label, title] of cols) {
    const th = el('th', undefined, head);
    th.textContent = label;
    if (title) th.title = title;
  }
  const tbody = el('tbody', undefined, table);
  for (const r of rows) {
    const tr = el('tr', undefined, tbody);
    if (r.small) tr.classList.add('is-small-sample');
    el('td', undefined, tr).textContent = r.label;
    el('td', 'num', tr).textContent = r.withN > 0 ? fmtPct(r.withRate, 1) : '—';
    el('td', 'num', tr).textContent = fmtInt(r.withN);
    el('td', 'num', tr).textContent = r.withoutN > 0 ? fmtPct(r.withoutRate, 1) : '—';
    el('td', 'num', tr).textContent = fmtInt(r.withoutN);
    const ratio = el('td', 'num', tr);
    ratio.textContent = r.small || r.ratio === 0 ? '—' : `${r.ratio.toFixed(2)}×`;
    if (!r.small && r.ratio !== 0) ratio.className = `num ${r.ratio >= 1 ? 'delta-up' : 'delta-down'}`;
  }
}

export async function initFeatures(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading feature data…';
  let data: FeaturesFile;
  try {
    data = await getFeatures();
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const intro = el('p', 'analytics-intro', root);
  intro.textContent = `Store-declared features and lifetime review outcomes among games with at least ten reviews and usable category metadata (${fmtInt(data.all.rated)} games). Unknown metadata is excluded; absence means not declared in the observed snapshot.`;
  el('p', 'viz-caption', root).textContent = 'These comparisons are associations. Budget, age, genre, and other differences can affect both features and outcomes. They do not estimate development payoff or audience size.';

  const controls = el('div', 'analytics-controls', root);
  const label = el('label', 'combo-label', controls);
  label.textContent = 'Tag: ';
  const select = el('select', 'combo-select', controls);
  select.setAttribute('aria-label', 'Pick a tag to compare features within it');
  const optAll = el('option', undefined, select);
  optAll.value = '';
  optAll.textContent = 'All Steam';
  for (const t of [...data.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', undefined, select);
    opt.value = String(t.id);
    opt.textContent = `${t.name} (${fmtInt(t.rated)})`;
  }

  const host = el('div', undefined, root);

  const render = () => {
    host.replaceChildren();
    const tag: FeatureTag | null = select.value === ''
      ? null
      : data.tags.find(t => t.id === parseInt(select.value, 10)) ?? null;
    const subject = tag ?? data.all;
    const name = tag ? tag.name : 'all Steam';
    const rows = buildRows(data, subject);
    const choices = rows.filter(r => !r.outcome);
    const outcomes = rows.filter(r => r.outcome);

    const main = el('section', 'viz-section', host);
    el('h3', undefined, main).textContent = `Features vs success — ${name}`;
    el('p', 'viz-caption', main).textContent =
      `${fmtInt(subject.rated)} games with 10+ reviews, of which ${fmtInt(subject.hits)} ` +
      `(${subject.rated ? fmtPct(subject.hits / subject.rated, 1) : '—'}) reached ${data.threshold}+. ` +
      `Rows where either side has fewer than ${data.minN} games are greyed and their ratio hidden.`;
    rowTable(main, choices, data.threshold);

    const ranked = [...choices]
      .filter(r => !r.small && r.ratio > 0)
      .sort((a, b) => b.ratio - a.ratio);
    if (ranked.length) {
      const chart = el('section', 'viz-section', host);
      el('h3', undefined, chart).textContent = 'Hit rate with vs without';
      el('p', 'viz-caption', chart).textContent =
        `Same numbers, paired. The gap between the bars is the association; the ordering is by ratio.`;
      columnChart(chart, {
        categories: ranked.map(r => r.label),
        series: [
          { name: 'With feature', color: SERIES_1, values: ranked.map(r => r.withRate * 100) },
          { name: 'Without', color: SERIES_2, values: ranked.map(r => r.withoutRate * 100) },
        ],
        valueFormat: v => `${v.toFixed(1)}%`,
        labelEvery: 1,
        height: 240,
      });
      tableTwin(
        chart,
        ['Feature', 'With %', 'With n', 'Without %', 'Without n', 'Ratio'],
        ranked.map(r => [r.label, `${(r.withRate * 100).toFixed(1)}%`, r.withN, `${(r.withoutRate * 100).toFixed(1)}%`, r.withoutN, `${r.ratio.toFixed(2)}×`]),
      );
    }

    if (outcomes.length) {
      const out = el('section', 'viz-section', host);
      el('h3', undefined, out).textContent = 'Not a choice — these follow success';
      el('p', 'viz-caption', out).textContent =
        `Valve grants these once a game already sells, so the association runs backwards: success causes the ` +
        `feature, not the other way round. Shown because the size of the gap is itself informative — it is ` +
        `roughly what pure reverse causation looks like in this data, and a useful yardstick for reading the ` +
        `table above.`;
      rowTable(out, outcomes, data.threshold);
    }
  };

  select.addEventListener('change', render);
  render();

  const foot = el('p', 'viz-caption', root);
  foot.textContent = `Updated ${new Date(data.generatedAt).toISOString().slice(0, 10)}.`;
}
