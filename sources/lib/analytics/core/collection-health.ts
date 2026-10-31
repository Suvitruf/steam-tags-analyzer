export interface CollectionHealth {
  recordedAt:string; startedAt:string;
  totals:{released:number;upcoming:number;details:number;tags:number;monthly:number};
  years:Array<{year:number|null;games:number;details:number;tags:number;monthly:number}>;
  upcoming:{games:number;verified:number;dated:number};
  attempts:Array<{source:string;status:string;games:number}>;
  diagnostics:Array<{reason:string;games:number}>;
}

export interface CollectionHealthFile {current:CollectionHealth;runs:CollectionHealth[]}
