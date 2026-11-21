const PREFIX='steam-tag-research:compare:';
export function createSelection(gm) {
  async function list() {
    const ids=[];
    for(const key of await gm.listValues())if(key.startsWith(PREFIX)) {
      const id=Number(key.slice(PREFIX.length));
      if(Number.isSafeInteger(id)&&id>0&&(await gm.getValue(key,false))===true)ids.push(id);
    }
    return ids.sort((a,b)=>a-b);
  }
  async function set(id, selected) {
    if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid App ID');
    if(selected) {
      const ids=await list();if(ids.length>=12&&!ids.includes(id))throw Error('Choose up to 12 games. Remove one from the comparison first.');
      await gm.setValue(PREFIX+id,true);
    } else await gm.deleteValue(PREFIX+id);
  }
  return {list,set};
}
