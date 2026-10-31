// Minimal hand-rolled SVG charts following the dataviz method:
// thin marks (bars ≤24px, 4px rounded data-end, square baseline), hairline
// solid gridlines, one shared tooltip (textContent only — labels are untrusted
// data), hover hit targets ≥24px, selective direct labels, and a table-view
// twin for every chart (the relief obligation for sub-3:1 series colors on
// the site's navy surface).

import { el, fmtCompact } from './format';

export const SERIES_1 = '#3987e5'; // blue  — validated on #2a475e (see style.css)
export const SERIES_2 = '#199e70'; // aqua

/** Long feature labels need rows rather than overlapping axis ticks. */
export function horizontalBars(parent:Element, labels:string[], values:number[], seriesName:string):void {
  if(!labels.length)return;
  const wrap=el('div','viz-chart',parent),height=labels.length*28+12;
  const svg=svgEl('svg',{viewBox:`0 0 720 ${height}`,class:'viz-svg',role:'img','aria-label':seriesName},wrap);
  labels.forEach((label,i)=>{
    const y=8+i*28;
    const text=svgEl('text',{x:250,y:y+14,'text-anchor':'end',class:'viz-tick'},svg);text.textContent=label;
    svgEl('rect',{x:260,y,width:Math.max(0,values[i])*3.7,height:18,rx:3,fill:SERIES_1},svg);
    const value=svgEl('text',{x:267+Math.max(0,values[i])*3.7,y:y+14,class:'viz-tick'},svg);value.textContent=`${values[i].toFixed(1)}%`;
  });
  tableTwin(wrap,['Feature',seriesName],labels.map((label,i)=>[label,`${values[i].toFixed(1)}%`]));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

// Bar with a 4px rounded data-end and a square baseline end.
function barPath(x: number, yTop: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  const yBase = yTop + h;
  return `M${x},${yBase} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} L${x + w - rr},${yTop} Q${x + w},${yTop} ${x + w},${yTop + rr} L${x + w},${yBase} Z`;
}

// --- shared tooltip -------------------------------------------------------

let tooltipEl: HTMLDivElement | null = null;

function tooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = el('div', 'viz-tooltip');
    tooltipEl.setAttribute('role', 'status');
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export interface TooltipRow {
  label: string;
  value: string;
  seriesColor?: string;
}

export function showTooltip(clientX: number, clientY: number, title: string, rows: TooltipRow[]): void {
  const tip = tooltip();
  tip.replaceChildren();
  const heading = el('div', 'viz-tooltip-title', tip);
  heading.textContent = title;
  for (const row of rows) {
    const line = el('div', 'viz-tooltip-row', tip);
    if (row.seriesColor) {
      const key = el('span', 'viz-tooltip-key', line);
      key.style.background = row.seriesColor;
    }
    const value = el('span', 'viz-tooltip-value', line);
    value.textContent = row.value;
    const label = el('span', 'viz-tooltip-label', line);
    label.textContent = row.label;
  }
  tip.style.display = 'block';
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - pad;
  tip.style.left = `${x + window.scrollX}px`;
  tip.style.top = `${y + window.scrollY}px`;
}

export function hideTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// --- table-view twin ------------------------------------------------------

// Every chart ships a <details> twin so no value is gated behind hover/color.
export function tableTwin(
  parent: Element,
  headers: string[],
  rows: Array<Array<string | number>>
): void {
  const details = el('details', 'viz-table', parent);
  const summary = el('summary', undefined, details);
  summary.textContent = 'View as table';
  const table = el('table', undefined, details);
  const thead = el('thead', undefined, table);
  const headRow = el('tr', undefined, thead);
  for (const h of headers) {
    const th = el('th', undefined, headRow);
    th.textContent = h;
  }
  const tbody = el('tbody', undefined, table);
  for (const row of rows) {
    const tr = el('tr', undefined, tbody);
    for (const cell of row) {
      const td = el('td', undefined, tr);
      td.textContent = typeof cell === 'number' ? cell.toLocaleString('en-US') : cell;
    }
  }
}

// --- charts ---------------------------------------------------------------

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / count));
  const mult = [1, 2, 5, 10].find(m => (max / (step * m)) <= count) ?? 10;
  const s = step * mult;
  // The top tick must cover the data max, or marks overflow the plot.
  const top = Math.ceil((max - 1e-9) / s) * s;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += s) ticks.push(v);
  return ticks;
}

export interface ColumnSeries {
  name: string;
  color: string;
  values: number[];
}

export interface ColumnChartOptions {
  categories: string[];        // one per column group
  series: ColumnSeries[];      // 1 or 2 series
  valueFormat?: (v: number) => string;
  labelEvery?: number;         // draw every Nth x label (default: fit-based)
  directLabelMax?: boolean;    // label the tallest column of series 1
  height?: number;
}

// Column chart (single or 2-series grouped). Legend appears only for ≥2
// series; x labels thin out to avoid collisions; per-column ≥24px hit areas
// carry the tooltip; the peak may carry one direct label.
export function columnChart(parent: Element, opts: ColumnChartOptions): void {
  const height = opts.height ?? 180;
  const width = 640;
  const margin = { top: 14, right: 8, bottom: 22, left: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const fmt = opts.valueFormat ?? fmtCompact;

  const wrap = el('div', 'viz-chart', parent);

  if (opts.series.length >= 2) {
    const legend = el('div', 'viz-legend', wrap);
    for (const s of opts.series) {
      const item = el('span', 'viz-legend-item', legend);
      const swatch = el('span', 'viz-legend-swatch', item);
      swatch.style.background = s.color;
      const name = el('span', undefined, item);
      name.textContent = s.name;
    }
  }

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'viz-svg', role: 'img' }, wrap);
  const maxVal = Math.max(1e-9, ...opts.series.flatMap(s => s.values));
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] || maxVal;
  const y = (v: number) => margin.top + plotH * (1 - v / yMax);

  for (const t of ticks) {
    svgEl('line', {
      x1: margin.left, x2: width - margin.right, y1: y(t), y2: y(t),
      class: t === 0 ? 'viz-baseline' : 'viz-grid',
    }, svg);
    const lbl = svgEl('text', { x: margin.left - 6, y: y(t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, svg);
    lbl.textContent = fmt(t);
  }

  const n = opts.categories.length;
  const groupW = plotW / n;
  const gap = 2; // surface gap between touching marks
  const perSeries = opts.series.length;
  const barW = Math.min(24, Math.max(3, (groupW - gap * (perSeries + 1)) / perSeries));

  const labelEvery = opts.labelEvery ?? Math.max(1, Math.ceil(n / Math.floor(plotW / 46)));
  let maxIdx = 0;
  opts.series[0].values.forEach((v, i) => { if (v > opts.series[0].values[maxIdx]) maxIdx = i; });

  for (let i = 0; i < n; i++) {
    const gx = margin.left + i * groupW;
    const innerW = perSeries * barW + (perSeries - 1) * gap;
    const start = gx + (groupW - innerW) / 2;

    opts.series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      const h = (v / yMax) * plotH;
      if (h > 0) {
        svgEl('path', { d: barPath(start + si * (barW + gap), y(v), barW, h), fill: s.color }, svg);
      }
    });

    if (i % labelEvery === 0) {
      const xl = svgEl('text', { x: gx + groupW / 2, y: height - 8, class: 'viz-tick', 'text-anchor': 'middle' }, svg);
      xl.textContent = opts.categories[i];
    }

    if (opts.directLabelMax && i === maxIdx && opts.series.length === 1) {
      const v = opts.series[0].values[i];
      const dl = svgEl('text', { x: gx + groupW / 2, y: y(v) - 4, class: 'viz-direct-label', 'text-anchor': 'middle' }, svg);
      dl.textContent = fmt(v);
    }

    // Hit target: the whole column band (≥24px wide by construction).
    const hit = svgEl('rect', {
      x: gx, y: margin.top, width: groupW, height: plotH, fill: 'transparent', tabindex: 0,
      class: 'viz-hit', role: 'listitem',
      'aria-label': `${opts.categories[i]}: ${opts.series.map(s => `${s.name} ${fmt(s.values[i] ?? 0)}`).join(', ')}`,
    }, svg);
    const show = (cx: number, cy: number) => showTooltip(cx, cy, opts.categories[i],
      opts.series.map(s => ({ label: s.name, value: fmt(s.values[i] ?? 0), seriesColor: perSeries > 1 ? s.color : undefined })));
    hit.addEventListener('pointermove', e => show(e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTooltip);
    hit.addEventListener('focus', () => {
      const r = hit.getBoundingClientRect();
      show(r.left + r.width / 2, r.top);
    });
    hit.addEventListener('blur', hideTooltip);
  }

  tableTwin(wrap, ['', ...opts.series.map(s => s.name)],
    opts.categories.map((c, i) => [c, ...opts.series.map(s => fmt(s.values[i] ?? 0))]));
}

export interface LineChartOptions {
  categories: string[];
  values: number[];            // single series
  seriesName: string;
  valueFormat?: (v: number) => string;
  height?: number;
}

// Single-series line: 2px round-capped line, end marker with surface ring,
// end value direct-labeled, crosshair-style nearest-X tooltip.
export function lineChart(parent: Element, opts: LineChartOptions): void {
  const height = opts.height ?? 160;
  const width = 640;
  const margin = { top: 16, right: 52, bottom: 22, left: 40 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const fmt = opts.valueFormat ?? fmtCompact;
  const n = opts.values.length;

  const wrap = el('div', 'viz-chart', parent);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'viz-svg', role: 'img' }, wrap);

  const maxVal = Math.max(1e-9, ...opts.values);
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] || maxVal;
  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => margin.top + plotH * (1 - v / yMax);

  for (const t of ticks) {
    svgEl('line', { x1: margin.left, x2: width - margin.right, y1: y(t), y2: y(t), class: t === 0 ? 'viz-baseline' : 'viz-grid' }, svg);
    const lbl = svgEl('text', { x: margin.left - 6, y: y(t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, svg);
    lbl.textContent = fmt(t);
  }
  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(plotW / 46)));
  for (let i = 0; i < n; i++) {
    if (i % labelEvery === 0) {
      const xl = svgEl('text', { x: x(i), y: height - 8, class: 'viz-tick', 'text-anchor': 'middle' }, svg);
      xl.textContent = opts.categories[i];
    }
  }

  const d = opts.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  svgEl('path', { d, fill: 'none', stroke: SERIES_1, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);

  // end marker: ≥8px dot with a 2px surface ring, plus the end direct label
  const last = n - 1;
  svgEl('circle', { cx: x(last), cy: y(opts.values[last]), r: 5, fill: SERIES_1, class: 'viz-dot-ring' }, svg);
  const endLbl = svgEl('text', { x: x(last) + 8, y: y(opts.values[last]) + 3, class: 'viz-direct-label' }, svg);
  endLbl.textContent = fmt(opts.values[last]);

  // crosshair: one hit rect, snap to nearest X
  const crosshair = svgEl('line', { x1: 0, x2: 0, y1: margin.top, y2: margin.top + plotH, class: 'viz-crosshair', visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', e => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - margin.left) / plotW) * (n - 1))));
    crosshair.setAttribute('x1', String(x(i)));
    crosshair.setAttribute('x2', String(x(i)));
    crosshair.setAttribute('visibility', 'visible');
    showTooltip(e.clientX, e.clientY, opts.categories[i], [{ label: opts.seriesName, value: fmt(opts.values[i]) }]);
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    hideTooltip();
  });

  tableTwin(wrap, ['', opts.seriesName], opts.categories.map((c, i) => [c, fmt(opts.values[i])]));
}

export const SERIES_3 = '#c98500'; // yellow — 4-slot set validated on #2a475e
export const SERIES_4 = '#9085e9'; // violet

export interface MultiLineOptions {
  categories: string[];
  series: ColumnSeries[];       // up to 4; colors from the validated slots
  valueFormat?: (v: number) => string;
  height?: number;
}

// Multi-series line chart: 2px lines, end dots with surface rings, a legend
// (identity is never color-alone), and a crosshair tooltip that lists every
// series at the snapped X.
export function multiLineChart(parent: Element, opts: MultiLineOptions): void {
  const height = opts.height ?? 220;
  const width = 680;
  const margin = { top: 16, right: 26, bottom: 22, left: 46 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const fmt = opts.valueFormat ?? fmtCompact;
  const n = opts.categories.length;

  const wrap = el('div', 'viz-chart', parent);
  const legend = el('div', 'viz-legend', wrap);
  for (const s of opts.series) {
    const item = el('span', 'viz-legend-item', legend);
    const key = el('span', 'viz-legend-line', item);
    key.style.background = s.color;
    const name = el('span', undefined, item);
    name.textContent = s.name;
  }

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'viz-svg', role: 'img' }, wrap);
  const maxVal = Math.max(1e-9, ...opts.series.flatMap(s => s.values));
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] || maxVal;
  const x = (i: number) => margin.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => margin.top + plotH * (1 - v / yMax);

  for (const t of ticks) {
    svgEl('line', { x1: margin.left, x2: width - margin.right, y1: y(t), y2: y(t), class: t === 0 ? 'viz-baseline' : 'viz-grid' }, svg);
    const lbl = svgEl('text', { x: margin.left - 6, y: y(t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, svg);
    lbl.textContent = fmt(t);
  }
  const labelEvery = Math.max(1, Math.ceil(n / Math.floor(plotW / 46)));
  for (let i = 0; i < n; i++) {
    if (i % labelEvery === 0) {
      const xl = svgEl('text', { x: x(i), y: height - 8, class: 'viz-tick', 'text-anchor': 'middle' }, svg);
      xl.textContent = opts.categories[i];
    }
  }

  for (const s of opts.series) {
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    svgEl('circle', { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4.5, fill: s.color, class: 'viz-dot-ring' }, svg);
  }

  const crosshair = svgEl('line', { x1: 0, x2: 0, y1: margin.top, y2: margin.top + plotH, class: 'viz-crosshair', visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', e => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - margin.left) / plotW) * (n - 1))));
    crosshair.setAttribute('x1', String(x(i)));
    crosshair.setAttribute('x2', String(x(i)));
    crosshair.setAttribute('visibility', 'visible');
    showTooltip(e.clientX, e.clientY, opts.categories[i],
      opts.series.map(s => ({ label: s.name, value: fmt(s.values[i] ?? 0), seriesColor: s.color })));
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    hideTooltip();
  });

  tableTwin(wrap, ['', ...opts.series.map(s => s.name)],
    opts.categories.map((c, i) => [c, ...opts.series.map(s => fmt(s.values[i] ?? 0))]));
}

export interface ScatterPoint {
  id: number;
  label: string;
  x: number;                   // raw (log scaling applied inside)
  y: number;                   // 0..1 ratio
  size: number;                // bubble area driver
}

export interface ScatterOptions {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  onSelect?: (id: number) => void;
  height?: number;
}

// Supply–demand bubble scatter: x log-scaled, nearest-point hover (a pointer
// only has to be closest, never dead-center on a dot), quadrant hairlines at
// the medians. Semantic zoom: wheel / double-click / buttons rescale the axes
// while marks keep their size; drag pans; everything clamps to the full view.
export function scatterChart(parent: Element, opts: ScatterOptions): void {
  if (!opts.points.length) { el('p', 'viz-caption', parent).textContent = 'No games match this view.'; return; }
  const height = opts.height ?? 420;
  const width = 720;
  const margin = { top: 18, right: 18, bottom: 42, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const wrap = el('div', 'viz-chart viz-scatter-wrap', parent);

  // zoom controls (also the keyboard-accessible path)
  const controls = el('div', 'viz-zoom-controls', wrap);
  const mkBtn = (label: string, title: string) => {
    const b = el('button', 'viz-zoom-btn', controls);
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  };
  const btnIn = mkBtn('+', 'Zoom in');
  const btnOut = mkBtn('−', 'Zoom out');
  const btnReset = mkBtn('⟲', 'Reset zoom');

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'viz-svg', role: 'img' }, wrap);

  // full data extents (x in log10 space)
  const lx = (raw: number) => Math.log10(raw + 1);
  const fullX0 = Math.min(...opts.points.map(p => lx(p.x)));
  const fullX1 = Math.max(fullX0 + 0.1, ...opts.points.map(p => lx(p.x)));
  const fullY0 = 0;
  const fullY1 = Math.max(0.01, ...opts.points.map(p => p.y)) * 1.08;
  const sizeMax = Math.max(...opts.points.map(p => p.size));
  const r = (size: number) => 4 + 16 * Math.sqrt(size / sizeMax);

  // current view window (mutated by zoom/pan)
  let vx0 = fullX0, vx1 = fullX1, vy0 = fullY0, vy1 = fullY1;

  const x = (raw: number) => margin.left + ((lx(raw) - vx0) / (vx1 - vx0)) * plotW;
  const y = (ratio: number) => margin.top + plotH * (1 - (ratio - vy0) / (vy1 - vy0));

  // static bits: axis labels, clip for the dot layer
  const clipId = `viz-clip-${Math.floor(performance.now() * 1000) % 1e9}`;
  const defs = svgEl('defs', {}, svg);
  const clip = svgEl('clipPath', { id: clipId }, defs);
  svgEl('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH }, clip);

  const gridLayer = svgEl('g', {}, svg);
  const dotLayer = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);

  const xAxisLbl = svgEl('text', { x: margin.left + plotW / 2, y: height - 6, class: 'viz-axis-label', 'text-anchor': 'middle' }, svg);
  xAxisLbl.textContent = opts.xLabel;
  const yAxisLbl = svgEl('text', {
    x: 12, y: margin.top + plotH / 2, class: 'viz-axis-label', 'text-anchor': 'middle',
    transform: `rotate(-90 12 ${margin.top + plotH / 2})`,
  }, svg);
  yAxisLbl.textContent = opts.yLabel;

  // global medians (quadrants are a property of the whole market, not the view)
  const sortedX = [...opts.points].sort((a, b) => a.x - b.x);
  const sortedY = [...opts.points].sort((a, b) => a.y - b.y);
  const medX = sortedX[Math.floor(sortedX.length / 2)].x;
  const medY = sortedY[Math.floor(sortedY.length / 2)].y;

  const X_TICK_CANDIDATES = [1, 3, 10, 30, 100, 300, 1000, 3000, 10000, 30000];

  function linearTicks(lo: number, hi: number, count = 4): number[] {
    const span = hi - lo;
    if (span <= 0) return [lo];
    const step = 10 ** Math.floor(Math.log10(span / count));
    const mult = [1, 2, 5, 10].find(m => span / (step * m) <= count) ?? 10;
    const s = step * mult;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-12; v += s) ticks.push(v);
    return ticks;
  }

  function renderView(): void {
    gridLayer.replaceChildren();
    dotLayer.replaceChildren();

    for (const v of X_TICK_CANDIDATES) {
      if (lx(v) < vx0 || lx(v) > vx1) continue;
      svgEl('line', { x1: x(v), x2: x(v), y1: margin.top, y2: margin.top + plotH, class: 'viz-grid' }, gridLayer);
      const lbl = svgEl('text', { x: x(v), y: height - 24, class: 'viz-tick', 'text-anchor': 'middle' }, gridLayer);
      lbl.textContent = fmtCompact(v);
    }
    for (const t of linearTicks(vy0, vy1)) {
      svgEl('line', { x1: margin.left, x2: width - margin.right, y1: y(t), y2: y(t), class: t === 0 ? 'viz-baseline' : 'viz-grid' }, gridLayer);
      const lbl = svgEl('text', { x: margin.left - 6, y: y(t) + 3, class: 'viz-tick', 'text-anchor': 'end' }, gridLayer);
      lbl.textContent = `${Math.round(t * 1000) / 10}%`;
    }

    // quadrant medians + labels (only when inside the view)
    if (lx(medX) >= vx0 && lx(medX) <= vx1) {
      svgEl('line', { x1: x(medX), x2: x(medX), y1: margin.top, y2: margin.top + plotH, class: 'viz-median' }, gridLayer);
    }
    if (medY >= vy0 && medY <= vy1) {
      svgEl('line', { x1: margin.left, x2: width - margin.right, y1: y(medY), y2: y(medY), class: 'viz-median' }, gridLayer);
    }
    const quad = (qx: number, qy: number, text: string, anchor: string) => {
      const q = svgEl('text', { x: qx, y: qy, class: 'viz-quadrant', 'text-anchor': anchor }, gridLayer);
      q.textContent = text;
    };
    quad(margin.left + 4, margin.top + 12, 'fewer releases, higher attainment', 'start');
    quad(width - margin.right - 4, margin.top + 12, 'more releases, higher attainment', 'end');
    quad(margin.left + 4, margin.top + plotH - 6, 'fewer releases, lower attainment', 'start');
    quad(width - margin.right - 4, margin.top + plotH - 6, 'more releases, lower attainment', 'end');

    for (const p of opts.points) {
      const cx = x(p.x);
      const cy = y(p.y);
      const rr = r(p.size);
      if (cx < margin.left - rr || cx > width - margin.right + rr || cy < margin.top - rr || cy > margin.top + plotH + rr) continue;
      svgEl('circle', { cx, cy, r: rr, fill: SERIES_1, 'fill-opacity': 0.8, class: 'viz-dot-ring viz-scatter-dot', 'data-id': p.id }, dotLayer);
    }
  }

  // --- zoom / pan mechanics -------------------------------------------------

  const MAX_ZOOM = 16;

  function clampView(): void {
    const spanX = Math.max((fullX1 - fullX0) / MAX_ZOOM, Math.min(vx1 - vx0, fullX1 - fullX0));
    const spanY = Math.max((fullY1 - fullY0) / MAX_ZOOM, Math.min(vy1 - vy0, fullY1 - fullY0));
    vx0 = Math.max(fullX0, Math.min(vx0, fullX1 - spanX));
    vx1 = vx0 + spanX;
    vy0 = Math.max(fullY0, Math.min(vy0, fullY1 - spanY));
    vy1 = vy0 + spanY;
  }

  // factor < 1 zooms in; anchor (data coords) keeps its screen position
  function zoom(factor: number, anchorLx?: number, anchorY?: number): void {
    const ax = anchorLx ?? (vx0 + vx1) / 2;
    const ay = anchorY ?? (vy0 + vy1) / 2;
    const fx = (ax - vx0) / (vx1 - vx0);
    const fy = (ay - vy0) / (vy1 - vy0);
    const spanX = (vx1 - vx0) * factor;
    const spanY = (vy1 - vy0) * factor;
    vx0 = ax - fx * spanX;
    vx1 = vx0 + spanX;
    vy0 = ay - fy * spanY;
    vy1 = vy0 + spanY;
    clampView();
    renderView();
  }

  function pointerData(e: { clientX: number; clientY: number }): { plx: number; py: number } {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const pyPix = ((e.clientY - rect.top) / rect.height) * height;
    return {
      plx: vx0 + ((px - margin.left) / plotW) * (vx1 - vx0),
      py: vy0 + (1 - (pyPix - margin.top) / plotH) * (vy1 - vy0),
    };
  }

  btnIn.addEventListener('click', () => zoom(0.6));
  btnOut.addEventListener('click', () => zoom(1 / 0.6));
  btnReset.addEventListener('click', () => {
    vx0 = fullX0; vx1 = fullX1; vy0 = fullY0; vy1 = fullY1;
    renderView();
  });

  // interaction layer on top of the dots
  const hit = svgEl('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH, fill: 'transparent', class: 'viz-scatter-hit' }, svg);

  hit.addEventListener('wheel', e => {
    e.preventDefault();
    const a = pointerData(e);
    zoom(e.deltaY < 0 ? 0.75 : 1 / 0.75, a.plx, a.py);
  }, { passive: false });
  hit.addEventListener('dblclick', e => {
    const a = pointerData(e);
    zoom(0.5, a.plx, a.py);
  });

  let drag: { lx: number; y: number; moved: boolean } | null = null;
  hit.addEventListener('pointerdown', e => {
    const a = pointerData(e);
    drag = { lx: a.plx, y: a.py, moved: false };
    hit.setPointerCapture?.(e.pointerId);
  });
  hit.addEventListener('pointerup', e => {
    const wasDrag = drag?.moved;
    drag = null;
    hit.releasePointerCapture?.(e.pointerId);
    if (!wasDrag && nearest && opts.onSelect) opts.onSelect(nearest.id);
  });
  hit.addEventListener('pointercancel', () => { drag = null; });

  let nearest: ScatterPoint | null = null;
  hit.addEventListener('pointermove', e => {
    if (drag) {
      const a = pointerData(e);
      const dx = drag.lx - a.plx;
      const dy = drag.y - a.py;
      if (Math.abs(dx) > (vx1 - vx0) / 200 || Math.abs(dy) > (vy1 - vy0) / 200) drag.moved = true;
      if (drag.moved) {
        vx0 += dx; vx1 += dx; vy0 += dy; vy1 += dy;
        clampView();
        renderView();
        hideTooltip();
        return;
      }
    }
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const py = ((e.clientY - rect.top) / rect.height) * height;
    let best: ScatterPoint | null = null;
    let bestD = Infinity;
    for (const p of opts.points) {
      const cx = x(p.x);
      const cy = y(p.y);
      if (cx < margin.left || cx > width - margin.right || cy < margin.top || cy > margin.top + plotH) continue;
      const d = (cx - px) ** 2 + (cy - py) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    nearest = best;
    if (best) {
      showTooltip(e.clientX, e.clientY, best.label, [
        { label: opts.xLabel, value: fmtCompact(best.x) },
        { label: opts.yLabel, value: `${(best.y * 100).toFixed(1)}%` },
        { label: 'games with tag', value: fmtCompact(best.size) },
      ]);
      for (const dot of dotLayer.querySelectorAll('.viz-scatter-dot')) dot.classList.toggle('is-hover', dot.getAttribute('data-id') === String(best.id));
    }
  });
  hit.addEventListener('pointerleave', () => {
    hideTooltip();
    nearest = null;
    drag = null;
    for (const dot of dotLayer.querySelectorAll('.viz-scatter-dot')) dot.classList.remove('is-hover');
  });

  renderView();

  tableTwin(wrap, ['Tag', opts.xLabel, opts.yLabel, 'Games'],
    [...opts.points].sort((a, b) => b.y - a.y)
      .map(p => [p.label, fmtCompact(p.x), `${(p.y * 100).toFixed(1)}%`, fmtCompact(p.size)]));
}
