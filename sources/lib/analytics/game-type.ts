import { gameType, populationFile, type GameType } from './core/game-type';
import { fetchAnalytics, getManifest } from './snapshot';
import { el } from './format';
import { labeledSelect } from './research-ui';
import { tagIdFromPath } from '../tag-route.mjs';

const KEY = 'steam-tags.game-type.v1';
let current: GameType | undefined;
export function getGameType(): GameType {
  if (current !== undefined) return current;
  const query = new URLSearchParams(location.search);
  if (query.has('gameType')) return current = gameType(query.get('gameType'));
  // Existing shared cohorts used these price filters before the global control.
  if (['positive', 'usd'].includes(query.get('price') ?? '')) return current = 'paid';
  if (query.get('price') === 'zero') return current = 'free';
  if (query.has('price')) return current = 'all';
  try { return current = gameType(localStorage.getItem(KEY)); }
  catch { return current = 'all'; }
}
export function populationPath(file: string): string { return populationFile(file, getGameType()); }
export async function fetchPopulation<T>(file: string): Promise<T> {
  const target = populationPath(file);
  if (getGameType() !== 'all' && !(await getManifest())?.artifacts[target]) {
    throw Error('This snapshot does not include the selected game type. Choose All games or wait for a newer data snapshot.');
  }
  return fetchAnalytics<T>(target);
}
export function gameTypeLink(href: string): string {
  const url = new URL(href, location.href);
  url.searchParams.set('gameType', getGameType());
  return url.href;
}
function analyticsLink(url: URL): boolean {
  return url.origin === location.origin && (/\/(tags|benchmarks|trends|timing|features|prices|combos|map|lifecycle|publishers|compare|trending|upcoming|momentum)(\.html|\/)?$/.test(url.pathname) || tagIdFromPath(url.pathname) !== null);
}
export function mountGameType(root: HTMLElement | null): boolean {
  let type: GameType;
  try { type = getGameType(); }
  catch (error) {
    if (root) root.textContent = `${(error as Error).message}. Use gameType=all, paid or free in the URL.`;
    return false;
  }
  if (root) {
    const form = el('form', 'review-threshold-controls');
    const select = labeledSelect(form, 'Games', [['all', 'All games'], ['paid', 'Paid games'], ['free', 'Free games']], type);
    const submit = el('button', 'research-button', form); submit.type = 'submit'; submit.textContent = 'Apply game type';
    el('p', 'viz-caption', form).textContent = 'Based on the latest observed price: Paid > 0, Free = 0. Prices may include discounts; zero price is not verified free-to-play status. All games also includes unknown prices. Saved on this device and in shared links.';
    root.before(form);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try { localStorage.setItem(KEY, select.value); } catch { /* URL works without storage. */ }
      const url = new URL(location.href); url.searchParams.set('gameType', select.value);
      // A previous price-only constraint must not silently make the new group empty.
      url.searchParams.delete('price');
      location.assign(url.href);
    });
    const url = new URL(location.href); url.searchParams.set('gameType', type);
    if (['zero', 'positive'].includes(url.searchParams.get('price') ?? '')) url.searchParams.delete('price');
    history.replaceState(null, '', url);
    try { localStorage.setItem(KEY, type); } catch { /* URL works without storage. */ }
  }
  // Delegation covers links rendered after async data loads, including middle-click.
  const carry = (event: Event) => {
    const link = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (link && analyticsLink(new URL(link.href)) && !new URL(link.href).searchParams.has('gameType')) link.href = gameTypeLink(link.href);
  };
  document.addEventListener('click', carry, true);
  document.addEventListener('auxclick', carry, true);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (analyticsLink(new URL(link.href)) && !new URL(link.href).searchParams.has('gameType')) link.href = gameTypeLink(link.href);
  }
  return true;
}
