import { BASE, MANIFEST_URL } from "./shared/audit-client.js";

const PREFIX = "steam-tag-audit:v1:";
function limitFor(url) {
  if (url === MANIFEST_URL) return 512_000;
  if (
    url.startsWith(BASE) &&
    /^audits\/[a-f0-9]{64}\.gz$/.test(url.slice(BASE.length))
  )
    return 4_000_000;
  throw new TypeError("Only saved-audit CDN URLs are allowed");
}

/** Adapt the managers' callback API to the verified client's fetch contract. */
export function createGMFetch(xmlHttpRequest, timeoutMs = 5000, requestLimit = limitFor) {
  return (input, options = {}) =>
    new Promise((resolve, reject) => {
      const url = String(input),
        limit = requestLimit(url),
        signal = options.signal;
      let handle,
        timer,
        settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      };
      const cancel = (reason) => {
        finish(reject, reason);
        try {
          handle?.abort();
        } catch {
          /* The request may already have ended. */
        }
      };
      const onAbort = () =>
        cancel(signal.reason ?? new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      // Tampermonkey may use fetch for anonymous requests and ignore its timeout
      // option. Keep our own timer and wire the client's AbortSignal explicitly.
      timer = setTimeout(
        () => cancel(new DOMException("Timed out", "TimeoutError")),
        timeoutMs,
      );
      try {
        handle = xmlHttpRequest({
          method: "GET",
          url,
          anonymous: true,
          responseType: "arraybuffer",
          timeout: timeoutMs,
          headers: {
            Referer: "",
            ...(options.cache === "no-cache"
              ? { "Cache-Control": "no-cache" }
              : {}),
          },
          revalidate: options.cache === "no-cache",
          onprogress: (r) => {
            if (r.loaded > limit || (r.lengthComputable && r.total > limit))
              cancel(new RangeError("Response too large"));
            else options.onProgress?.(r.loaded);
          },
          onload: (r) => {
            try {
              if (r.finalUrl && r.finalUrl !== url)
                throw new Error("Unexpected CDN redirect");
              if (
                Object.prototype.toString.call(r.response) !==
                "[object ArrayBuffer]"
              )
                throw new TypeError("Expected binary response");
              if (r.response.byteLength > limit)
                throw new RangeError("Response too large");
              if (
                !Number.isInteger(r.status) ||
                r.status < 200 ||
                r.status > 599
              )
                throw new TypeError("Invalid HTTP status");
              const body = [204, 205, 304].includes(r.status)
                ? null
                : r.response;
              const headers = url.endsWith('.wasm') ? { 'Content-Type': 'application/wasm' } : {};
              finish(resolve, new Response(body, { status: r.status, headers }));
            } catch (error) {
              finish(reject, error);
            }
          },
          onerror: () => finish(reject, new TypeError("CDN request failed")),
          ontimeout: () =>
            finish(reject, new DOMException("Timed out", "TimeoutError")),
          onabort: () =>
            finish(reject, new DOMException("Aborted", "AbortError")),
        });
        if (settled) {
          try {
            handle?.abort();
          } catch {
            /* Synchronous callback. */
          }
        }
      } catch (error) {
        finish(reject, error);
      }
    });
}

/** One manager-storage key per immutable URL avoids cross-tab map overwrites. */
export function createGMCache(gm) {
  const urlOf = (value) => (typeof value === "string" ? value : value.url);
  const keyFor = (value) => {
    const url = urlOf(value);
    limitFor(url);
    return PREFIX + url;
  };
  return {
    async match(value) {
      const entry = await gm.getValue(keyFor(value), null);
      if (!entry || entry.version !== 1 || typeof entry.body !== "string")
        return undefined;
      if (new TextEncoder().encode(entry.body).length > limitFor(urlOf(value)))
        return undefined;
      return new Response(entry.body);
    },
    async put(value, response) {
      const key = keyFor(value),
        data = new Uint8Array(await response.arrayBuffer());
      if (data.length > limitFor(urlOf(value)))
        throw new RangeError("Cache entry too large");
      // JSON artifacts are UTF-8. Preserve their bytes for SHA verification on reuse.
      const body = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(data);
      await gm.setValue(key, { version: 1, body });
    },
    async delete(value) {
      await gm.deleteValue(keyFor(value));
      return true;
    },
    async keys() {
      return (await gm.listValues())
        .filter((key) => {
          if (!key.startsWith(PREFIX)) return false;
          try {
            limitFor(key.slice(PREFIX.length));
            return true;
          } catch {
            return false;
          }
        })
        .map((key) => ({ url: key.slice(PREFIX.length) }));
    },
  };
}
