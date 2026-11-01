import { tagIdFromPath } from './tag-route.mjs';
import { siteBasePath } from './site-path';

// GitHub Pages cannot rewrite arbitrary suffixes at the server. Its 404 page
// resolves old/mistyped suffixes by ID to the generated canonical HTML page.
async function redirectTag(): Promise<void> {
  const id = tagIdFromPath(location.pathname);
  if (id === null) return;
  try {
    const response = await fetch(`${siteBasePath()}/assets/tag-pages.json`);
    if (!response.ok) return;
    const directory = await response.json() as {tags: Array<{id: number; path: string}>};
    const tag = directory.tags.find(tag => tag.id === id);
    if (!tag || tagIdFromPath(tag.path) !== id || !tag.path.startsWith('/tags/')) return;
    const destination = new URL(`${siteBasePath()}${tag.path}`, location.origin);
    if (destination.pathname === location.pathname) return;
    destination.search = location.search;
    destination.hash = location.hash;
    location.replace(destination.href);
  } catch { /* Keep the useful 404 page if the catalog cannot be loaded. */ }
}

void redirectTag();
