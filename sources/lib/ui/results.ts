// HTML for the analyzer's result panel (main.ts), as pure string builders so
// the escaping can be checked outside a DOM.
// Every Steam-sourced string — game names, exemplar names, tag names and the
// explanations that embed them — goes through escapeHtml; the only raw
// interpolations are numbers and our own literals.
import type { RecommendationOutput, TagRecommendation } from '../types';
import { escapeHtml, tagPageUrl, storeUrl, renderSimilarGames } from './helpers';

export function renderResultsHtml(output: RecommendationOutput): string {
  const segmentInfo = output.segment
    ? `<p class="segment-info">Segment: <strong>${escapeHtml(output.segment.main_tag_name)}</strong> (${output.segment.game_count} games${output.segmentInferred ? ', inferred from the description' : ''})</p>`
    : '<p class="segment-info">No segment matched &mdash; showing general recommendations</p>';
  const caveats = evidenceCaveats(output);
  const evidenceInfo = caveats.length
    ? `<p class="similar-games-note segment-evidence">${caveats.map(escapeHtml).join(' ')}</p>`
    : '';

  // When analyzing an existing game, show which game and explain the badges.
  const appInfo = output.analyzedApp
    ? `<p class="app-info">Analyzing <strong>${escapeHtml(output.analyzedApp.name)}</strong> &mdash; <span class="badge badge-have">✓ already using</span> marks tags this game already has; the rest are suggestions.</p>`
    : '';

  // Normalize displayed strength to 0-100 across the shown tags so the
  // strongest recommendation reads as 100 and the rest are relative to it.
  // Raw scores stay in the tooltip for debugging.
  const shown = [...output.primaryTags, ...output.secondaryTags];
  const maxScore = shown.reduce((m, t) => Math.max(m, t.score), 0) || 1;
  const currentTags = new Set(output.currentTagIds ?? []);

  return `
    ${appInfo}
    ${segmentInfo}
    ${evidenceInfo}
    <div class="results-grid">
      <div class="result-section result-primary">
        <h3>Recommended Primary Tags</h3>
        ${renderTagListHtml(output.primaryTags, 'primary', maxScore, currentTags)}
      </div>
      <div class="result-section result-secondary">
        <h3>Secondary Tags</h3>
        ${renderTagListHtml(output.secondaryTags, 'secondary', maxScore, currentTags)}
      </div>
      <div class="result-section result-avoid">
        <h3>Tags to Avoid</h3>
        ${renderTagListHtml(output.avoidTags, 'avoid', maxScore, currentTags)}
      </div>
    </div>
    ${renderSimilarGames(output.similarGames)}
  `;
}

// The specific ways this result can be weak, instead of one made-up
// percentage (the old "Confidence: 80%" multiplied three heuristics and
// ignored every other failure mode).
export function evidenceCaveats(output: RecommendationOutput): string[] {
  const out: string[] = [];
  if (output.segment && output.segmentInferred) {
    out.push('The segment was inferred from the description; pick the main genre explicitly if it looks wrong.');
  }
  if (output.segment && output.segment.game_count < 100) {
    out.push(`Small segment (${output.segment.game_count} games): lifts are shrunk toward 1 and carry little weight.`);
  }
  if (!output.neighborEvidenceAvailable) {
    out.push('Similar-game tag data is unavailable, so these recommendations rest on the description alone.');
  }
  if (output.primaryTags.length === 0) {
    out.push('No tag cleared the primary relevance bar; a longer, gameplay-focused description usually helps.');
  }
  return out;
}

export function renderTagListHtml(
  tags: TagRecommendation[],
  type: 'primary' | 'secondary' | 'avoid',
  maxScore: number,
  currentTags: Set<number>
): string {
  if (tags.length === 0) return '<p class="no-tags">No tags in this category</p>';

  return `<ol class="tag-list tag-list-${type}">
    ${tags.map((t) => {
      const strength = Math.round((t.score / maxScore) * 100);
      const haveBadge = currentTags.has(t.tagId)
        ? ' <span class="badge badge-have" title="This game already uses this tag">✓ already using</span>'
        : '';
      const exemplars = t.exemplarGames.map(g =>
        `<a class="exemplar-link" href="${escapeHtml(storeUrl(g.appid))}" target="_blank" rel="noopener noreferrer">${escapeHtml(g.name)}</a>`
      ).join(', ');
      return `
      <li class="tag-item">
        <div class="tag-header">
          <span class="tag-name"><a class="tag-name-link" href="${escapeHtml(tagPageUrl(t.tagId, t.tag))}" title="Open tag stats: distribution, trends, combos">${escapeHtml(t.tag)}</a>${haveBadge}</span>
          <span class="tag-score" title="Strength: ${strength}/100 · raw ${t.score.toFixed(3)} · similarity ${t.relevance.toFixed(2)} · lift ${t.successLift.toFixed(1)}x">
            ${type === 'avoid' ? '⚠' : strength}
          </span>
        </div>
        <p class="tag-explanation">${escapeHtml(t.explanation)}</p>
        ${exemplars ? `<p class="tag-exemplars">Examples: ${exemplars}</p>` : ''}
      </li>
    `;
    }).join('')}
  </ol>`;
}
