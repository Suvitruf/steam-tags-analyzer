import { createTagHistory, tagDifference } from './history-store.js';
import { el, action, table } from './ui.js';

export async function historyPanel(root,gm,appid) {
  const history=createTagHistory(gm),output=el('div',null,root);
  el('p','Local history of the first 20 Steam tags, collected when you open or refresh this panel. Two observations per game are kept on this device (up to 100 games); there is no history before your first check.',root,'note');
  const render=value=>{
    output.replaceChildren();
    if(!value){el('p','No saved observation yet.',output);return;}
    const {current,previous}=value;
    el('p',`${current.name} · Checked ${current.at}. Steam source: ${current.fetchedAt??'timestamp unavailable'}.`,output,'note');
    if(!previous)el('p','First observation saved. Open this panel on a later visit to see changes.',output);
    else {
      el('p',`Compared with ${previous.at}.`,output,'note');
      const diff=tagDifference(previous,current);
      const rows=[...diff.added.map(t=>['Entered top 20',t.name,'—',t.rank]),...diff.removed.map(t=>['Left top 20',t.name,t.rank,'—']),...diff.moved.map(t=>['Moved',t.name,t.previous,t.rank]),...diff.renamed.map(t=>['Name changed',t.name,t.previous,t.name])];
      if(rows.length)table(output,['Change','Tag','Previous','Current'],rows);
      else el('p','No changes in the observed top 20 tags.',output);
    }
    el('p','Leaving this list does not prove a tag was removed from Steam; it can move below position 20.',output,'note');
    table(output,['Current rank','Tag'],current.tags.map(t=>[t.rank,t.name]));
  };
  render(await history.read(appid));
  const check=async()=>{
    refresh.disabled=true;forget.disabled=true;
    try {render(await history.check(appid));}finally{refresh.disabled=false;forget.disabled=false;}
  };
  const refresh=action(root,'Check current tags',check);
  const forget=action(root,'Forget local tag history',async()=>{await history.remove(appid);render(null);});
  try {await check();}
  catch(error){el('p',error.message,root,'note');}
}
