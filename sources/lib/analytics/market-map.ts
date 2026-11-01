import { tagPageUrl } from '../site-path';
import { getTagsSummary } from './data';
import { scatterChart } from './charts';
import { el, fmtInt, fmtPct } from './format';

const MIN_GAMES = 30; // sample-size floor: tags below this aren't plotted

export async function initMarketMap(root: HTMLElement): Promise<void> {
  root.textContent = 'Loading market data…';
  let summary;
  try {
    summary = await getTagsSummary();
  } catch (err) {
    root.textContent = `Failed to load analytics data: ${(err as Error).message}`;
    return;
  }
  root.textContent = '';

  const shown = summary.tags.filter(t => t.count >= MIN_GAMES && t.releases365 > 0);

  const intro = el('p', 'analytics-intro', root);
  intro.textContent =
    `Each bubble is a tag: how crowded it is (games released in the last 365 days, log scale) against how often ` +
    `its games succeed (share reaching 250+ reviews, all-time — Steam baseline ${fmtPct(summary.baseline.h250)}). ` +
    `Bubble size = total games with the tag. Tags with fewer than ${MIN_GAMES} games are hidden ` +
    `(${fmtInt(summary.tags.length - shown.length)} hidden). Click a bubble for the full tag page. ` +
    `Review-based, no revenue estimates. Updated ${summary.generatedAt.slice(0, 10)}.`;

  scatterChart(root, {
    points: shown.map(t => ({
      id: t.id,
      label: t.name,
      x: t.releases365,
      y: t.hitRates.h250,
      size: t.count,
    })),
    xLabel: 'releases, last 365 days',
    yLabel: 'share reaching 250+ reviews',
    onSelect: id => {
      const tag = summary.tags.find(t => t.id === id);
      if (tag) location.href = tagPageUrl(tag.id, tag.name);
    },
  });
}
