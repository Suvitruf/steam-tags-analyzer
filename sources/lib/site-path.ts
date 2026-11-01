import { tagPath } from './tag-route.mjs';

export function siteBasePath(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="site-baseurl"]')?.content.replace(/\/$/, '') ?? '';
}

export function sitePagePath(page: string): string {
  if (import.meta.env.DEV) return page === 'analyzer' ? '/' : `/${page}.html`;
  return `${siteBasePath()}/${page}${page === 'analyzer' || page === 'audit' ? '' : '/'}`;
}

export function tagPageUrl(id: number, name: string, threshold?: number): string {
  const pathname = tagPath(id, name, siteBasePath());
  const cutoff = threshold === undefined ? new URLSearchParams(location.search).get('threshold') : String(threshold);
  return cutoff === null ? pathname : `${pathname}?${new URLSearchParams({threshold: cutoff})}`;
}
