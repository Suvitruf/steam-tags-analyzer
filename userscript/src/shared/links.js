/* Synced from extension/src/links.js. Update with npm run sync:shared. */
export const SITE = "https://steam-tags-analyzer.apanasik.com";
export function validAppId(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}
export function steamAppId(value) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://store.steampowered.com") return null;
    const match = /^\/app\/([1-9]\d*)(?:\/|$)/.exec(url.pathname);
    const appid = match ? Number(match[1]) : 0;
    return validAppId(appid) ? appid : null;
  } catch {
    return null;
  }
}
export function auditUrl(appid, fresh = false) {
  if (!validAppId(appid)) throw new Error("Invalid App ID");
  return `${SITE}/audit?appid=${appid}${fresh ? "&live=1" : ""}`;
}
export function allowedRequest(message, sender, extensionId) {
  return (
    message?.type === "load-audit" &&
    validAppId(message.appid) &&
    sender?.id === extensionId &&
    sender.frameId === 0 &&
    steamAppId(sender.url) === message.appid
  );
}
