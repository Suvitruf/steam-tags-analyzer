import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createGMFetch, createGMCache } from "../src/gm-adapters.js";
import {
  createAuditClient,
  BASE,
  MANIFEST_URL,
} from "../src/shared/audit-client.js";
import { fixture } from "./fixture.mjs";

function storage() {
  const data = new Map();
  return {
    data,
    async getValue(k, fallback) {
      return data.get(k) ?? fallback;
    },
    async setValue(k, v) {
      data.set(k, structuredClone(v));
    },
    async deleteValue(k) {
      data.delete(k);
    },
    async listValues() {
      return [...data.keys()];
    },
  };
}
function transport(f) {
  let offline = false;
  const requests = [];
  return {
    requests,
    setOffline() {
      offline = true;
    },
    request(options) {
      requests.push(options);
      let aborted = false;
      queueMicrotask(async () => {
        if (aborted) return;
        if (offline) {
          options.onerror();
          return;
        }
        const response = await f.fetch(options.url, options);
        options.onload({
          status: response.status,
          finalUrl: options.url,
          response: await response.arrayBuffer(),
        });
      });
      return {
        abort() {
          aborted = true;
        },
      };
    },
  };
}

test("GM transport and storage preserve verified data across separate client instances", async () => {
  const f = await fixture(),
    gm = storage(),
    network = transport(f);
  const client = () =>
    createAuditClient({
      fetch: createGMFetch(network.request),
      openCache: async () => createGMCache(gm),
    });
  assert.deepEqual(await client().load(10), {
    status: "ready",
    saved: f.saved,
    offline: false,
  });
  assert.equal(network.requests.length, 3);
  for (const request of network.requests) {
    assert.equal(request.anonymous, true);
    assert.equal(request.headers.Referer, "");
    assert.equal(request.responseType, "arraybuffer");
  }
  assert.equal(network.requests[0].headers["Cache-Control"], "no-cache");
  assert.equal((await client().load(10)).status, "ready");
  assert.equal(network.requests.length, 4);
  network.setOffline();
  assert.deepEqual(await client().load(10), {
    status: "ready",
    saved: f.saved,
    offline: true,
  });
  const keys = await createGMCache(gm).keys();
  assert.equal(keys.length, 3);
});

test("GM cache preserves UTF-8 bytes and independent tab entries without touching other keys", async () => {
  const gm = storage(),
    a = createGMCache(gm),
    b = createGMCache(gm);
  await gm.setValue("unrelated", 123);
  const u = BASE + "audits/" + "a".repeat(64) + ".gz",
    v = BASE + "audits/" + "b".repeat(64) + ".gz";
  const raw = '\ufeff{"text":"Русский 日本語 🎮"}';
  await Promise.all([
    a.put(u, new Response(raw)),
    b.put(v, new Response("{}")),
  ]);
  assert.deepEqual(
    new Uint8Array(await (await b.match(u)).arrayBuffer()),
    new TextEncoder().encode(raw),
  );
  assert.equal((await a.keys()).length, 2);
  for (const key of await a.keys()) await a.delete(key);
  assert.equal(gm.data.get("unrelated"), 123);
  assert.equal(gm.data.size, 1);
  await assert.rejects(
    a.put(u, new Response(new Uint8Array([255]))),
    TypeError,
  );
  await assert.rejects(
    a.put(MANIFEST_URL, new Response(" ".repeat(512001))),
    RangeError,
  );
});

test("corrupt GM entries repair from CDN; failed storage writes preserve network results", async () => {
  const f = await fixture(),
    gm = storage(),
    network = transport(f);
  const client = createAuditClient({
    fetch: createGMFetch(network.request),
    openCache: async () => createGMCache(gm),
  });
  assert.equal((await client.load(10)).status, "ready");
  for (const key of gm.data.keys())
    if (key.endsWith(f.index.apps[10].path))
      gm.data.set(key, { version: 1, body: "{}" });
  assert.equal((await client.load(10)).status, "ready");
  assert.equal(network.requests.length, 5);
  const denied = createGMCache({
    ...gm,
    setValue: async () => {
      throw new Error("quota");
    },
  });
  gm.data.clear();
  assert.equal(
    (
      await createAuditClient({
        fetch: createGMFetch(network.request),
        openCache: async () => denied,
      }).load(10)
    ).status,
    "ready",
  );
});

test("transport rejects arbitrary URLs, unexpected redirects, non-binary and oversized data", async () => {
  let requests = 0;
  const request = createGMFetch(() => {
    requests++;
  });
  for (const url of [
    "https://example.com/file",
    BASE + "../secret",
    BASE + "snapshots/" + "a".repeat(64) + ".gz",
    MANIFEST_URL + "?url=evil",
  ])
    await assert.rejects(request(url), TypeError);
  assert.equal(requests, 0);
  for (const override of [
    { finalUrl: "https://evil.test/" },
    { response: "not binary" },
    { response: new ArrayBuffer(512001) },
    { status: 0 },
  ]) {
    const bad = createGMFetch((o) => {
      queueMicrotask(() =>
        o.onload({
          status: 200,
          finalUrl: o.url,
          response: new ArrayBuffer(0),
          ...override,
        }),
      );
      return { abort() {} };
    });
    await assert.rejects(bad(MANIFEST_URL));
  }
  let aborted = 0;
  const oversized = createGMFetch((o) => {
    queueMicrotask(() => o.onprogress({ loaded: 512001 }));
    return {
      abort() {
        aborted++;
      },
    };
  });
  await assert.rejects(oversized(MANIFEST_URL), RangeError);
  assert.equal(aborted, 1);
});

test("manual deadline, AbortSignal and manager failures all settle without hanging", async () => {
  let aborted = 0,
    requests = 0;
  const hang = createGMFetch(() => {
    requests++;
    return {
      abort() {
        aborted++;
      },
    };
  }, 10);
  await assert.rejects(hang(MANIFEST_URL), { name: "TimeoutError" });
  assert.equal(aborted, 1);
  const c = new AbortController(),
    pending = hang(MANIFEST_URL, { signal: c.signal });
  c.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(aborted, 2);
  await assert.rejects(hang(MANIFEST_URL, { signal: c.signal }), {
    name: "AbortError",
  });
  assert.equal(requests, 2);
  for (const callback of ["onerror", "onabort", "ontimeout"]) {
    const fail = createGMFetch((o) => {
      queueMicrotask(() => o[callback]());
      return { abort() {} };
    });
    await assert.rejects(fail(MANIFEST_URL));
  }
  await assert.rejects(
    createGMFetch(() => {
      throw new Error("manager unavailable");
    })(MANIFEST_URL),
    /manager unavailable/,
  );
});

test("metadata has narrow match/connect scope and no remote JavaScript dependencies", async () => {
  const metadata = await fs.readFile(
    new URL("../metadata.txt", import.meta.url),
    "utf8",
  );
  assert.match(
    metadata,
    /@match\s+https:\/\/store\.steampowered\.com\/app\/\*/,
  );
  assert.match(metadata, /@connect\s+projects\.cdn\.aapanasik\.com/);
  assert.match(metadata, /@noframes/);
  assert.match(metadata, /@sandbox\s+DOM/);
  assert.ok(
    !/@require|@resource|@connect\s+\*|@grant\s+unsafeWindow/.test(metadata),
  );
  assert.deepEqual(
    [...metadata.matchAll(/@grant\s+(\S+)/g)].map((m) => m[1]),
    [
      "GM_xmlhttpRequest",
      "GM.getValue",
      "GM.setValue",
      "GM.deleteValue",
      "GM.listValues",
    ],
  );
});
