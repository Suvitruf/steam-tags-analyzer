/** Calendar-month arithmetic used by the browser analytics. */
export const monthNumber=(key:string)=>Number(key.slice(0,4))*12+Number(key.slice(5,7))-1;
export const monthKey=(n:number)=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
