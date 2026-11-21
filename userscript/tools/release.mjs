export function releaseMetadata(template, version, config) {
  function https(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Release URLs must use HTTPS without credentials, queries or fragments');
    }
    return url;
  }
  const base = https(config.rawBase);
  if (!base.pathname.endsWith('/')) throw new Error('Release rawBase must end with /');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric userscript release version');
  const values = {
    VERSION: version,
    DOWNLOAD_URL: new URL('steam-tag-audit.user.js', base).href,
    UPDATE_URL: new URL('steam-tag-audit.meta.js', base).href,
    SUPPORT_URL: https(config.supportUrl).href,
  };
  const metadata = template.replace(/\r\n/g, '\n').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown metadata placeholder: ${key}`);
    return values[key];
  }).trimEnd() + '\n';
  if (!metadata.startsWith('// ==UserScript==\n') || !metadata.endsWith('// ==/UserScript==\n')) throw new Error('Invalid userscript metadata envelope');
  return metadata;
}
