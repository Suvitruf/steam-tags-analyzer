import workerSource from './shared/audit-worker.js';
import { createLocalRunner } from './shared/local-runner.js';
import { localRequestLimit } from './shared/local-policy.js';
import { createGMFetch } from './gm-adapters.js';
import { attachInlineRuntime } from './shared/audit-inline.js';

function inlineContext() {
  let active = true;
  const scope = {
    onmessage: null,
    postMessage(message) { setTimeout(() => { if (active) context.onmessage?.({ data: message }); }, 0); },
  };
  const context = {
    onmessage: null, onerror: null,
    postMessage(message) { setTimeout(() => { if (active) scope.onmessage?.({ data: message }); }, 0); },
    terminate() {
      scope.onmessage?.({ data: { type: 'cancel' } });
      active = false;
      scope.onmessage = null;
      context.onmessage = null;
    },
  };
  attachInlineRuntime(scope);
  return context;
}

export const calculateAudit = createLocalRunner(async () => {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url);
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
    const ready = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 2000);
      worker.onerror = event => { event.preventDefault(); clearTimeout(timer); resolve(false); };
      worker.onmessage = ({ data }) => { if (data?.type === 'booted') { clearTimeout(timer); resolve(true); } };
    });
    if (ready) return worker;
    worker.terminate();
  } catch { URL.revokeObjectURL(url); }
  return inlineContext();
}, (url, options, appid) => createGMFetch(GM_xmlhttpRequest, 180_000, value => localRequestLimit(value, appid))(url, {
  ...options, cache: url.endsWith('manifest.json') || url.includes('?fresh=1') ? 'no-cache' : 'default',
}));
