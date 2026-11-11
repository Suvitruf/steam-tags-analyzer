// Tag audit page (#audit-app): the analyzer's engine pointed at a released
// game's store page. Shares the analyzer's loaders (runtime.ts) and bundle;
// the logic lives in recommendation/audit.ts.
import { auditGame, AUDIT, type TagAudit, type AuditedTag, type AuditBucket } from '../recommendation/audit';
import { ensureDatabase, ensureRanker, ensureEmbeddingModel, ensureMatchedSet } from '../runtime';
import { listModels, DEFAULT_MODEL_KEY } from '../llm/models';
import { getAppById } from '../db/queries';
import { fetchLiveApp, liveLookupEnabled, type LiveApp } from '../live';
import {
  $, escapeHtml, fmtReviews, tagPageUrl, storeUrl, parseAppIdInput, renderSimilarGames, showMatchedSetWarning,
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
      <div class="form-actions">
        <button type="submit" id="audit-btn" class="btn-analyze" disabled>Loading...</button>
        ${liveLookupEnabled
          ? `<button type="button" id="audit-refresh-btn" class="btn-secondary" disabled
               title="Fetch the page's current tags and store features from Steam and audit those instead of the dataset snapshot">Refresh from Steam</button>`
          : ''}
      </div>
    </form>

    <div id="audit-results" class="results"></div>
  `;
}

function setButtonsDisabled(disabled: boolean): void {
  for (const id of ['#audit-btn', '#audit-refresh-btn']) {
    const b = $(id) as HTMLButtonElement | null;
    if (b) b.disabled = disabled;
  }
}

// `fresh`: fetch the page's current tags and store features from Steam even
// when the dataset has this game, and audit those instead of the snapshot.
async function run(appid: number, fresh = false): Promise<void> {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  const results = $('#audit-results');
  if (results) results.innerHTML = '';

  try {
    const inDataset = getAppById(appid) !== null;
    if (!inDataset && !liveLookupEnabled) {
      throw new Error(`App ID ${appid} isn't in the dataset (live lookup not configured)`);
    }
    let live: LiveApp | undefined;
    if (fresh || !inDataset) {
      setStatus(fresh ? `Fetching the current store page for App ID ${appid} from Steam…` : `Looking up App ID ${appid} on Steam…`);
      live = await fetchLiveApp(appid, { fresh });
    }

    setStatus(`Loading ranker (${modelKey})...`);
    await ensureRanker(modelKey, (loaded, total) => progress.set(`Downloading ranker (${modelKey})`, loaded, total));
    setStatus(`Loading embedding model (${modelKey})...`);
    await ensureEmbeddingModel(modelKey, modelProgressHandler(progress, modelKey));
    setStatus(`Checking model files (${modelKey})...`);
    showMatchedSetWarning(
      await ensureMatchedSet(modelKey, (loaded, total) => progress.set('Downloading game index', loaded, total)),
      $('#audit-status')
    );
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
    if (fresh) url.searchParams.set('live', '1');
    else url.searchParams.delete('live');
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
    setButtonsDisabled(false);
    progress.hide();
  }
}

// Where the audited tags came from, and how old they are.
function sourceNote(audit: TagAudit): string {
  const features = audit.featuresKnown ? '' : '; store features unavailable';
  if (audit.app.live && !audit.app.inDataset) return `(live from Steam, not in the dataset${features})`;
  if (audit.app.live) return `(current store page, fetched from Steam just now${features})`;
  const date = audit.snapshotCollectedAt?.slice(0, 10);
  return `(dataset snapshot${date ? ` from ${escapeHtml(date)}` : ''}${features})`;
}

// A live refresh of a dataset game: what changed on the page since the snapshot.
function snapshotNote(audit: TagAudit): string {
  if (!audit.liveDiff) return '';
  const date = audit.snapshotCollectedAt?.slice(0, 10);
  const since = `since the dataset snapshot${date ? ` of ${escapeHtml(date)}` : ''}`;
  const { added, removed } = audit.liveDiff;
  if (added.length === 0 && removed.length === 0) {
    return `<div class="audit-note audit-diff"><strong>No tag changes</strong> ${since}.</div>`;
  }
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.map(escapeHtml).join(', ')}`);
  if (removed.length) parts.push(`dropped ${removed.map(escapeHtml).join(', ')}`);
  return `<div class="audit-note audit-diff"><strong>Changed ${since}:</strong> ${parts.join('; ')}.</div>`;
}

function renderBadge(bucket: AuditBucket): string {
  return `<span class="badge badge-${bucket}" title="${escapeHtml(BUCKET_HELP[bucket])}">${BUCKET_LABEL[bucket]}</span>`;
}

function renderTagRow(t: AuditedTag, neighborEvidenceAvailable: boolean): string {
  const tooltip = `similarity ${t.similarity.toFixed(2)} · ` +
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
    return `<p class="no-tags">${type === 'add' ? 'Nothing obvious is missing.' : 'No high-lift segment tags unsupported by this description.'}</p>`;
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
      ${sourceNote(audit)}
      &mdash; ${audit.tags.length} tags on the store page, ${segment}.
      <span class="audit-summary">${summary}</span></p>
    ${snapshotNote(audit)}
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
        <p class="similar-games-note">Strong in the segment, unsupported by this description — confirm before using.</p>
        ${audit.signal.neighborEvidenceAvailable ? renderRecList(audit.avoid, 'avoid') : '<p class="no-tags">Avoid suggestions are unavailable until similar-game tag data is available.</p>'}
      </div>
    </div>
    ${renderSimilarGames(audit.similarGames, {
      title: 'Games most like this one',
      note: `Nearest games to the store description (the game itself excluded) — their tags are the neighbor vote. Similarity is a cosine, not a match probability; "thin" below ${AUDIT.THIN_SIGNAL_SIM.toFixed(2)} for the nearest game.`,
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
    const submit = (fresh: boolean) => {
      const appid = parseAppIdInput(input?.value ?? '');
      if (appid === null) {
        setStatus('Enter a Steam App ID or a store page URL', 'error');
        return;
      }
      void run(appid, fresh);
    };
    $('#audit-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(false);
    });
    const refreshBtn = $('#audit-refresh-btn') as HTMLButtonElement | null;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.addEventListener('click', () => submit(true));
    }

    const modelSelect = $('#audit-model-select') as HTMLSelectElement | null;
    modelSelect?.addEventListener('change', () => {
      modelKey = modelSelect.value;
      setStatus(`Model set to ${modelKey} — loads on next audit`, 'info');
    });

    // Deep link: /audit?appid=1245620 runs immediately; &live=1 audits the
    // current store page instead of the dataset snapshot.
    const params = new URLSearchParams(location.search);
    const prefill = params.get('appid');
    const appid = prefill ? parseAppIdInput(prefill) : null;
    if (appid !== null) {
      if (input) input.value = String(appid);
      void run(appid, params.get('live') === '1' && liveLookupEnabled);
    }
  } catch (err) {
    progress.hide();
    setStatus(`Failed to load database: ${(err as Error).message}`, 'error');
    console.error(err);
  }
}
