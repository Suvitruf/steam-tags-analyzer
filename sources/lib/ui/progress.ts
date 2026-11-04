// Progress bar for the heavy loads: the SQLite DB on page open, then the
// ranker, embedding model and kNN blob on first analyze. One instance per
// page, mounted in the page's `.progress` host under the status line.
// Determinate when the loader knows the total, otherwise a sweeping bar with
// the byte count so far. Updates are coalesced to one DOM write per frame: a
// 390 MB stream reports thousands of chunks.
import type { ProgressCallback } from '../llm/engine';

const UNITS: Array<[number, string]> = [[1e9, 'GB'], [1e6, 'MB'], [1e3, 'KB']];

export function fmtBytes(n: number): string {
  for (const [size, unit] of UNITS) {
    if (n >= size) return `${trimNum(n / size)} ${unit}`;
  }
  return `${Math.round(n)} B`;
}

// "112 / 388 MB": both numbers in the unit the total picks.
export function fmtBytePair(loaded: number, total: number): string {
  for (const [size, unit] of UNITS) {
    if (total >= size) return `${trimNum(loaded / size)} / ${trimNum(total / size)} ${unit}`;
  }
  return `${Math.round(loaded)} / ${Math.round(total)} B`;
}

function trimNum(x: number): string {
  return x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
}

interface ProgressState {
  label: string;
  loaded?: number;
  total?: number | null;
  detail?: string;
}

export class ProgressBar {
  private root: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private fillEl: HTMLElement | null = null;
  private pending: ProgressState | null = null;
  private frame = 0;

  constructor(private host: HTMLElement | null) {}

  /** Bytes-based update: determinate when `total` is known. */
  set(label: string, loaded?: number, total?: number | null, detail?: string): void {
    this.pending = { label, loaded, total, detail };
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
    }
  }

  /** A phase with no measurable progress (opening the DB, compiling the model). */
  busy(label: string, detail?: string): void {
    this.set(label, undefined, null, detail);
  }

  hide(): void {
    this.pending = null;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.root?.remove();
    this.root = this.labelEl = this.detailEl = this.fillEl = null;
  }

  private mount(): void {
    if (this.root || !this.host) return;
    const root = document.createElement('div');
    root.className = 'load-progress';
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.innerHTML =
      '<div class="load-progress-head"><span class="load-progress-label"></span><span class="load-progress-detail"></span></div>' +
      '<div class="load-progress-track"><div class="load-progress-fill"></div></div>';
    this.labelEl = root.querySelector('.load-progress-label');
    this.detailEl = root.querySelector('.load-progress-detail');
    this.fillEl = root.querySelector('.load-progress-fill');
    this.host.replaceChildren(root);
    this.root = root;
  }

  private paint(): void {
    const s = this.pending;
    if (!s) return;
    this.mount();
    if (!this.root || !this.labelEl || !this.detailEl || !this.fillEl) return;

    const determinate = typeof s.loaded === 'number' && typeof s.total === 'number' && s.total > 0;
    this.root.classList.toggle('load-progress-indeterminate', !determinate);
    this.labelEl.textContent = s.label;
    this.root.setAttribute('aria-label', s.label);

    const parts: string[] = [];
    if (s.detail) parts.push(s.detail);
    if (determinate) {
      const pct = Math.min(100, (s.loaded! / s.total!) * 100);
      this.fillEl.style.width = `${pct.toFixed(1)}%`;
      this.root.setAttribute('aria-valuenow', String(Math.round(pct)));
      parts.push(fmtBytePair(s.loaded!, s.total!), `${Math.round(pct)}%`);
    } else {
      this.fillEl.style.width = '';
      this.root.removeAttribute('aria-valuenow');
      if (typeof s.loaded === 'number' && s.loaded > 0) parts.push(fmtBytes(s.loaded));
    }
    this.detailEl.textContent = parts.join(' · ');
  }
}

/**
 * Adapter for the transformers.js events the embedding worker relays. They
 * arrive per file (tokenizer, config, then onnx/model_quantized.onnx): the
 * ONNX file is ~99% of the bytes, so the small ones flash by; a cached load
 * emits only initiate/done pairs and the bar never settles on a percentage.
 * `total` is 0 when the server sent no Content-Length, which set() treats as
 * indeterminate. The gap between the last file's `done` and the worker's
 * reply is the ONNX session compile (~1.5 s on gte-base).
 */
export function modelProgressHandler(bar: ProgressBar, modelKey: string): ProgressCallback {
  const label = `Downloading model (${modelKey})`;
  return (p) => {
    const e = p as { status: string; file?: string; loaded?: number; total?: number };
    const file = e.file ? e.file.slice(e.file.lastIndexOf('/') + 1) : undefined;
    switch (e.status) {
      case 'initiate':
      case 'download':
        bar.busy(label, file);
        break;
      case 'progress':
        bar.set(label, e.loaded, e.total ?? null, file);
        break;
      case 'done':
        bar.busy(`Preparing model (${modelKey})`);
        break;
      default:
        break;
    }
  };
}
