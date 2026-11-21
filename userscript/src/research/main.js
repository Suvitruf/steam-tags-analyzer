import { createResearchClient } from './client.js';
import { lazyPanel } from './ui.js';
import { currentTagId, tagPanel } from './tags.js';
import { steamAppId } from '../shared/links.js';
import { appContext } from './apps.js';
import { comparison } from './compare.js';
import { publisherPanel } from './publishers.js';
import { upcomingPanel } from './upcoming.js';
import { historyPanel } from './history.js';

export function startResearch(gm) {
  if (window.top !== window) return;
  const url = new URL(location.href), client = createResearchClient(gm);
  const compare=comparison(gm,client);
  function attach() {
    compare.attach(url);
    if(/^\/publisher\/[^/]+/.test(url.pathname)) {
      const heading=document.querySelector('.curator_name'),anchor=document.querySelector('#curator_header_area_ctn_id, .curator_header_ctn, main');
      if(anchor)lazyPanel(anchor,'steam-tag-research-publisher','Steam Tag Analyzer · Publisher portfolio',root=>publisherPanel(root,client,heading?.textContent.trim()??''));
    }
    const appid=steamAppId(url.href);
    if(appid) {
      const anchor=document.querySelector('.glance_tags_ctn, #game_highlights, #appHubAppName');
      if(anchor) lazyPanel(anchor,'steam-tag-research-context','Steam Tag Analyzer · Game context',root=>appContext(root,client,appid));
      if(anchor)lazyPanel(anchor,'steam-tag-research-history','Steam Tag Analyzer · Tag changes',root=>historyPanel(root,gm,appid));
      if(anchor&&document.querySelector('.game_area_comingsoon'))lazyPanel(anchor,'steam-tag-research-upcoming','Steam Tag Analyzer · Upcoming peers',root=>upcomingPanel(root,client,appid));
    }
    if (/^\/tags\/[^/]+\/[^/]+/.test(url.pathname)) {
      const anchor = document.querySelector('#application_config, .page_content, main');
      if (anchor) lazyPanel(anchor, 'steam-tag-research-niche', 'Steam Tag Analyzer · Niche research', root=>tagPanel(root,client,url,currentTagId()));
    }
  }
  attach();
  let timer;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(attach, 150); });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  // Search results keep arriving during scrolling and filter changes.
  if(!/^\/search\/?$/.test(url.pathname))setTimeout(()=>observer.disconnect(),30000);
}
