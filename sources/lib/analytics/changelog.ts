import { getChangelog, type ChangelogFile, type TaxonomyChange } from './data';
import { el, fmtInt } from './format';

const TYPE_LABEL: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  renamed: 'Renamed',
  restored: 'Restored',
};

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Group changes into the refresh that observed them (one row per day). */
function groupByDay(changes: TaxonomyChange[]): Array<[string, TaxonomyChange[]]> {
  const byDay = new Map<string, TaxonomyChange[]>();
  for (const c of changes) {
    const day = dayOf(c.changed_at);
    const list = byDay.get(day);
    if (list) list.push(c);
    else byDay.set(day, [c]);
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function describe(c: TaxonomyChange): string {
  switch (c.change_type) {
    case 'renamed':
      return `${c.old_name ?? '?'} → ${c.new_name ?? '?'}`;
    case 'removed':
      return `${c.name} is no longer offered on store pages`;
    case 'restored':
      return `${c.name} is back in the taxonomy`;
    default:
      return `${c.name} is now available`;
  }
}

export async function initChangelog(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading taxonomy changelog…';
  let data: ChangelogFile;
  try {
    data = await getChangelog();
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `Valve reshapes the store tag taxonomy every year or two — the May 2026 overhaul added 17 tags, removed 28 ` +
    `and merged others (Clicker → Incremental) — and gives developers no migration notice. This page diffs the ` +
    `live tag list on every refresh, so a tag disappearing from your store page shows up here. ` +
    `${fmtInt(data.activeTags)} tags are currently active.`;

  // Retired tags first: this is the standing state a dev can act on today,
  // and it stays useful during the long quiet stretches between overhauls.
  const retired = el('section', 'viz-section', root);
  el('h3', undefined, retired).textContent = `Retired tags (${fmtInt(data.retired.length)})`;
  if (data.retired.length === 0) {
    el('p', 'viz-caption', retired).textContent =
      'No tag has been retired since tracking began. Nothing to migrate away from.';
  } else {
    el('p', 'viz-caption', retired).textContent =
      `Tags Valve no longer offers. The recommender will not suggest these, and a store page still carrying one ` +
      `is spending a tag slot on something players can no longer browse by.`;
    const table = el('table', 'tag-table', retired);
    const thead = el('thead', undefined, table);
    const head = el('tr', undefined, thead);
    for (const h of ['Tag', 'Retired on']) el('th', undefined, head).textContent = h;
    const tbody = el('tbody', undefined, table);
    for (const t of data.retired) {
      const tr = el('tr', undefined, tbody);
      el('td', undefined, tr).textContent = t.name;
      el('td', undefined, tr).textContent = t.removed_at ? dayOf(t.removed_at) : 'before tracking';
    }
  }

  const history = el('section', 'viz-section', root);
  el('h3', undefined, history).textContent = 'Change history';
  if (data.changes.length === 0) {
    el('p', 'viz-caption', history).textContent =
      'No taxonomy changes observed yet. The diff runs on every refresh; this fills in when Valve next moves.';
  } else {
    el('p', 'viz-caption', history).textContent =
      `Every add, removal, rename and restore observed since tracking began, grouped by the refresh that saw it. ` +
      `The initial taxonomy import is deliberately not logged — it would show every tag as "added".`;
    for (const [day, list] of groupByDay(data.changes)) {
      const block = el('div', 'changelog-day', history);
      const heading = el('h4', undefined, block);
      const counts = new Map<string, number>();
      for (const c of list) counts.set(c.change_type, (counts.get(c.change_type) ?? 0) + 1);
      heading.textContent = `${day} — ${[...counts.entries()].map(([t, n]) => `${n} ${t}`).join(', ')}`;
      const ul = el('ul', 'changelog-list', block);
      for (const c of list) {
        const li = el('li', undefined, ul);
        const badge = el('span', `changelog-badge is-${c.change_type}`, li);
        badge.textContent = TYPE_LABEL[c.change_type] ?? c.change_type;
        el('span', undefined, li).textContent = ` ${describe(c)}`;
      }
    }
  }

  const foot = el('p', 'viz-caption', root);
  foot.textContent = `Updated ${new Date(data.generatedAt).toISOString().slice(0, 10)}.`;
}
