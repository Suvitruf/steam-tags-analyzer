import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuditClient,
  BASE,
  MANIFEST_URL,
} from "../src/shared/audit-client.js";
import { fixture, cacheFixture } from "./fixture.mjs";

test("a verified hit requests only three small files; repeat/offline hits reuse the cache", async () => {
  const f = await fixture(),
    { cache } = cacheFixture();
  let offline = false;
  const client = createAuditClient({
    fetch: (...args) => {
      if (offline) throw new TypeError("offline");
      return f.fetch(...args);
    },
    openCache: async () => cache,
  });
  const [a, b] = await Promise.all([client.load(10), client.load(10)]);
  assert.deepEqual(a, { status: "ready", saved: f.saved, offline: false });
  assert.deepEqual(a, b);
  assert.equal(f.requests.length, 3);
  assert.ok(
    f.requests.every(
      (r) => r.url === MANIFEST_URL || r.url.includes("/audits/"),
    ),
  );
  for (const r of f.requests) {
    assert.equal(r.options.credentials, "omit");
    assert.equal(r.options.referrerPolicy, "no-referrer");
  }
  f.requests.length = 0;
  assert.equal((await client.load(10)).status, "ready");
  assert.deepEqual(
    f.requests.map((r) => r.url),
    [MANIFEST_URL],
  );
  offline = true;
  assert.deepEqual(await client.load(10), {
    status: "ready",
    saved: f.saved,
    offline: true,
  });
});

test("misses, unsupported versions and failed requests leave full-audit fallback available", async () => {
  const f = await fixture(),
    client = createAuditClient({ fetch: f.fetch, openCache: async () => null });
  assert.equal((await client.load(30)).status, "missing");
  assert.equal((await client.load(-1)).status, "invalid");
  f.manifest.audits["gte-base"].revision = "future";
  assert.equal((await client.load(10)).status, "unsupported");
  delete f.manifest.audits;
  assert.equal((await client.load(10)).status, "missing");
  const failed = createAuditClient({
    fetch: async () => {
      throw new DOMException("Timeout", "TimeoutError");
    },
    openCache: async () => null,
  });
  assert.equal((await failed.load(10)).status, "unavailable");
});

test("corrupt cache is repaired; storage denial never prevents a valid network result", async () => {
  const f = await fixture(),
    { cache, entries } = cacheFixture(),
    client = createAuditClient({
      fetch: f.fetch,
      openCache: async () => cache,
    });
  assert.equal((await client.load(10)).status, "ready");
  const url = BASE + f.index.apps[10].path;
  entries.set(url, new Response("broken"));
  assert.equal((await client.load(10)).status, "ready");
  assert.equal(f.requests.at(-1).url, url);
  entries.clear();
  f.files.set(url, Buffer.from("broken"));
  assert.equal((await client.load(10)).status, "unavailable");
  f.publish();
  const denied = createAuditClient({
    fetch: f.fetch,
    openCache: async () => {
      throw new Error("storage denied");
    },
  });
  assert.equal((await denied.load(10)).status, "ready");
});

test("changed details, calibration and wrong-app valid-hash results are rejected", async () => {
  for (const mutate of [
    (f) => {
      const ref = f.file("details", [{}]);
      f.manifest.details[0] = ref;
    },
    (f) => {
      f.manifest.models["gte-base"].row.notes = "thin_signal_sim=0.1";
    },
    (f) => {
      f.saved.audit.app.appid = 20;
      f.publish();
    },
    (f) => {
      f.saved.audit.counts.identity = 100;
      f.publish();
    },
    (f) => {
      f.saved.audit.signal = null;
      f.publish();
    },
    (f) => {
      f.saved.audit.tags[0].similarity = null;
      f.publish();
    },
    (f) => {
      f.manifest.audits["gte-base"].file.path = "https://unexpected.test/file";
    },
    (f) => {
      f.index.model = "minilm";
      f.publish();
    },
  ]) {
    const f = await fixture();
    mutate(f);
    const client = createAuditClient({
      fetch: f.fetch,
      openCache: async () => null,
    });
    assert.equal((await client.load(10)).status, "unavailable");
    assert.ok(f.requests.every((r) => r.url.startsWith(BASE)));
  }
});

test("response limits and cache pruning bound retained data", async () => {
  const f = await fixture(),
    { cache, entries } = cacheFixture();
  const client = createAuditClient({
    fetch: f.fetch,
    openCache: async () => cache,
  });
  entries.set(BASE + "audits/obsolete.gz", new Response("obsolete"));
  for (let i = 20; i < 80; i++) {
    const copy = structuredClone(f.saved);
    copy.audit.app.appid = i;
    const ref = f.file("audits", copy);
    f.index.apps[i] = ref;
    entries.set(BASE + ref.path, Response.json(copy));
  }
  f.publish();
  assert.equal((await client.load(10)).status, "ready");
  assert.equal(entries.has(BASE + "audits/obsolete.gz"), false);
  assert.equal(entries.size, 42, "40 audits plus manifest and index");
  // Daily indexes must not accumulate when only uncached games are visited.
  for (let day = 19; day <= 21; day++) {
    f.index.generatedAt = `2026-11-${day}T00:00:00Z`;
    f.index.apps = {};
    f.manifest.audits["gte-base"].file = f.file("audits", f.index);
    assert.equal((await client.load(30)).status, "missing");
    assert.equal(entries.size, 2, "only the current manifest and index remain");
  }
  const huge = createAuditClient({
    fetch: async () => new Response(" ".repeat(512001)),
    openCache: async () => null,
  });
  assert.equal((await huge.load(10)).status, "unavailable");
});
