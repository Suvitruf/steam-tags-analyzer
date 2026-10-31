import { DEFAULT_REVIEW_THRESHOLD, reviewThreshold } from './core/thresholds';
import { el } from './format';

const KEY='steam-tags.review-threshold.v1';
let current:number|undefined;
export function getReviewThreshold():number {
  if(current!==undefined)return current;
  const raw=new URLSearchParams(location.search).get('threshold');
  if(raw!==null)return current=reviewThreshold(raw);
  try{return current=reviewThreshold(localStorage.getItem(KEY));}catch{return current=DEFAULT_REVIEW_THRESHOLD;}
}
export function mountReviewThreshold(root:HTMLElement):boolean {
  const form=el('form','review-threshold-controls'),error=el('p','coverage-warning');error.setAttribute('role','alert');
  let value=DEFAULT_REVIEW_THRESHOLD,valid=true;
  try{value=getReviewThreshold();}catch(e){valid=false;error.textContent=(e as Error).message;}
  const label=el('label','research-field',form);el('span',undefined,label).textContent='Review threshold';
  const input=el('input',undefined,label);input.type='number';input.value=String(value);input.min='1';input.step='1';input.max=String(Number.MAX_SAFE_INTEGER);input.required=true;
  const apply=el('button','research-button',form);apply.type='submit';apply.textContent='Apply review threshold';
  const reset=el('button','research-button',form);reset.type='button';reset.textContent='Reset to 250';
  const note=el('p','viz-caption',form);note.textContent='Games reach this threshold at this many reviews or more. Default: 250. This is a review outcome, not a revenue or profitability measure. Saved on this device; shared links keep their selected value.';
  form.append(error);root.before(form);
  const applyValue=(value:number)=>{
    try{localStorage.setItem(KEY,String(value));}catch{/* The URL remains sufficient when storage is unavailable. */}
    const url=new URL(location.href);url.searchParams.set('threshold',String(value));location.assign(url.href);
  };
  form.addEventListener('submit',e=>{e.preventDefault();try{applyValue(reviewThreshold(input.value));}catch(e){error.textContent=(e as Error).message;}});
  reset.addEventListener('click',()=>applyValue(DEFAULT_REVIEW_THRESHOLD));
  if(valid){
    const url=new URL(location.href);url.searchParams.set('threshold',String(value));history.replaceState(null,'',url);
    try{localStorage.setItem(KEY,String(value));}catch{/* Links keep the setting without storage. */}
    for(const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')){
      const target=new URL(link.href);if(target.origin===location.origin&&/\/(tags|benchmarks|trends|timing|features|prices|combos|map|lifecycle|publishers)(\.html|\/)?$/.test(target.pathname)){
        target.searchParams.set('threshold',String(value));link.href=target.href;
      }
    }
  }
  else root.textContent='Choose a valid review threshold to load the comparisons.';
  return valid;
}
