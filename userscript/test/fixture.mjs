import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { AUDIT_REVISION, auditSnapshot } from "../src/shared/protocol.js";
import { BASE, MANIFEST_URL } from "../src/shared/audit-client.js";
export async function fixture() {
  const files = new Map();
  function file(folder, value) {
    const body = Buffer.from(JSON.stringify(value)),
      sha256 = createHash("sha256").update(body).digest("hex"),
      gzip = gzipSync(body);
    const ref = {
      path: `${folder}/${sha256}.gz`,
      sha256,
      bytes: body.length,
      gzipBytes: gzip.length,
    };
    files.set(BASE + ref.path, gzip);
    return ref;
  }
  const row = {
    model_name: "gte-base",
    set_id: "gte-base-fixture",
    created_at: "2026-11-18",
    centroids_sha256: "a".repeat(64),
    tag_stats_sha256: "b".repeat(64),
    ranker_sha256: "c".repeat(64),
    vectors_sha256: "d".repeat(64),
    encoder_sha256: "e".repeat(64),
    encoder_probe: "{}",
    notes: null,
  };
  const manifest = {
    version: 1,
    core: file("snapshots", {}),
    models: { "gte-base": { row, file: file("sets/gte-base-fixture", {}) } },
    details: Array.from({ length: 256 }, () => file("details", [])),
  };
  const metadata = {
    version: 1,
    revision: AUDIT_REVISION,
    model: "gte-base",
    setId: row.set_id,
    snapshot: await auditSnapshot(manifest, "gte-base"),
    generatedAt: "2026-11-18T09:00:00Z",
  };
  const buckets = [
    "identity",
    "feature",
    "neutral",
    "weak",
    "unassessed",
    "suspicious",
    "retired",
  ];
  const tags = buckets.map((bucket, i) => ({
    tagId: i + 1,
    tag: [
      "Roguelike",
      "Singleplayer",
      "Classic",
      "Atmospheric",
      "New tag",
      "Multiplayer",
      "Old tag",
    ][i],
    rank: i + 1,
    similarity: 0.6,
    similarityRank: 10 + i,
    neighborVote: 0.3,
    neighborShare: 0.4,
    intent: 0,
    taxonomyActive: bucket !== "retired",
    embeddingAvailable: bucket !== "unassessed",
    bucket,
    reason: `Evidence for ${bucket}.`,
    verifiedBy: bucket === "feature" ? ["Single-player"] : [],
    featureMissing: false,
  }));
  const saved = {
    ...metadata,
    audit: {
      app: {
        appid: 10,
        name: "Fixture Grove",
        live: false,
        inDataset: true,
        fetchedAt: null,
      },
      featuresKnown: true,
      snapshotCollectedAt: "2026-11-15",
      liveDiff: null,
      segment: null,
      tags,
      counts: Object.fromEntries(buckets.map((b) => [b, 1])),
      missing: [
        {
          tagId: 8,
          tag: "Deckbuilder",
          score: 0.8,
          relevance: 0.7,
          successLift: 1.5,
          confidence: 0.8,
          explanation: "Similar games use this tag.",
          exemplarGames: [],
        },
      ],
      missingContradicted: [],
      avoid: [],
      similarGames: [
        { appid: 20, name: "Nearby Game", similarity: 0.8, reviews: 1000 },
      ],
      signal: {
        topSimilarity: 0.8,
        thin: false,
        reason: null,
        neighborEvidenceAvailable: true,
      },
      orderNotes: [],
      retrievalCutoff: 0.5,
      exemplarBasis: "top",
    },
  };
  const index = { ...metadata, apps: {} };
  const publish = () => {
    index.apps[10] = file("audits", saved);
    manifest.audits = {
      "gte-base": { revision: AUDIT_REVISION, file: file("audits", index) },
    };
  };
  publish();
  const requests = [];
  const fetch = async (input, options) => {
    const url = String(input);
    requests.push({ url, options });
    if (url === MANIFEST_URL) return Response.json(manifest);
    const data = files.get(url);
    return data ? new Response(data) : new Response("", { status: 404 });
  };
  return { manifest, index, saved, files, file, publish, requests, fetch };
}
export function cacheFixture() {
  const entries = new Map(),
    key = (v) => (typeof v === "string" ? v : v.url);
  return {
    entries,
    cache: {
      async match(v) {
        return entries.get(key(v))?.clone();
      },
      async put(v, r) {
        entries.set(key(v), r.clone());
      },
      async delete(v) {
        return entries.delete(key(v));
      },
      async keys() {
        return [...entries.keys()].map((u) => new Request(u));
      },
    },
  };
}
