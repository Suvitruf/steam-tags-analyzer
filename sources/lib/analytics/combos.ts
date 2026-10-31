import { getCombos, getTagsSummary, type CombosFile, type TagsSummaryFile } from './data';
import { el, fmtInt, fmtCompact, fmtPct, fmtLift } from './format';

// Path to the tag explorer, correct under the Pages baseurl (/…/combos/) and
// the vite dev harness (/combos.html).
function tagsPath(): string {
  return location.pathname.replace(/\/combos(\.html|\/)?$/, '/tags$1');
}

interface PairRow {
  aIdx: number;
  bIdx: number;
  games: number;
  hitRate: number;
  median: number;
}

export async function initComboExplorer(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading combo data…';
  let combos: CombosFile;
  let summary: TagsSummaryFile;
  try {
    [combos, summary] = await Promise.all([getCombos(), getTagsSummary()]);
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const hitRateById = new Map(summary.tags.map(t => [t.id, t.hitRates.h250]));
  const pairs: PairRow[] = combos.pairs.map(([aIdx, bIdx, games, hits, median]) => ({
    aIdx, bIdx, games, hitRate: games > 0 ? hits / games : 0, median,
  }));

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `Real niches live in tag combinations. "Hit rate" = share of games carrying BOTH tags that reached 250+ reviews ` +
    `(Steam baseline: ${fmtPct(summary.baseline.h250)}); "vs parent" compares the pair against all games with the parent tag, including this pair. ` +
    `Pairs cover the ${combos.tags.length} biggest tags; pairs with fewer than ${combos.minGames} games are not shown. ` +
    `Review-based, no revenue estimates.`;
  const caveat = el('p', 'viz-caption', root);
  caveat.textContent =
    `Praise and store-state tags (Great Soundtrack, Classic, Early Access…) are excluded — players apply them ` +
    `AFTER a game succeeds, so their pairs mark success rather than cause it. Near-universal tags ` +
    `(Singleplayer, Indie, Action…) are excluded too: a pair with a tag most games carry says nothing.`;

  // tag picker
  const controls = el('div', 'analytics-controls', root);
  const label = el('label', 'combo-label', controls);
  label.textContent = 'Combos for tag: ';
  const select = el('select', 'combo-select', controls);
  select.setAttribute('aria-label', 'Pick a tag to see its combinations');
  const optAll = el('option', undefined, select);
  optAll.value = '';
  optAll.textContent = 'Strongest combos overall';
  for (const [i, t] of combos.tags.entries()) {
    const opt = el('option', undefined, select);
    opt.value = String(i);
    opt.textContent = t.name;
  }
  // sort tag options alphabetically after the "overall" entry
  const opts = [...select.options].slice(1).sort((a, b) => a.textContent!.localeCompare(b.textContent!));
  for (const o of opts) select.appendChild(o);

  const tableWrap = el('div', undefined, root);

  const tagLink = (idx: number, parent: Element) => {
    const t = combos.tags[idx];
    const a = el('a', 'tag-link', parent);
    a.href = `${tagsPath()}#${t.id}`;
    a.textContent = t.name;
  };

  const render = () => {
    tableWrap.replaceChildren();
    const selIdx = select.value === '' ? null : parseInt(select.value, 10);

    const table = el('table', 'tag-table combo-table', tableWrap);
    const thead = el('thead', undefined, table);
    const headRow = el('tr', undefined, thead);
    const tbody = el('tbody', undefined, table);

    if (selIdx === null) {
      // overall: strongest pairs by hit rate with a meaningful sample
      for (const h of ['Tag pair', 'Games together', 'Hit rate', 'vs Steam avg', '~Median reviews']) {
        el('th', undefined, headRow).textContent = h;
      }
      const rows = pairs
        .filter(p => p.games >= 100)
        .sort((a, b) => b.hitRate - a.hitRate)
        .slice(0, 60);
      for (const p of rows) {
        const tr = el('tr', undefined, tbody);
        const pairCell = el('td', undefined, tr);
        tagLink(p.aIdx, pairCell);
        pairCell.appendChild(document.createTextNode(' + '));
        tagLink(p.bIdx, pairCell);
        el('td', 'num', tr).textContent = fmtInt(p.games);
        el('td', 'num', tr).textContent = fmtPct(p.hitRate);
        el('td', 'num', tr).textContent = fmtLift(p.hitRate / summary.baseline.h250);
        el('td', 'num', tr).textContent = fmtCompact(p.median);
      }
      const note = el('p', 'viz-caption', tableWrap);
      note.textContent = 'Top 60 pairs with at least 100 games together, ranked by hit rate.';
    } else {
      const selTag = combos.tags[selIdx];
      const aloneRate = hitRateById.get(selTag.id) ?? 0;
      for (const h of ['Partner tag', 'Games together', 'Hit rate', `vs ${selTag.name} parent`, '~Median reviews']) {
        el('th', undefined, headRow).textContent = h;
      }
      const rows = pairs
        .filter(p => p.aIdx === selIdx || p.bIdx === selIdx)
        .sort((a, b) => b.hitRate - a.hitRate);
      for (const p of rows) {
        const partner = p.aIdx === selIdx ? p.bIdx : p.aIdx;
        const tr = el('tr', undefined, tbody);
        const cell = el('td', undefined, tr);
        tagLink(partner, cell);
        el('td', 'num', tr).textContent = fmtInt(p.games);
        el('td', 'num', tr).textContent = fmtPct(p.hitRate);
        const rel = aloneRate > 0 ? p.hitRate / aloneRate : 0;
        const relCell = el('td', 'num', tr);
        relCell.textContent = fmtLift(rel);
        if (rel >= 1.25) relCell.classList.add('combo-up');
        else if (rel <= 0.8) relCell.classList.add('combo-down');
        el('td', 'num', tr).textContent = fmtCompact(p.median);
      }
      const note = el('p', 'viz-caption', tableWrap);
      note.textContent =
        `${selTag.name} parent population: ${fmtPct(aloneRate)} of its games reach 250+ reviews. ` +
        `${rows.length} partner tags shown (≥${combos.minGames} games together).`;
    }
  };

  select.addEventListener('change', render);
  render();
}
