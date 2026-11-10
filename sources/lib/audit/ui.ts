// Tag audit page (#audit-app): the analyzer's engine pointed at a released
// game's store page. Shares the analyzer's loaders (runtime.ts) and bundle;
// the logic lives in recommendation/audit.ts.
import { auditGame, AUDIT, type TagAudit, type AuditedTag, type AuditBucket } from '../recommendation/audit';
import { ensureDatabase, ensureRanker, ensureEmbeddingModel } from '../runtime';
import { listModels, DEFAULT_MODEL_KEY } from '../llm/models';
import { getAppById } from '../db/queries';
import { STEAM_PROXY_URL } from '../config';
import {
  $, escapeHtml, fmtReviews, tagPageUrl, storeUrl, parseAppIdInput, renderSimilarGames,
} from '../ui/helpers';
import { ProgressBar, modelProgressHandler } from '../ui/progress';
import type { TagRecommendation } from '../types';

const BUCKET_LABEL: Record<AuditBucket, string> = {
  identity: 'Identity',
  feature: 'Store feature',
  neutral: 'Neutral',
  weak: 'Weakly supported',
  suspicious: 'Suspicious',
  retired: 'Retired',
};

const BUCKET_HELP: Record<AuditBucket, string> = {
  identity: 'describes the game: matches the description and/or what games like it are tagged',
  feature: "verified by Steam's own feature list (co-op, PvP, controller support…), which players can't vote on",
  neutral: 'praise, packaging or a near-universal tag; says little about what the game is',
  weak: 'neither the description nor similar games back it up; not necessarily wrong',
  suspicious: 'far from the description and almost never on similar games: a community joke or a stray vote',
  retired: 'Valve removed this tag from the taxonomy',
};

// Legend/summary order: good news first, problems last.
const BUCKET_ORDER: AuditBucket[] = ['identity', 'feature', 'neutral', 'weak', 'suspicious', 'retired'];

interface LiveApp { name: string; short_description: string; tagIds: number[] }

let modelKey = DEFAULT_MODEL_KEY;
let running = false;
// Mounted in #audit-progress once buildUI() has rendered it.
let progress = new ProgressBar(null);

function setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const el = $('#audit-status');
  if (!el) return;
  el.textContent = message;
  el.className = `status status-${type}`;
}

function buildUI(container: HTMLElement): void {
  const modelOptions = listModels()
    .map(m => `<option value="${m.key}"${m.key === modelKey ? ' selected' : ''}>${m.label}</option>`)
    .join('');

  container.innerHTML = `
    <p class="analytics-intro">Paste a released game's App ID or store URL. The audit reads its store
    description and current tags, then sorts the tags into what actually describes the game, what
    Steam's feature list verifies, what's neutral, and what looks like a community joke — using the
    same engine as the <a href="${import.meta.env.DEV ? '/' : 'analyzer'}">Analyzer</a>. It also
    lists tags that games like this one carry and this page doesn't.</p>

    <div class="model-bar">
      <label for="audit-model-select">Embedding model</label>
      <select id="audit-model-select">${modelOptions}</select>
    </div>

    <div id="audit-status" class="status status-info">Loading database...</div>
    <div id="audit-progress" class="progress"></div>

    <form id="audit-form" class="analyzer-form">
      <div class="form-group">
        <label for="audit-appid">Steam App ID or store URL</label>
        <input type="text" id="audit-appid" placeholder="e.g. 1245620 or https://store.steampowered.com/app/1245620/">
      </div>
      <button type="submit" id="audit-btn" class="btn-analyze" disabled>Loading...</button>
    </form>

    <div id="audit-results" class="results"></div>
  `;
}

async function liveLookup(appid: number): Promise<LiveApp> {
  if (!STEAM_PROXY_URL) {
    throw new Error(`App ID ${appid} isn't in the dataset (live lookup not configured)`);
  }
  setStatus(`Looking up App ID ${appid} on Steam…`);
  const res = await fetch(`${STEAM_PROXY_URL}/app/${appid}`);
  if (!res.ok) throw new Error(`Steam lookup failed for App ID ${appid} (${res.status})`);
  const data = await res.json() as { name: string; short_description: string; tags: Array<{ tagid: number }> };
  return { name: data.name, short_description: data.short_description ?? '', tagIds: (data.tags ?? []).map(t => t.tagid) };
}

async function run(appid: number): Promise<void> {
  if (running) return;
  running = true;
  const btn = $('#audit-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  const results = $('#audit-results');
  if (results) results.innerHTML = '';

  try {
    const live = getAppById(appid) ? undefined : await liveLookup(appid);

    setStatus(`Loading ranker (${modelKey})...`);
    await ensureRanker(modelKey, (loaded, total) => progress.set(`Downloading ranker (${modelKey})`, loaded, total));
    setStatus(`Loading embedding model (${modelKey})...`);
    await ensureEmbeddingModel(modelKey, modelProgressHandler(progress, modelKey));
    progress.hide();

    const audit = await auditGame(
      { appid, live },
      (stage, detail, bytes) => {
        setStatus(`${stage}${detail ? ` — ${detail}` : ''}`);
        if (bytes) progress.set('Downloading game index', bytes.loaded, bytes.total);
        else progress.hide();
      },
      modelKey
    );
    render(audit);
    // Shareable link to this exact audit.
    const url = new URL(location.href);
    url.searchParams.set('appid', String(appid));
    history.replaceState(null, '', url);
    setStatus('Audit complete', 'success');
  } catch (err) {
    const msg = (err as Error).message;
    const looksUnbuilt = /Failed to load ranker|hasn't been built|Could not locate|404/.test(msg);
    const hint = looksUnbuilt
      ? ` — model "${modelKey}" is currently unavailable. Try another model or retry later.`
      : '';
    setStatus(`Error: ${msg}${hint}`, 'error');
    console.error(err);
  } finally {
    running = false;
    if (btn) btn.disabled = false;
    progress.hide();
  }
}

function renderBadge(bucket: AuditBucket): string {
  return `<span class="badge badge-${bucket}" title="${escapeHtml(BUCKET_HELP[bucket])}">${BUCKET_LABEL[bucket]}</span>`;
}

function renderTagRow(t: AuditedTag, neighborEvidenceAvailable: boolean): string {
  const tooltip = `relevance ${(t.similarity * 100).toFixed(0)}% · ` +
    (neighborEvidenceAvailable ? `neighbor vote ${(t.neighborVote * 100).toFixed(0)}%` : 'similar-game tag data unavailable or incomplete') +
    (t.verifiedBy.length ? ` · store features: ${t.verifiedBy.join(', ')}` : '');
  const name = t.active
    ? `<a class="tag-name-link" href="${tagPageUrl(t.tagId, t.tag)}" title="Open tag stats: distribution, trends, combos">${escapeHtml(t.tag)}</a>`
    : escapeHtml(t.tag);
  return `
    <li class="audit-row audit-${t.bucket}" title="${escapeHtml(tooltip)}">
      <span class="audit-rank">#${t.rank}</span>
      <span class="audit-tag">${name} ${renderBadge(t.bucket)}</span>
      <span class="audit-reason">${escapeHtml(t.reason)}</span>
    </li>`;
}

function renderRecList(tags: TagRecommendation[], type: 'add' | 'avoid'): string {
  if (tags.length === 0) {
    return `<p class="no-tags">${type === 'add' ? 'Nothing obvious is missing.' : 'No tempting-but-wrong tags for this game.'}</p>`;
  }
  const maxScore = tags.reduce((m, t) => Math.max(m, t.score), 0) || 1;
  return `<ol class="tag-list tag-list-${type}">
    ${tags.map(t => {
      const strength = Math.round((t.score / maxScore) * 100);
      return `
      <li class="tag-item">
        <div class="tag-header">
          <span class="tag-name"><a class="tag-name-link" href="${tagPageUrl(t.tagId, t.tag)}" title="Open tag stats: distribution, trends, combos">${escapeHtml(t.tag)}</a></span>
          <span class="tag-score" title="Strength: ${strength}/100 · raw ${t.score.toFixed(3)} · relevance ${(t.relevance * 100).toFixed(0)}% · lift ${t.successLift.toFixed(1)}x">
            ${type === 'avoid' ? '⚠' : strength}
          </span>
        </div>
        <p class="tag-explanation">${escapeHtml(t.explanation)}</p>
      </li>`;
    }).join('')}
  </ol>`;
}

function render(audit: TagAudit): void {
  const container = $('#audit-results');
  if (!container) return;

  const summary = BUCKET_ORDER
    .filter(b => audit.counts[b] > 0)
    .map(b => `<span class="audit-count audit-${b}">${audit.counts[b]} ${BUCKET_LABEL[b].toLowerCase()}</span>`)
    .join(' · ');

  const segment = audit.segment
    ? `segment <strong>${escapeHtml(audit.segment.main_tag_name)}</strong> (${audit.segment.game_count} games)`
    : 'no segment matched';

  const thin = audit.signal.thin
    ? `<div class="audit-thin"><strong>${audit.signal.neighborEvidenceAvailable ? 'Thin signal.' : 'Limited evidence.'}</strong> ${escapeHtml(audit.signal.reason ?? '')}
        Read the verdicts below as hints, not findings.</div>`
    : '';

  const legend = `<div class="audit-legend">${BUCKET_ORDER.map(b =>
    `<span>${renderBadge(b)} ${escapeHtml(BUCKET_HELP[b])}</span>`
  ).join('')}</div>`;

  const order = audit.orderNotes.length
    ? `<div class="audit-note"><strong>Order check.</strong> ${audit.orderNotes.map(escapeHtml).join(' ')}</div>`
    : '';

  container.innerHTML = `
    <p class="app-info">Auditing <strong><a href="${storeUrl(audit.app.appid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(audit.app.name)}</a></strong>
      ${audit.app.live ? '(live from Steam, not in the dataset — store features unavailable)' : ''}
      &mdash; ${audit.tags.length} tags on the store page, ${segment}.
      <span class="audit-summary">${summary}</span></p>
    ${thin}
    <div class="result-section audit-section">
      <h3>Current tags, in store order</h3>
      ${legend}
      <ol class="audit-list">${audit.tags.map(t => renderTagRow(t, audit.signal.neighborEvidenceAvailable)).join('')}</ol>
    </div>
    ${order}
    <div class="results-grid audit-grid">
      <div class="result-section result-primary">
        <h3>Consider adding</h3>
        <p class="similar-games-note">Tags the engine recommends for this description that the page doesn't carry.</p>
        ${renderRecList(audit.missing, 'add')}
        ${audit.missingContradicted.length
          ? `<p class="similar-games-note">Not suggested: ${audit.missingContradicted.map(t => escapeHtml(t.tag)).join(', ')} — the store's feature list doesn't include what ${audit.missingContradicted.length === 1 ? 'it requires' : 'they require'}.</p>`
          : ''}
      </div>
      <div class="result-section result-avoid">
        <h3>Tags to avoid</h3>
        <p class="similar-games-note">Strong in the segment, wrong for this game.</p>
        ${audit.signal.neighborEvidenceAvailable ? renderRecList(audit.avoid, 'avoid') : '<p class="no-tags">Avoid suggestions are unavailable until similar-game tag data is available.</p>'}
      </div>
    </div>
    ${renderSimilarGames(audit.similarGames, {
      title: 'Games most like this one',
      note: `Nearest games to the store description (the game itself excluded) — their tags are the neighbor vote. Threshold for "thin": ${(AUDIT.THIN_SIGNAL_SIM * 100).toFixed(0)}% top match.`,
    })}
  `;
}

export async function initAuditPage(container: HTMLElement): Promise<void> {
  buildUI(container);
  progress = new ProgressBar($('#audit-progress'));

  try {
    setStatus('Loading database...');
    await ensureDatabase(e => {
      if (e.phase === 'download') progress.set('Downloading database', e.loaded, e.total);
      else progress.busy('Opening database');
    });
    progress.hide();
    setStatus('Ready', 'success');

    const btn = $('#audit-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Audit tags';
    }

    const input = $('#audit-appid') as HTMLInputElement | null;
    $('#audit-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const appid = parseAppIdInput(input?.value ?? '');
      if (appid === null) {
        setStatus('Enter a Steam App ID or a store page URL', 'error');
        return;
      }
      void run(appid);
    });

    const modelSelect = $('#audit-model-select') as HTMLSelectElement | null;
    modelSelect?.addEventListener('change', () => {
      modelKey = modelSelect.value;
      setStatus(`Model set to ${modelKey} — loads on next audit`, 'info');
    });

    // Deep link: /audit?appid=1245620 runs immediately.
    const prefill = new URLSearchParams(location.search).get('appid');
    const appid = prefill ? parseAppIdInput(prefill) : null;
    if (appid !== null) {
      if (input) input.value = String(appid);
      void run(appid);
    }
  } catch (err) {
    progress.hide();
    setStatus(`Failed to load database: ${(err as Error).message}`, 'error');
    console.error(err);
  }
}
