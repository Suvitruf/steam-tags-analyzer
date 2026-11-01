import { getSegments, getAppById, getAppTags, getRetiredTags } from './db/queries';
import { recommend, type RecommendationProgressCallback } from './recommendation/engine';
import { listModels, DEFAULT_MODEL_KEY } from './llm/models';
import type { RecommendationInput, RecommendationOutput } from './types';
import { ensureDatabase, ensureRanker, ensureEmbeddingModel } from './runtime';
import { $, escapeHtml, tagPageUrl, renderSimilarGames } from './ui/helpers';
import { initAuditPage } from './audit/ui';

import { STEAM_PROXY_URL } from './config';

interface LiveApp { appid: number; name: string; tagIds: number[] }
let liveApp: LiveApp | null = null;    // last successful live lookup, if any

interface AppState {
  dbLoaded: boolean;
  model: string;
  analyzing: boolean;
}

const state: AppState = {
  dbLoaded: false,
  model: DEFAULT_MODEL_KEY,
  analyzing: false,
};

function setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const el = $('#status');
  if (!el) return;
  el.textContent = message;
  el.className = `status status-${type}`;
}

function setProgress(label: string, percent?: number): void {
  const el = $('#progress');
  if (!el) return;
  el.textContent = percent !== undefined ? `${label} (${percent.toFixed(0)}%)` : label;
}

function renderResults(output: RecommendationOutput): void {
  const container = $('#results');
  if (!container) return;

  const segmentInfo = output.segment
    ? `<p class="segment-info">Segment: <strong>${output.segment.main_tag_name}</strong> (${output.segment.game_count} games) &mdash; Confidence: ${(output.overallConfidence * 100).toFixed(0)}%</p>`
    : '<p class="segment-info">No segment matched &mdash; showing general recommendations</p>';

  // When analyzing an existing game, show which game and explain the badges.
  const appInfo = output.analyzedApp
    ? `<p class="app-info">Analyzing <strong>${output.analyzedApp.name}</strong> &mdash; <span class="badge badge-have">✓ already using</span> marks tags this game already has; the rest are suggestions.</p>`
    : '';

  // Normalize displayed strength to 0-100 across the shown tags so the
  // strongest recommendation reads as 100 and the rest are relative to it.
  // Raw scores stay in the tooltip for debugging.
  const shown = [...output.primaryTags, ...output.secondaryTags];
  const maxScore = shown.reduce((m, t) => Math.max(m, t.score), 0) || 1;
  const currentTags = new Set(output.currentTagIds ?? []);

  container.innerHTML = `
    ${appInfo}
    ${segmentInfo}
    <div class="results-grid">
      <div class="result-section result-primary">
        <h3>Recommended Primary Tags</h3>
        ${renderTagList(output.primaryTags, 'primary', maxScore, currentTags)}
      </div>
      <div class="result-section result-secondary">
        <h3>Secondary Tags</h3>
        ${renderTagList(output.secondaryTags, 'secondary', maxScore, currentTags)}
      </div>
      <div class="result-section result-avoid">
        <h3>Tags to Avoid</h3>
        ${renderTagList(output.avoidTags, 'avoid', maxScore, currentTags)}
      </div>
    </div>
    ${renderSimilarGames(output.similarGames)}
  `;
}

function renderTagList(tags: RecommendationOutput['primaryTags'], type: string, maxScore: number, currentTags: Set<number>): string {
  if (tags.length === 0) return '<p class="no-tags">No tags in this category</p>';

  return `<ol class="tag-list tag-list-${type}">
    ${tags.map((t) => {
      const strength = Math.round((t.score / maxScore) * 100);
      const haveBadge = currentTags.has(t.tagId)
        ? ' <span class="badge badge-have" title="This game already uses this tag">✓ already using</span>'
        : '';
      return `
      <li class="tag-item">
        <div class="tag-header">
          <span class="tag-name"><a class="tag-name-link" href="${tagPageUrl(t.tagId, t.tag)}" title="Open tag stats: distribution, trends, combos">${t.tag}</a>${haveBadge}</span>
          <span class="tag-score" title="Strength: ${strength}/100 · raw ${t.score.toFixed(3)} · relevance ${(t.relevance * 100).toFixed(0)}% · lift ${t.successLift.toFixed(1)}x">
            ${type === 'avoid' ? '⚠' : strength}
          </span>
        </div>
        <p class="tag-explanation">${t.explanation}</p>
        ${t.exemplarGames.length > 0
          ? `<p class="tag-exemplars">Examples: ${t.exemplarGames.map(g =>
              `<a class="exemplar-link" href="https://store.steampowered.com/app/${g.appid}/" target="_blank" rel="noopener noreferrer">${g.name}</a>`
            ).join(', ')}</p>`
          : ''}
      </li>
    `;
    }).join('')}
  </ol>`;
}

function populateMainTagDropdown(): void {
  const select = $('#main-tag') as HTMLSelectElement | null;
  if (!select) return;

  const segments = getSegments();
  const seen = new Set<number>();

  select.innerHTML = '<option value="">Auto-detect from description</option>';
  for (const seg of segments) {
    if (seen.has(seg.main_tag_id)) continue;
    seen.add(seg.main_tag_id);
    const option = document.createElement('option');
    option.value = seg.main_tag_name;
    option.textContent = `${seg.main_tag_name} (${seg.game_count} games)`;
    select.appendChild(option);
  }
}

/**
 * Warn when the looked-up game still carries a tag Valve has retired. Valve
 * ships taxonomy changes with no migration notice, so a store page can sit for
 * months spending a tag slot on something players can no longer browse by.
 */
function showRetiredTagWarning(tagIds: number[]): void {
  const host = $('#retired-warning');
  if (!host) return;
  host.replaceChildren();
  const retired = getRetiredTags(tagIds);
  if (retired.length === 0) return;

  const box = document.createElement('div');
  box.className = 'retired-tag-warning';
  const names = retired.map(t => escapeHtml(t.name)).join(', ');
  const dated = retired.filter(t => t.removed_at);
  box.innerHTML =
    `<strong>${retired.length === 1 ? 'Retired tag' : 'Retired tags'} on this game:</strong> ${names}. ` +
    `Valve no longer offers ${retired.length === 1 ? 'it' : 'them'} on store pages` +
    (dated.length ? ` (removed ${escapeHtml(dated[0].removed_at!.slice(0, 10))})` : '') +
    `, so ${retired.length === 1 ? 'it is' : 'they are'} spending a tag slot players can't browse by. ` +
    `The recommendations below only use active tags.`;
  host.appendChild(box);
}

async function handleAppIdLookup(): Promise<void> {
  liveApp = null;
  $('#retired-warning')?.replaceChildren();
  const appidInput = $('#appid') as HTMLInputElement | null;
  const desc = $('#description') as HTMLTextAreaElement | null;
  const id = parseInt(appidInput?.value.trim() ?? '', 10);
  if (isNaN(id)) return;

  // 1. local dataset
  const app = getAppById(id);
  if (app) {
    if (desc && app.short_description && !desc.value.trim()) desc.value = app.short_description;
    setStatus(`Loaded "${app.name}" — its tags will be marked in the results`, 'success');
    showRetiredTagWarning(getAppTags(id).map(t => t.tag_id));
    return;
  }

  // 2. live lookup via the Worker (if configured)
  if (!STEAM_PROXY_URL) {
    setStatus(`App ID ${id} isn't in the dataset (live lookup not configured)`, 'error');
    return;
  }
  try {
    setStatus(`Looking up App ID ${id} on Steam…`, 'info');
    const res = await fetch(`${STEAM_PROXY_URL}/app/${id}`);
    if (!res.ok) {
      setStatus(`Steam lookup failed for App ID ${id} (${res.status})`, 'error');
      return;
    }
    const data = await res.json() as { name: string; short_description: string; tags: Array<{ tagid: number }> };
    liveApp = { appid: id, name: data.name, tagIds: (data.tags ?? []).map(t => t.tagid) };
    if (desc && data.short_description && !desc.value.trim()) desc.value = data.short_description;
    setStatus(`Live: "${data.name}" — fetched from Steam; its tags will be marked`, 'success');
    showRetiredTagWarning(liveApp.tagIds);
  } catch (err) {
    setStatus(`Steam lookup error: ${(err as Error).message}`, 'error');
  }
}

async function handleAnalyze(): Promise<void> {
  if (state.analyzing) return;

  const description = ($('#description') as HTMLTextAreaElement)?.value?.trim();
  if (!description) {
    setStatus('Please enter a game description', 'error');
    return;
  }

  const mainTag = ($('#main-tag') as HTMLSelectElement)?.value || undefined;
  const appidStr = ($('#appid') as HTMLInputElement)?.value?.trim();
  const competitorsStr = ($('#competitors') as HTMLInputElement)?.value?.trim();

  const appid = appidStr ? parseInt(appidStr, 10) : undefined;
  // If we live-looked-up this exact App ID, pass its name + current tags through
  // so the engine can label it and badge tags it already uses.
  const live = appid && liveApp && liveApp.appid === appid ? liveApp : null;

  const input: RecommendationInput = {
    description,
    mainTag,
    appid,
    competitorAppids: competitorsStr
      ? competitorsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      : undefined,
    appName: live?.name,
    currentTagIds: live?.tagIds,
  };

  state.analyzing = true;
  const btn = $('#analyze-btn') as HTMLButtonElement;
  if (btn) btn.disabled = true;

  const model = state.model;

  try {
    // Both are memoized per model (runtime.ts): instant when already loaded.
    setStatus(`Loading ranker (${model})...`);
    await ensureRanker(model);

    setStatus(`Loading embedding model (${model})...`);
    await ensureEmbeddingModel(model, (p) => {
      if (p.progress !== undefined) setProgress('Loading model', p.progress);
    });

    const onProgress: RecommendationProgressCallback = (stage, detail) => {
      setStatus(`${stage}${detail ? ` — ${detail}` : ''}`, 'info');
    };

    const result = await recommend(input, onProgress, model);
    renderResults(result);
    setStatus('Analysis complete', 'success');
  } catch (err) {
    const msg = (err as Error).message;
    // A missing ranker JSON / ONNX model means this model hasn't been built yet.
    const looksUnbuilt = /Failed to load ranker|hasn't been built|Could not locate|404/.test(msg);
    const hint = looksUnbuilt
      ? ` — model "${model}" is currently unavailable. Try another model or retry later.`
      : '';
    setStatus(`Error: ${msg}${hint}`, 'error');
    console.error(err);
  } finally {
    state.analyzing = false;
    if (btn) btn.disabled = false;
    setProgress('');
  }
}

function buildUI(): void {
  const container = $('#analyzer-app');
  if (!container) return;

  const modelOptions = listModels()
    .map(m => `<option value="${m.key}"${m.key === state.model ? ' selected' : ''}>${m.label}</option>`)
    .join('');

  container.innerHTML = `
    <div class="model-bar">
      <label for="model-select">Embedding model</label>
      <select id="model-select">${modelOptions}</select>
    </div>

    <div id="status" class="status status-info">Loading database...</div>
    <div id="progress" class="progress"></div>
    <div id="retired-warning"></div>

    <form id="analyzer-form" class="analyzer-form">
      <div class="form-group">
        <label for="description">Game Description</label>
        <textarea id="description" rows="4" placeholder="Turn-based tactical roguelite with deckbuilding and dark fantasy setting"></textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="main-tag">Main Genre/Tag</label>
          <select id="main-tag">
            <option value="">Loading...</option>
          </select>
        </div>

        <div class="form-group">
          <label for="appid">Steam App ID (optional)</label>
          <input type="text" id="appid" placeholder="e.g. 2738490">
        </div>
      </div>

      <div class="form-group">
        <label for="competitors">Competitor App IDs (optional, comma-separated)</label>
        <input type="text" id="competitors" placeholder="e.g. 1313140, 718670, 294100">
      </div>

      <button type="submit" id="analyze-btn" class="btn-analyze" disabled>
        Loading...
      </button>
    </form>

    <div id="results" class="results"></div>
  `;
}

async function init(): Promise<void> {
  // This bundle is included site-wide by the Jekyll layout; only the analyzer
  // and the tag audit pages have a container. Bail out early everywhere else
  // or every page would download the full SQLite DB.
  const auditHost = $('#audit-app');
  if (auditHost) {
    void initAuditPage(auditHost);
    return;
  }
  if (!$('#analyzer-app')) return;

  buildUI();

  try {
    setStatus('Loading database...');
    await ensureDatabase();
    state.dbLoaded = true;

    // Ranker and embedding model are loaded lazily on first analyze, per the
    // selected model, so switching models doesn't reload anything until needed.
    setStatus('Ready', 'success');

    populateMainTagDropdown();

    // Deep link from the analytics pages: /analyzer?tag=Roguelike%20Deckbuilder
    // preselects the main tag.
    const prefillTag = new URLSearchParams(location.search).get('tag');
    if (prefillTag) {
      const select = $('#main-tag') as HTMLSelectElement | null;
      const match = select && [...select.options].find(o => o.value.toLowerCase() === prefillTag.toLowerCase());
      if (select && match) select.value = match.value;
    }

    const btn = $('#analyze-btn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Analyze Tags';
    }

    const form = $('#analyzer-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAnalyze();
    });

    const modelSelect = $('#model-select') as HTMLSelectElement | null;
    modelSelect?.addEventListener('change', () => {
      state.model = modelSelect.value;
      setStatus(`Model set to ${modelSelect.value} — loads on next analyze`, 'info');
    });

    // Look the game up by App ID and pull in its real Steam description.
    // Local DB first; for games not in the dataset, fall back to the live Worker.
    const appidInput = $('#appid') as HTMLInputElement | null;
    appidInput?.addEventListener('change', () => { void handleAppIdLookup(); });
  } catch (err) {
    setStatus(`Failed to load database: ${(err as Error).message}`, 'error');
    console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
