/* Synced from extension/src/local-runner.js. Update with npm run sync:shared. */
import { localRequestLimit, resourceLabel } from './local-policy.js';

// createWorker may return a dedicated Worker or an isolated extension frame's
// MessagePort. A run owns both its requests and its compute context, so cancel
// really stops model downloads and frees the model, including on navigation.
export function createLocalRunner(createWorker, fetchResource) {
  return async (appid, { signal, onProgress }) => {
    const context = await createWorker();
    const requests = new AbortController();
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        requests.abort();
        context.terminate();
        fn(value);
      };
      const cancel = () => finish(reject, new DOMException('Audit cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(reject, new Error('The audit timed out. Please try again.')), 10 * 60_000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      context.onerror = () => finish(reject, new Error('The calculation worker could not run in this browser.'));
      context.onmessage = async ({ data: m }) => {
        if (finished) return;
        if (m?.type === 'progress') onProgress(m.message);
        else if (m?.type === 'result') finish(resolve, m);
        else if (m?.type === 'error') finish(reject, new Error(m.message));
        else if (m?.type === 'fetch') {
          try {
            localRequestLimit(m.url, appid);
            onProgress(resourceLabel(m.url) + '…');
            let lastProgress = 0;
            const r = await fetchResource(m.url, {
              signal: requests.signal,
              onProgress: (loaded) => {
                if (Date.now() - lastProgress < 100) return;
                lastProgress = Date.now();
                onProgress(`${resourceLabel(m.url)}: ${(loaded / 1_000_000).toFixed(1)} MB`);
              },
            }, appid);
            const body = await r.arrayBuffer();
            if (body.byteLength > localRequestLimit(m.url, appid)) throw new Error('Audit resource is too large');
            if (!finished) context.postMessage({ type: 'response', id: m.id, status: r.status, headers: [...r.headers], body }, [body]);
          } catch (error) {
            if (!finished) context.postMessage({ type: 'response', id: m.id, error: error.message });
          }
        }
      };
      context.postMessage({ type: 'start', appid });
    });
  };
}
