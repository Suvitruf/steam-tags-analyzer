/** The readable suffix is decoration. Only the numeric prefix identifies a tag. */
export function tagSegment(id, name) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid tag ID');
  const slug = String(name).normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'tag';
  return `${id}-${slug}`;
}

export function tagIdFromPath(pathname) {
  const match = /\/tags\/([1-9]\d*)(?:-[^/]*)?\/?$/.exec(pathname);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

export function tagIdFromHash(hash) {
  const id = /^#[1-9]\d*$/.test(hash) ? Number(hash.slice(1)) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

export function tagPath(id, name, base = '') {
  return `${base.replace(/\/$/, '')}/tags/${encodeURIComponent(tagSegment(id, name))}/`;
}
