/* Synced from extension/src/protocol.js. Update with npm run sync:shared. */
// Generated from the website audit/manifest validators. Do not edit by hand.
// Update in the monorepo with: npm --prefix extension run sync:protocol
const AUDIT_BUCKETS = ["identity", "feature", "neutral", "weak", "unassessed", "suspicious", "retired"];
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validateManifest(value) {
  const m = value;
  const ref = (r) => {
    if (!r || !/^(snapshots|sets\/[a-zA-Z0-9_-]+|details)\/[a-f0-9]{64}\.gz$/.test(r.path) || !/^[a-f0-9]{64}$/.test(r.sha256) || !r.path.endsWith(`/${r.sha256}.gz`) || !Number.isSafeInteger(r.bytes) || r.bytes <= 0 || !Number.isSafeInteger(r.gzipBytes) || r.gzipBytes <= 0) throw new Error("Invalid inference file reference");
  };
  if (!m || m.version !== 1 || !m.models || typeof m.models !== "object" || Array.isArray(m.models) || !Object.keys(m.models).length || !Array.isArray(m.details) || m.details.length !== 256) throw new Error("Unsupported inference manifest");
  ref(m.core);
  if (!m.core.path.startsWith("snapshots/")) throw new Error("Invalid inference core path");
  for (const [key, model] of Object.entries(m.models)) {
    ref(model?.file);
    if (!model.row || model.row.model_name !== key || !/^[a-zA-Z0-9_-]+$/.test(model.row.set_id) || !model.file.path.startsWith(`sets/${model.row.set_id}/`)) throw new Error("Invalid inference model reference");
    for (const field of ["centroids_sha256", "tag_stats_sha256", "ranker_sha256", "vectors_sha256", "encoder_sha256"]) {
      if (!/^[a-f0-9]{64}$/.test(model.row[field])) throw new Error("Invalid inference model fingerprint");
    }
  }
  for (const r of m.details) {
    ref(r);
    if (!r.path.startsWith("details/")) throw new Error("Invalid inference detail path");
  }
  const stats = new Set(Object.values(m.models).map((m2) => m2.row.tag_stats_sha256));
  if (stats.size !== 1) throw new Error("Inference model sets disagree on tag_stats");
  return m;
}
const AUDIT_REVISION = "audit-2026-11-15-v1";
function auditSnapshot(manifest, model) {
  const selected = manifest.models[model];
  if (!selected) throw new Error("Audit model is absent from the snapshot");
  return sha256(new TextEncoder().encode(JSON.stringify([
    manifest.version,
    manifest.core.sha256,
    selected.file.sha256,
    Object.entries(selected.row).sort(([a], [b]) => a.localeCompare(b)),
    manifest.details.map((ref) => ref.sha256)
  ])));
}
function validAuditRef(value) {
  const r = value;
  return !!r && /^[a-f0-9]{64}$/.test(r.sha256) && r.path === `audits/${r.sha256}.gz` && Number.isSafeInteger(r.bytes) && r.bytes > 0 && r.bytes <= 4e6 && Number.isSafeInteger(r.gzipBytes) && r.gzipBytes > 0 && r.gzipBytes <= 4e6;
}
const number = (v) => typeof v === "number" && Number.isFinite(v);
const id = (v) => number(v) && Number.isSafeInteger(v) && v > 0 && v <= 4294967295;
const string = (v) => typeof v === "string";
const nullableString = (v) => v === null || string(v);
const bool = (v) => typeof v === "boolean";
const list = (v, check, max = 1e3) => Array.isArray(v) && v.length <= max && v.every(check);
const strings = (v) => list(v, string);
function validSavedAudit(value, index, appid) {
  const saved = value, a = saved?.audit;
  const game = (g) => !!g && id(g.appid) && string(g.name);
  const recommendation = (t) => !!t && id(t.tagId) && string(t.tag) && string(t.explanation) && ["score", "relevance", "successLift", "confidence"].every((k) => number(t[k])) && list(t.exemplarGames, game);
  if (!saved || !["version", "revision", "model", "setId", "snapshot", "generatedAt"].every((k) => saved[k] === index[k]) || !a || a.app?.appid !== appid || !string(a.app.name) || a.app.live !== false || a.app.inDataset !== true || a.app.fetchedAt !== null || !bool(a.featuresKnown) || !nullableString(a.snapshotCollectedAt) || a.liveDiff !== null || !(a.segment === null || a.segment && string(a.segment.main_tag_name) && number(a.segment.game_count)) || !list(a.tags, (t) => !!t && id(t.tagId) && string(t.tag) && (number(t.rank) || t.rank === null) && ["similarity", "similarityRank", "neighborVote", "neighborShare", "intent"].every((k) => number(t[k])) && (t.taxonomyActive === null || bool(t.taxonomyActive)) && bool(t.embeddingAvailable) && AUDIT_BUCKETS.includes(t.bucket) && string(t.reason) && strings(t.verifiedBy) && bool(t.featureMissing), 100) || !a.tags.length || !a.counts || !AUDIT_BUCKETS.every((b) => a.counts[b] === a.tags.filter((t) => t.bucket === b).length) || !list(a.missing, recommendation) || !list(a.missingContradicted, recommendation) || !list(a.avoid, recommendation) || !list(a.similarGames, (g) => game(g) && number(g.similarity) && number(g.reviews)) || !a.signal || !number(a.signal.topSimilarity) || !bool(a.signal.thin) || !nullableString(a.signal.reason) || !bool(a.signal.neighborEvidenceAvailable) || !strings(a.orderNotes) || !number(a.retrievalCutoff) || ![void 0, "top", "segment"].includes(a.exemplarBasis)) return false;
  return new Set(a.tags.map((t) => t.tagId)).size === a.tags.length;
}
export {
  AUDIT_REVISION,
  auditSnapshot,
  sha256,
  validAuditRef,
  validSavedAudit,
  validateManifest
};
