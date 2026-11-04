// Streaming fetch that reports download progress. The analyzer's runtime
// artifacts are big (SQLite DB ~390 MB, quantized ONNX ~110 MB, kNN blob
// ~8 MB) and a bare `response.arrayBuffer()` gives the UI nothing to show for
// the whole wait.
//
// `total` is the Content-Length when the server sends one and the body is not
// content-encoded; otherwise null, and the caller shows an indeterminate bar.
// R2 serves these as application/octet-stream, which Cloudflare does not
// compress, so the header normally is the byte count. Content-Encoding is not
// CORS-readable, so an encoded transfer is detected by the body overrunning
// the declared length instead, at which point `total` drops back to null.
//
// Without a callback this is exactly `new Uint8Array(await res.arrayBuffer())`,
// which is what callers outside the browser UI go through.

export type ByteProgress = (loaded: number, total: number | null) => void;

export async function fetchBytes(url: string, onProgress?: ByteProgress, what = 'resource'): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${what}: ${res.status} ${res.statusText}`);
  if (!onProgress || !res.body) return new Uint8Array(await res.arrayBuffer());

  const declared = Number(res.headers.get('content-length'));
  let total: number | null = Number.isFinite(declared) && declared > 0 ? declared : null;
  onProgress(0, total);

  // Known size: write straight into one buffer (same peak memory as
  // arrayBuffer()). Unknown size: collect chunks and join at the end.
  let buf: Uint8Array | null = total !== null ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (buf && loaded + value.length <= buf.length) {
      buf.set(value, loaded);
    } else {
      if (buf) {
        // Content-Length was the wire size, not the byte count.
        chunks.push(buf.subarray(0, loaded));
        buf = null;
        total = null;
      }
      chunks.push(value);
    }
    loaded += value.length;
    onProgress(loaded, total);
  }

  // Every return path starts at byteOffset 0, so callers may view `.buffer`
  // directly (game-knn.ts reads the blob header through a DataView).
  if (buf) return loaded === buf.length ? buf : buf.subarray(0, loaded);
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
