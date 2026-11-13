import { getSegments, getAppById, getAppTags, getRetiredTags } from './db/queries';
import { recommend, type RecommendationProgressCallback } from './recommendation/engine';
import { listModels, DEFAULT_MODEL_KEY } from './llm/models';
import type { RecommendationInput, RecommendationOutput } from './types';
import { ensureDatabase, ensureModel, type ModelProgress } from './runtime';
import { $, escapeHtml, showMatchedSetWarning } from './ui/helpers';
import { renderResultsHtml } from './ui/results';
import { ProgressBar, modelProgressHandler } from './ui/progress';
import { initAuditPage } from './audit/ui';

import { fetchLiveApp, liveLookupEnabled } from './live';

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

// Mounted in #progress once buildUI() has rendered it.
let progress = new ProgressBar(null);

function setStatus(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const el = $('#status');
  if (!el) return;
  el.textContent = message;
  el.className = `status status-${type}`;
}

function renderResults(output: RecommendationOutput): void {
  const container = $('#results');
  if (!container) return;
  container.innerHTML = renderResultsHtml(output);
}

function modelProgress(model: string): ModelProgress {
  return {
    ranker: (loaded, total) => progress.set(`Downloading ranker (${model})`, loaded, total),
    model: modelProgressHandler(progress, model),
    index: (loaded, total) => progress.set('Downloading game index', loaded, total),
  };
}

// Background load of a model's files; a failure is left for the next analysis
// to retry and report, with its hint about unbuilt models.
function warmModel(model: string): void {
  ensureModel(model, modelProgress(model)).then(
    () => progress.hide(),
    err => {
      progress.hide();
      console.warn(`Preloading model ${model} failed; the next analysis retries:`, (err as Error).message);
    }
  );
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
  if (!liveLookupEnabled) {
    setStatus(`App ID ${id} isn't in the dataset (live lookup not configured)`, 'error');
    return;
  }
  try {
    setStatus(`Looking up App ID ${id} on Steam…`, 'info');
    const data = await fetchLiveApp(id);
    liveApp = { appid: id, name: data.name, tagIds: data.tagIds };
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
    // Ranker, encoder and game index: usually loaded already by the warm-up
    // that started when the database opened (runtime.ts), so this resolves at
    // once; otherwise it waits its turn and the bar shows what is downloading.
    // The report says whether those files are the set the database's
    // centroids were built with.
    setStatus(`Loading model files (${model})...`);
    showMatchedSetWarning(await ensureModel(model, modelProgress(model)), $('#status'));
    progress.hide();

    const onProgress: RecommendationProgressCallback = (stage, detail, bytes) => {
      setStatus(`${stage}${detail ? ` — ${detail}` : ''}`, 'info');
      if (bytes) progress.set('Downloading game index', bytes.loaded, bytes.total);
      else progress.hide();
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
    progress.hide();
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
  progress = new ProgressBar($('#progress'));

  try {
    setStatus('Loading database...');
    await ensureDatabase(e => {
      if (e.phase === 'download') progress.set('Downloading database', e.loaded, e.total);
      else progress.busy('Opening database');
    });
    progress.hide();
    state.dbLoaded = true;

    setStatus('Ready', 'success');
    // The model's files load now, while the visitor reads and types, so the
    // first click does not wait for them. They need the open database to name
    // the set (runtime.ts).
    warmModel(state.model);

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
      setStatus(`Model set to ${modelSelect.value}`, 'info');
      warmModel(state.model);
    });

    // Look the game up by App ID and pull in its real Steam description.
    // Local DB first; for games not in the dataset, fall back to the live Worker.
    const appidInput = $('#appid') as HTMLInputElement | null;
    appidInput?.addEventListener('change', () => { void handleAppIdLookup(); });
  } catch (err) {
    progress.hide();
    setStatus(`Failed to load database: ${(err as Error).message}`, 'error');
    console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
