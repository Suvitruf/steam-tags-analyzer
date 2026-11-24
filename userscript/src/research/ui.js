// Isolated shadow-root styles: Steam page controls keep their own styling.
const CONTROLS = `
:host {
  display: block; clear: both; margin: 12px 0; max-width: 100%; min-width: 0;
  color-scheme: dark; color: #c7d5e0; font: 13px/1.5 "Motiva Sans", Arial, sans-serif;
  --sta-panel: #16202d; --sta-border: #354b60; --sta-muted: #a8b6c4; --sta-accent: #66c0f4;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, select, input { font: inherit; color: #e5e9ed; border: 1px solid var(--sta-border); border-radius: 2px; padding: 7px 10px; max-width: 100%; min-width: 0; }
select, input { background: #101822; }
button { background: #28465d; cursor: pointer; }
button:hover:not(:disabled) { background: #3c6684; color: #fff; }
button:disabled { opacity: .5; cursor: wait; }
button, a { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
a { color: var(--sta-accent); text-decoration: none; text-underline-offset: 3px; }
a:hover { color: #fff; text-decoration: underline; }
button:focus-visible, summary:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--sta-accent); outline-offset: 3px; }
input[type=checkbox] { accent-color: var(--sta-accent); }
`;
export const COMPARISON_CSS = `${CONTROLS}
:host { margin: 6px 0; }
button { padding: 5px 10px; font-size: 12px; }
span { color: var(--sta-muted); font-size: 12px; margin-left: 8px; }
`;
const CSS = `${CONTROLS}
:host > details { background: var(--sta-panel); border: 1px solid #2e465b; border-radius: 2px; padding: 0 14px 12px; box-shadow: 0 2px 5px #0002; overflow-wrap: anywhere; }
:host > details:not([open]) { padding-bottom: 0; }
summary { cursor: pointer; color: var(--sta-accent); font-weight: 500; padding: 11px 14px; margin: 0 -14px; background: linear-gradient(100deg, #29485f, #1c3449); }
summary:hover { background: #335c78; color: #fff; }
details[open] > summary { border-bottom: 1px solid var(--sta-border); }
p { margin: 10px 0; }
p:empty { display: none; }
.controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin: 12px 0; }
label { display: flex; flex-direction: column; gap: 5px; max-width: 100%; color: var(--sta-muted); font-size: 12px; }
label select, label input { color: #e5e9ed; font-size: 13px; }
.scroll { overflow: auto; max-width: 100%; margin: 12px 0; scrollbar-color: #48647c var(--sta-panel); }
table { border-collapse: collapse; width: 100%; text-align: left; font-size: 12px; }
th, td { padding: 9px 10px; border-bottom: 1px solid #2b4052; vertical-align: top; white-space: normal; min-width: 80px; font-variant-numeric: tabular-nums; }
th { color: var(--sta-muted); font-weight: 400; background: #101a25; }
tbody tr:nth-child(odd) { background: #1b2c3c; }
tbody tr:hover { background: #263e52; }
.note { color: var(--sta-muted); font-size: 12px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.stat { flex: 1 1 130px; background: #1e3346; border-top: 2px solid #3a6887; padding: 12px; color: var(--sta-muted); font-size: 12px; }
.stat strong { display: block; font-size: 22px; font-weight: 400; color: #f2f5f7; }
ul { padding-left: 20px; }
li { margin: 5px 0; }
h3 { font-size: 12px; font-weight: 500; color: #f2f5f7; letter-spacing: .06em; text-transform: uppercase; margin: 18px 0 8px; padding-bottom: 7px; border-bottom: 1px solid var(--sta-border); }
@media (max-width: 480px) { .controls > label { flex: 1 1 140px; } .controls > button { flex-grow: 1; } }
`;
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
