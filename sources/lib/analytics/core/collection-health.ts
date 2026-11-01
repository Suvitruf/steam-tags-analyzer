export interface CollectionHealth {
  recordedAt:string; startedAt:string;
  totals:{released:number;upcoming:number;details:number;tags:number;monthly:number};
  years:Array<{year:number|null;games:number;details:number;tags:number;monthly:number;
    reviewsMissing?:number;reviewsOlder30?:number;weekly?:number;incomplete?:number;historyMissing?:number;belowReviewFloor?:number}>;
  upcoming:{games:number;verified:number;dated:number};
  attempts:Array<{source:string;status:string;games:number}>;
  diagnostics:Array<{reason:string;games:number}>;
  freshness?:{reviewsMissing:number;reviewsOlder30:number;reviewsOlder90:number;tagsMissing:number;tagsOlder30:number};
}

export interface CollectionHealthFile {current:CollectionHealth;runs:CollectionHealth[]}
