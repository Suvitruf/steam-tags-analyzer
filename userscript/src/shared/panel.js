/* Synced from extension/src/panel.js. Update with npm run sync:shared. */
import css from "./panel.css";
import { auditUrl } from "./links.js";
const LABELS = {
  identity: "Identity",
  feature: "Store feature",
  neutral: "Neutral",
  weak: "Weak support",
  unassessed: "Not assessed",
  suspicious: "Check this tag",
  retired: "Retired",
};
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text, url) {
  const a = el("a", text);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "unknown";
  return new Date(value).toISOString().slice(0, 10);
}
export function mountPanel(host, appid, request, calculate) {
  const shadow = host.attachShadow({ mode: "open" });
  const style = el("style", css),
    wrap = el("div", undefined, "wrap");
  const launch = el("button", undefined, "launch");
  launch.type = "button";
  launch.append(
    el("span", "Check tags"),
    el("span", "Steam Tag Analyzer", "brand"),
  );
  launch.setAttribute("aria-expanded", "false");
  launch.setAttribute("aria-controls", "audit-panel");
  const panel = el("section", undefined, "panel");
  panel.id = "audit-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Steam Tag Analyzer audit");
  const header = el("div", undefined, "header"),
    heading = el("h2", "Tag audit");
  const close = el("button", "×", "close");
  close.type = "button";
  close.setAttribute("aria-label", "Close tag audit");
  header.append(heading, close);
  const status = el("p", "", "meta");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const body = el("div", undefined, "body");
  const footer = el("div", undefined, "links");
  footer.append(
    link("Open full audit", auditUrl(appid)),
    link("Check current Steam page", auditUrl(appid, true)),
  );
  const retry = el("button", "Retry saved audit", "retry");
  retry.type = "button";
  retry.hidden = true;
  panel.append(header, status, body, retry, footer);
  wrap.append(launch, panel);
  shadow.append(style, wrap);
  let loaded = false,
    busy = false;
  let calculation = null;
  const localControls = el('div', undefined, 'local-controls');
  const warning = el('p', 'Run a full audit here using the current Steam description and tags. If the model is not cached, about 67 MB will be downloaded (compressed), plus game data and the calculation runtime. Files are cached when browser storage is available; this cache is separate from the analyzer website.', 'notice');
  const downloadInfo = el('details', undefined, 'download-info');
  downloadInfo.open = true;
  downloadInfo.append(el('summary', 'Model download and cache'), warning);
  const runHere = el('button', 'Run audit here', 'run-local');
  runHere.type = 'button';
  const cancel = el('button', 'Cancel audit', 'cancel-local');
  cancel.type = 'button';
  cancel.hidden = true;
  localControls.append(downloadInfo, runHere, cancel);
  if (calculate) body.before(localControls);
  async function runLocal() {
    if (busy) return;
    busy = true;
    downloadInfo.open = false;
    runHere.disabled = true;
    cancel.hidden = false;
    retry.hidden = true;
    body.replaceChildren();
    status.textContent = 'Starting local audit…';
    const controller = new AbortController();
    calculation = controller;
    try {
      const result = await calculate(appid, {
        signal: controller.signal,
        onProgress: message => { if (!controller.signal.aborted) status.textContent = message; },
      });
      if (controller.signal.aborted) return;
      render(result.saved, false, true);
      for (const message of result.warnings ?? []) body.prepend(el('p', message, 'notice'));
      status.textContent = 'Current Steam audit complete';
      loaded = true;
    } catch (error) {
      status.textContent = controller.signal.aborted ? 'Audit cancelled. Cached files can be reused.' : `Audit failed: ${error.message}`;
    } finally {
      calculation = null;
      busy = false;
      runHere.disabled = false;
      runHere.textContent = 'Run audit here again';
      cancel.hidden = true;
    }
  }
  runHere.addEventListener('click', () => void runLocal());
  cancel.addEventListener('click', () => calculation?.abort());
  window.addEventListener('pagehide', () => calculation?.abort());
  function collapse() {
    calculation?.abort();
    panel.hidden = true;
    launch.setAttribute("aria-expanded", "false");
    launch.focus();
  }
  close.addEventListener("click", collapse);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      collapse();
    }
  });
  async function load() {
    if (busy) return;
    busy = true;
    runHere.disabled = true;
    retry.disabled = true;
    retry.hidden = true;
    body.replaceChildren();
    status.textContent = "Looking for a saved audit…";
    try {
      const response = await request(appid);
      loaded = true;
      if (response?.status === "ready") {
        render(response.saved, response.offline);
        status.textContent = response.offline
          ? "Saved offline copy"
          : "Saved audit loaded";
        retry.textContent = "Reload saved audit";
        retry.hidden = false;
      } else {
        const message =
          response?.status === "missing"
            ? "No saved audit yet for this game."
            : response?.status === "unsupported"
              ? "This saved audit needs a newer userscript version."
              : "The saved audit could not be loaded.";
        status.textContent = message;
        body.append(
          el(
            "p",
            calculate ? 'Use “Run audit here” to check this game without leaving Steam.' : "Open the full audit to check this game on Steam Tag Analyzer.",
          ),
        );
        if (
          response?.status !== "missing" &&
          response?.status !== "unsupported"
        ) {
          retry.textContent = "Retry saved audit";
          retry.hidden = false;
        }
      }
    } catch {
      loaded = true;
      status.textContent = "The userscript could not load the audit.";
      body.append(
        el(
          "p",
          "Try again, or reload this Steam page if the userscript was updated.",
        ),
      );
      retry.textContent = "Retry saved audit";
      retry.hidden = false;
    } finally {
      busy = false;
      retry.disabled = false;
      runHere.disabled = false;
    }
  }
  function render(saved, offline, local = false) {
    const audit = saved.audit;
    body.append(el("p", audit.app.name, "tag-name"));
    body.append(
      el(
        "p",
        local ? `Calculated here ${date(saved.generatedAt)} · Steam fetched ${date(audit.app.fetchedAt)}` : `Audit generated ${date(saved.generatedAt)} · Tags observed ${date(audit.snapshotCollectedAt)}`,
        "meta",
      ),
    );
    body.append(
      el(
        "p",
        local ? 'Current Steam audit: uses the description, tags and store features fetched from Steam for this run.' : "Snapshot audit: these tags come from our dataset and may differ from the current Steam page.",
        "notice",
      ),
    );
    if (offline)
      body.append(
        el(
          "p",
          "You are viewing a previously verified copy. Reconnect to check for a newer audit.",
          "meta",
        ),
      );
    if (audit.signal.thin)
      body.append(
        el(
          "p",
          `Limited evidence. ${audit.signal.reason ?? "Treat these suggestions as hints to investigate."}`,
          "notice",
        ),
      );
    if (!audit.featuresKnown)
      body.append(
        el("p", local ? 'Steam did not provide store features for this run.' : "Store features were unavailable in this snapshot.", "meta"),
      );
    body.append(el("h3", `${local ? 'Current' : 'Snapshot'} tags (${audit.tags.length})`));
    const list = el("ol", undefined, "tags");
    for (const tag of audit.tags) {
      const li = el("li"),
        details = el("details"),
        summary = el("summary");
      summary.append(
        el("span", tag.rank === null ? "—" : `#${tag.rank}`, "rank"),
        el("span", tag.tag, "tag-name"),
        el("span", LABELS[tag.bucket], `badge ${tag.bucket}`),
      );
      details.append(summary, el("p", tag.reason, "reason"));
      li.append(details);
      list.append(li);
    }
    body.append(list);
    if (audit.missing.length) {
      body.append(el("h3", "Consider adding"));
      const additions = el("ul", undefined, "suggestions");
      for (const tag of audit.missing.slice(0, 5)) {
        const li = el("li");
        li.append(
          el("span", tag.tag, "tag-name"),
          el("p", tag.explanation, "reason"),
        );
        additions.append(li);
      }
      body.append(additions);
    }
    if (audit.similarGames.length) {
      body.append(el("h3", "Similar games"));
      const games = el("ul", undefined, "suggestions");
      for (const game of audit.similarGames.slice(0, 3)) {
        const li = el("li");
        li.append(
          link(game.name, `https://store.steampowered.com/app/${game.appid}/`),
        );
        games.append(li);
      }
      body.append(games);
    }
  }
  launch.addEventListener("click", () => {
    if (!panel.hidden) {
      collapse();
      return;
    }
    panel.hidden = false;
    launch.setAttribute("aria-expanded", "true");
    if (!loaded) void load();
  });
  retry.addEventListener("click", () => void load());
}
