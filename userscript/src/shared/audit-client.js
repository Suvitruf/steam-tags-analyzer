/* Synced from extension/src/audit-client.js. Update with npm run sync:shared. */
import {
  AUDIT_REVISION,
  auditSnapshot,
  sha256,
  validateManifest,
  validAuditRef,
  validSavedAudit,
} from "./protocol.js";
import { validAppId } from "./links.js";
export const BASE = "https://projects.cdn.aapanasik.com/steam-tags/inference/";
export const MANIFEST_URL = BASE + "manifest.json";
export const CACHE_NAME = "steam-tag-audit-extension-v1";
const MODEL = "gte-base";

async function bytes(stream, limit) {
  if (!stream) throw new Error("Empty response");
  const reader = stream.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Response exceeds its size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A fixed-origin, read-only client. No URL or model comes from the Steam page. */
export function createAuditClient(options = {}) {
  const request = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const openCache =
    options.openCache ?? (() => globalThis.caches.open(CACHE_NAME));
  const timeout = options.timeoutMs ?? 5000;
  const pending = new Map();
  async function load(appid) {
    let cache = null;
    try {
      cache = await openCache();
    } catch {
      /* Private mode/quota: network still works. */
    }
    try {
      let manifestResponse,
        offline = false;
      try {
        manifestResponse = await request(MANIFEST_URL, {
          cache: "no-cache",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        manifestResponse = await cache?.match(MANIFEST_URL);
        if (!manifestResponse) throw error;
        offline = true;
      }
      if (!manifestResponse.ok) throw new Error("Manifest unavailable");
      const manifest = validateManifest(
        JSON.parse(
          new TextDecoder().decode(await bytes(manifestResponse.body, 512_000)),
        ),
      );
      const pointer = manifest.audits?.[MODEL];
      if (!pointer) return { status: "missing" };
      if (pointer.revision !== AUDIT_REVISION) return { status: "unsupported" };
      if (!validAuditRef(pointer.file))
        throw new Error("Invalid index reference");
      async function file(ref) {
        if (!validAuditRef(ref)) throw new Error("Invalid audit reference");
        const url = BASE + ref.path;
        const valid = async (data) =>
          data.length === ref.bytes && (await sha256(data)) === ref.sha256;
        try {
          const hit = await cache?.match(url);
          if (hit) {
            const data = await bytes(hit.body, ref.bytes);
            if (await valid(data))
              return JSON.parse(new TextDecoder().decode(data));
            await cache.delete(url);
          }
        } catch {
          /* A bad cache entry is repaired from its immutable URL. */
        }
        const response = await request(url, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) throw new Error("Saved audit unavailable");
        let data = await bytes(
          response.body,
          Math.max(ref.bytes, ref.gzipBytes),
        );
        if (data[0] === 31 && data[1] === 139) {
          const stream = new Blob([data])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"));
          data = await bytes(stream, ref.bytes);
        }
        if (!(await valid(data)))
          throw new Error("Saved audit integrity failure");
        const decoded = JSON.parse(new TextDecoder().decode(data));
        try {
          await cache?.put(url, new Response(data));
        } catch {
          /* Quota is not a load failure. */
        }
        return decoded;
      }
      const index = await file(pointer.file);
      if (
        index?.version !== 1 ||
        index.revision !== AUDIT_REVISION ||
        index.model !== MODEL ||
        index.setId !== manifest.models[MODEL]?.row.set_id ||
        index.snapshot !== (await auditSnapshot(manifest, MODEL)) ||
        typeof index.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(index.generatedAt)) ||
        !index.apps ||
        typeof index.apps !== "object" ||
        Array.isArray(index.apps) ||
        Object.keys(index.apps).length > 10000 ||
        !Object.entries(index.apps).every(
          ([key, ref]) =>
            String(Number(key)) === key &&
            validAppId(Number(key)) &&
            validAuditRef(ref),
        )
      )
        throw new Error("Incompatible saved audit index");
      const ref = index.apps[appid];
      const saved = ref ? await file(ref) : null;
      if (ref && !validSavedAudit(saved, index, appid))
        throw new Error("Invalid saved audit");
      try {
        if (cache) {
          await cache.put(MANIFEST_URL, Response.json(manifest));
          const indexUrl = BASE + pointer.file.path,
            currentUrl = ref ? BASE + ref.path : null;
          const allowed = new Set(
            Object.values(index.apps).map((r) => BASE + r.path),
          );
          const keys = await cache.keys(),
            retained = [];
          for (const key of keys) {
            if (
              key.url === MANIFEST_URL ||
              key.url === indexUrl ||
              key.url === currentUrl
            )
              continue;
            if (!allowed.has(key.url)) await cache.delete(key);
            else retained.push(key);
          }
          // Bound retention to 40 visited games from the current snapshot.
          for (const key of retained.slice(
            0,
            Math.max(0, retained.length - (ref ? 39 : 40)),
          ))
            await cache.delete(key);
        }
      } catch {
        /* Cache maintenance cannot prevent displaying a verified audit. */
      }
      return ref ? { status: "ready", saved, offline } : { status: "missing" };
    } catch {
      return { status: "unavailable" };
    }
  }
  return {
    load(appid) {
      if (!validAppId(appid)) return Promise.resolve({ status: "invalid" });
      if (!pending.has(appid)) {
        const promise = load(appid).finally(() => pending.delete(appid));
        pending.set(appid, promise);
      }
      return pending.get(appid);
    },
  };
}
