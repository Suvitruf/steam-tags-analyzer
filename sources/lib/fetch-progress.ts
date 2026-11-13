// Streaming fetch that reports download progress. The analyzer's runtime
// artifacts are big (SQLite DB ~105 MB, 39 MB gzip-compressed on the wire;
// quantized ONNX ~110 MB; kNN blob ~8 MB) and a bare `response.arrayBuffer()`
// gives the UI nothing to show for the whole wait.
//
// `total` is the Content-Length when the server sends one and the body is not
// content-encoded; otherwise null, and the caller shows an indeterminate bar.
// R2 serves these as application/octet-stream, which Cloudflare does not
// compress, so the header normally is the byte count. Content-Encoding is not
// CORS-readable, so an encoded transfer is detected by the body overrunning
// the declared length instead, at which point `total` drops back to null.
//
// A gzip file (the database's `.db.gz` copy) is inflated here rather than by
// the browser's Content-Encoding handling, so the bytes on the wire are what
// the progress bar counts and the HTTP cache stores the small copy. Whether a
// body is gzip is read off its first two bytes, not its URL: a dev server or a
// proxy may have inflated a `.gz` already, and then the bytes are the file.
//
// Without a callback this is the equivalent of `new Uint8Array(await
// res.arrayBuffer())`, which is what callers outside the browser UI go through.

export type ByteProgress = (loaded: number, total: number | null) => void;

/** A failed fetch, with the HTTP status so callers can fall back on a 404. */
export class FetchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FetchError';
  }
}

export const canInflate = (): boolean => typeof DecompressionStream !== 'undefined';

type Reader = ReadableStreamDefaultReader<Uint8Array>;

/** Reads until at least `n` bytes are in hand (or the stream ends). */
async function peek(reader: Reader, n: number): Promise<{ head: Uint8Array[]; done: boolean }> {
  const head: Uint8Array[] = [];
  let size = 0;
  while (size < n) {
    const { done, value } = await reader.read();
    if (done) return { head, done: true };
    head.push(value);
    size += value.length;
  }
  return { head, done: false };
}

/** The peeked chunks, then whatever the reader still holds. */
function resume(head: Uint8Array[], reader: Reader, ended: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (head.length > 0) { controller.enqueue(head.shift()!); return; }
      if (ended) { controller.close(); return; }
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: reason => reader.cancel(reason),
  });
}

function isGzip(head: Uint8Array[]): boolean {
  const magic: number[] = [];
  for (const c of head) for (let i = 0; i < c.length && magic.length < 2; i++) magic.push(c[i]);
  return magic[0] === 0x1f && magic[1] === 0x8b;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function fetchBytes(url: string, onProgress?: ByteProgress, what = 'resource'): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new FetchError(`Failed to load ${what}: ${res.status} ${res.statusText}`, res.status);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const declared = Number(res.headers.get('content-length'));
  let total: number | null = Number.isFinite(declared) && declared > 0 ? declared : null;
  onProgress?.(0, total);

  const reader = res.body.getReader();
  const { head, done } = await peek(reader, 2);
  const body = resume(head, reader, done);

  if (isGzip(head)) {
    if (!canInflate()) throw new Error(`Failed to load ${what}: this browser cannot inflate a gzip stream`);
    // Progress counts the compressed bytes as they arrive: that is the size
    // the server declared and the wait the user is sitting through.
    let wire = 0;
    const counted = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        wire += chunk.length;
        onProgress?.(wire, total);
        controller.enqueue(chunk);
      },
    }));
    // lib.dom types the inflater's writable side as BufferSource; it takes our Uint8Array chunks.
    const inflater = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    return collect(counted.pipeThrough(inflater));
  }

  if (!onProgress) return collect(body);

  // Known size: write straight into one buffer (same peak memory as
  // arrayBuffer()). Unknown size: collect chunks and join at the end.
  let buf: Uint8Array | null = total !== null ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const rest = body.getReader();
  for (;;) {
    const { done, value } = await rest.read();
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
