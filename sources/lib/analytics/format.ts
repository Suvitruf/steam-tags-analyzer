export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function fmtPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtLift(x: number): string {
  return `${x.toFixed(1)}×`;
}

/** Human label for a log2(reviews+1) histogram bucket. */
export function histBucketLabel(bucket: number): string {
  const lo = bucket === 0 ? 0 : 2 ** bucket - 1;
  const hi = 2 ** (bucket + 1) - 2;
  if (bucket === 0) return '0';
  if (lo === hi) return fmtCompact(lo);
  return `${fmtCompact(lo)}–${fmtCompact(hi)}`;
}

/** el('div', 'class', parent) — tiny DOM helper; text goes in via textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Element
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}
