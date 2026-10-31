// Small DOM + formatting helpers shared by the analyzer (main.ts) and the tag
// audit page (audit/ui.ts). Both live in the app.js bundle.
import type { SimilarGame } from '../types';

export function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

export function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function fmtReviews(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Link into the tag analytics page for a tag. The analyzer and the audit live
// at <baseurl>/analyzer and <baseurl>/audit (no trailing slash), so a relative
// 'tags/#id' resolves to <baseurl>/tags/#id; the vite dev harness serves
// /tags.html instead.
export function tagPageUrl(tagId: number): string {
  return import.meta.env.DEV ? `/tags.html#${tagId}` : `tags/#${tagId}`;
}

export function storeUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`;
}

/**
 * Parse what a user pastes into an App ID field: a bare number, or any Steam
 * store URL that carries one (/app/1245620/ELDEN_RING/). Null when neither.
 */
export function parseAppIdInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/\/app\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function renderSimilarGames(
  games: SimilarGame[],
  opts: { title: string; note: string } = {
    title: 'Games most like yours',
    note: 'Nearest games to your description — the basis for the tag recommendations above.',
  }
): string {
  if (!games || games.length === 0) return '';
  const items = games.map(g =>
    `<li class="similar-game">
      <a href="${storeUrl(g.appid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(g.name)}</a>
      <span class="similar-game-meta">${(g.similarity * 100).toFixed(0)}% match · ${fmtReviews(g.reviews)} reviews</span>
    </li>`
  ).join('');
  return `
    <div class="result-section result-similar">
      <h3>${escapeHtml(opts.title)}</h3>
      <p class="similar-games-note">${escapeHtml(opts.note)}</p>
      <ul class="similar-games">${items}</ul>
    </div>`;
}
