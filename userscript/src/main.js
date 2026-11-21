import { steamAppId } from "./shared/links.js";
import { mountPanel } from "./shared/panel.js";
import { createAuditClient } from "./shared/audit-client.js";
import { createGMFetch, createGMCache } from "./gm-adapters.js";
import { calculateAudit } from './local-audit.js';
import { startResearch } from './research/main.js';

startResearch(GM);

const appid = steamAppId(location.href);
// Both distributions claim the same host synchronously: installing both must
// produce one panel, regardless of which content script runs first.
const ID = "steam-tag-analyzer-extension";
if (appid && window.top === window) {
  const client = createAuditClient({
    fetch: createGMFetch(GM_xmlhttpRequest),
    openCache: async () => createGMCache(GM),
  });
  function attach() {
    if (document.getElementById(ID)) return true;
    const anchor =
      document.querySelector(".glance_tags_ctn") ??
      document.querySelector("#game_highlights") ??
      document.querySelector("#appHubAppName");
    if (!anchor) return false;
    const host = document.createElement("div");
    host.id = ID;
    host.dataset.distribution = "userscript";
    anchor.insertAdjacentElement("afterend", host);
    mountPanel(host, appid, (id) => client.load(id), calculateAudit);
    return true;
  }
  if (!attach()) {
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    setTimeout(() => observer.disconnect(), 30000);
  }
}
