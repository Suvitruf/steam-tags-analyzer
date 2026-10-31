import { getPrices, type PricesFile, type PriceSubject, type PriceTag } from './data';
import { columnChart, tableTwin, SERIES_1, SERIES_2 } from './charts';
import { el, fmtInt, fmtPct } from './format';

const MIN_BUCKET_N = 30; // a bucket's hit rate below this sample is noise

function usd(cents: number | null): string {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

function rate(cell: [number, number]): number {
  return cell[0] > 0 ? cell[1] / cell[0] : 0;
}

export async function initPrices(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading price data…';
  let data: PricesFile;
  try {
    data = await getPrices();
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const swept = data.coverage.paid > 0 ? data.coverage.currencyKnown / data.coverage.paid : 0;

  const intro = el('p', 'analytics-intro', root);
  intro.textContent = 'Last observed final prices, which may include discounts. Zero and positive prices are proxies; explicit free-to-play status is not retained. Unknown prices are excluded. Price levels use only verified USD observations.';
  el('p', 'viz-caption', root).textContent = `Currency confirmed for ${fmtInt(data.coverage.currencyKnown)} of ${fmtInt(data.coverage.paid)} positive-price games (${fmtPct(swept)}). This is the observed slice, not launch-price or pricing-effect evidence.`;

  const controls = el('div', 'analytics-controls', root);
  const label = el('label', 'combo-label', controls);
  label.textContent = 'Tag: ';
  const select = el('select', 'combo-select', controls);
  select.setAttribute('aria-label', 'Pick a tag to see its pricing');
  const optAll = el('option', undefined, select);
  optAll.value = '';
  optAll.textContent = 'All Steam';
  for (const t of [...data.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const opt = el('option', undefined, select);
    opt.value = String(t.id);
    opt.textContent = t.name;
  }

  const host = el('div', undefined, root);

  const render = () => {
    host.replaceChildren();
    const tag: PriceTag | null = select.value === ''
      ? null
      : data.tags.find(t => t.id === parseInt(select.value, 10)) ?? null;
    const subject: PriceSubject = tag ?? data.all;
    const name = tag ? tag.name : 'all Steam';

    // --- free vs paid (works on every row) ---
    const fp = el('section', 'viz-section', host);
    el('h3', undefined, fp).textContent = `Zero vs positive observed price — ${name}`;
    el('p', 'viz-caption', fp).textContent =
      `Share reaching ${data.threshold}+ lifetime reviews. Prices may have changed after these reviews were written.`;
    const table = el('table', 'tag-table', fp);
    const thead = el('thead', undefined, table);
    const head = el('tr', undefined, thead);
    for (const h of ['Model', 'Games', `Reached ${data.threshold}+`, 'Hit rate']) {
      el('th', undefined, head).textContent = h;
    }
    const tbody = el('tbody', undefined, table);
    for (const [modelName, cell] of [['Zero price', subject.free], ['Positive price', subject.paid]] as Array<[string, [number, number]]>) {
      const tr = el('tr', undefined, tbody);
      if (cell[0] < MIN_BUCKET_N) tr.classList.add('is-small-sample');
      el('td', undefined, tr).textContent = modelName;
      el('td', 'num', tr).textContent = fmtInt(cell[0]);
      el('td', 'num', tr).textContent = fmtInt(cell[1]);
      el('td', 'num', tr).textContent = cell[0] > 0 ? fmtPct(rate(cell), 1) : '—';
    }

    // --- price levels (confirmed-currency slice only) ---
    const lv = el('section', 'viz-section', host);
    el('h3', undefined, lv).textContent = `Price levels — ${name}`;
    if (subject.clean < data.minClean) {
      el('p', 'viz-caption', lv).textContent =
        `Only ${fmtInt(subject.clean)} of this tag's paid games have a confirmed currency, below the minimum of ` +
        `${data.minClean}. Nothing is shown rather than a median built from a handful of games — check back as ` +
        `the rotation sweeps.`;
      return;
    }

    el('p', 'viz-caption', lv).textContent =
      `Median price ${usd(subject.median)} across ${fmtInt(subject.clean)} paid games with a confirmed price` +
      (subject.medianHit !== null
        ? `; among those that reached ${data.threshold}+ reviews, ${usd(subject.medianHit)}.`
        : '.') +
      ` That gap is the usual reason to distrust "price your game low" advice — but it runs both ways: ` +
      `bigger-budget games both charge more and sell more.`;

    const rates = subject.buckets.map((n, i) => (n > 0 ? (subject.bucketHits[i] / n) * 100 : 0));
    columnChart(lv, {
      categories: data.buckets,
      series: [{ name: `% reaching ${data.threshold}+ reviews`, color: SERIES_1, values: rates }],
      valueFormat: v => `${v.toFixed(1)}%`,
      labelEvery: 1,
      height: 200,
    });
    const thin = data.buckets.filter((_, i) => subject.buckets[i] > 0 && subject.buckets[i] < MIN_BUCKET_N);
    if (thin.length) {
      el('p', 'viz-caption', lv).textContent =
        `⚠ Fewer than ${MIN_BUCKET_N} games in: ${thin.join(', ')} — those bars are noise.`;
    }

    const dist = el('section', 'viz-section', host);
    el('h3', undefined, dist).textContent = 'How many games sit at each price';
    el('p', 'viz-caption', dist).textContent =
      `The supply side of the same slice: where this tag actually prices, and where its hits do.`;
    columnChart(dist, {
      categories: data.buckets,
      series: [
        { name: 'All paid games', color: SERIES_1, values: subject.buckets },
        { name: `Reached ${data.threshold}+`, color: SERIES_2, values: subject.bucketHits },
      ],
      labelEvery: 1,
      height: 210,
    });
    tableTwin(
      dist,
      ['Price', 'Games', `Reached ${data.threshold}+`, 'Hit rate'],
      data.buckets.map((b, i) => [
        b, subject.buckets[i], subject.bucketHits[i],
        subject.buckets[i] > 0 ? `${rates[i].toFixed(1)}%` : '—',
      ]),
    );
  };

  select.addEventListener('change', render);
  render();

  const foot = el('p', 'viz-caption', root);
  foot.textContent = `Updated ${new Date(data.generatedAt).toISOString().slice(0, 10)}.`;
}
