const CSS = `:host{display:block;clear:both;margin:12px 0;color:#dce8f1;font:14px/1.5 Arial,sans-serif;max-width:100%}*{box-sizing:border-box}details{background:#182b3b;border:1px solid #456279;border-radius:5px;padding:10px}summary{cursor:pointer;color:#9ed8ff;font-weight:bold}button,select,input{font:inherit;color:#eef5fa;background:#28485d;border:1px solid #6d8b9e;border-radius:3px;padding:5px;margin:3px;max-width:100%}button,a{cursor:pointer}button:disabled{opacity:.5;cursor:wait}a{color:#a6d9ff}p{margin:9px 0}.controls{display:flex;flex-wrap:wrap;align-items:end;gap:6px}label{display:flex;flex-direction:column}.scroll{overflow:auto;max-width:100%}table{border-collapse:collapse;min-width:100%;text-align:left}th,td{padding:6px;border-bottom:1px solid #3d5669;vertical-align:top;white-space:normal;min-width:85px}th{color:#a6d9ff}.note{color:#b2c2cf;font-size:12px}.stats{display:flex;flex-wrap:wrap;gap:12px}.stat{flex:1 1 130px;background:#203b4e;padding:8px}.stat strong{display:block;font-size:20px}ul{padding-left:20px}h3{font-size:15px;margin:14px 0 6px}button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
export function el(tag, text, parent, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}
export function link(parent, text, url) {
  const a = el('a', text, parent); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
export function select(parent, title, options, value) {
  const label = el('label', title, parent), input = el('select', null, label);
  for (const [id, text] of options) { const option = el('option', text, input); option.value = id; }
  if (value !== undefined) input.value = String(value);
  return input;
}
export function table(parent, headers, rows) {
  const t = el('table', null, el('div', null, parent, 'scroll'));
  const head = el('tr', null, el('thead', null, t)); headers.forEach(h => el('th', h, head).scope = 'col');
  const body = el('tbody', null, t);
  for (const row of rows) { const tr = el('tr', null, body); row.forEach(value => { const td = el('td', null, tr); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? 'Unknown'); }); }
  return t;
}
export const number = v => v === null || v === undefined ? 'Unknown' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const percent = v => v === null || v === undefined ? 'Unknown' : `${(v*100).toFixed(1)}%`;
export function stat(parent, title, value) { const item = el('div', title, parent, 'stat'); el('strong', value, item); }
export function gameLink(game) { return link(null, game.name, `https://store.steampowered.com/app/${game.appid}/`); }
export function lazyPanel(anchor, id, title, load) {
  if (document.getElementById(id)) return;
  const host = el('div'); host.id = id; anchor.insertAdjacentElement('afterend', host);
  const root = host.attachShadow({ mode: 'open' }); el('style', CSS, root);
  const details = el('details', null, root); el('summary', title, details);
  const status = el('p', '', details); status.setAttribute('role', 'status');
  const content = el('div', null, details), retry = el('button', 'Retry', details); retry.hidden = true;
  let loaded = false, loading = false;
  const run = async () => {
    if (loading || loaded) return;
    loading = true; status.textContent = 'Loading research data…'; retry.hidden = true; content.replaceChildren();
    try { await load(content); loaded = true; status.textContent = ''; }
    catch (error) { content.replaceChildren(); status.textContent = `Could not load research: ${error.message}`; retry.hidden = false; }
    finally { loading = false; }
  };
  details.addEventListener('toggle', () => { if (details.open) run(); });
  retry.addEventListener('click', run);
  return host;
}
export function action(parent, title, run) {
  const button = el('button', title, parent), status = el('p', '', parent); status.setAttribute('role', 'status');
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = 'Loading…';
    try { await run(); status.textContent = ''; } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  return button;
}
