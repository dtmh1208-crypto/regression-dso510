export type CleaningRule={exclude:number[];exclude_ranges?:[number,number][];recode:Record<string,number>;min:number|null;max:number|null};
export type CleaningDraft={exclude:string;recode:string;min:string;max:string};
export function draftFor(rule:CleaningRule):CleaningDraft{
 return {exclude:[...rule.exclude.map(String),...(rule.exclude_ranges||[]).map(([a,b])=>`${a}-${b}`)].join(', '),recode:Object.entries(rule.recode).map(([a,b])=>`${a}:${b}`).join(', '),min:rule.min===null?'':String(rule.min),max:rule.max===null?'':String(rule.max)};
}
const numeric='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
export function parseExclusions(text:string){
 const exclude:number[]=[],exclude_ranges:[number,number][]=[];
 if(!text.trim())return {exclude,exclude_ranges};
 for(const raw of text.split(',')){
  const token=raw.trim().replace(/^(["'])(.*)\1$/,'$2').trim().replace(/[–−—]/g,'-');
  if(new RegExp(`^${numeric}$`).test(token)&&Number.isFinite(Number(token))){exclude.push(Number(token));continue;}
  const range=token.match(new RegExp(`^(${numeric})\\s*-\\s*(${numeric})$`));
  if(range){const a=Number(range[1]),b=Number(range[2]);if(a>b)throw Error('Write ranges from lowest to highest, such as 80-99.');exclude_ranges.push([a,b]);continue;}
  throw Error(`Cannot read “${raw.trim()}”. Use numeric codes or inclusive ranges, such as 77, 80-99. Literal text categories need numeric encoding before regression.`);
 }
 return {exclude:[...new Set(exclude)],exclude_ranges};
}
export function parseDraft(draft:CleaningDraft):CleaningRule{
 const exclusions=parseExclusions(draft.exclude),recode:Record<string,number>={};
 if(draft.recode.trim())for(const pair of draft.recode.split(',')){
  const values=pair.split(':');
  if(values.length!==2||values.some(v=>!v.trim()||!new RegExp(`^${numeric}$`).test(v.trim())||!Number.isFinite(Number(v))))throw Error('Use numeric recodes such as 88:0, separated by commas.');
  const key=String(Number(values[0]));if(key in recode)throw Error(`Code ${key} appears more than once in recodes.`);recode[key]=Number(values[1]);
 }
 const min=draft.min.trim()===''?null:Number(draft.min),max=draft.max.trim()===''?null:Number(draft.max);
 if(min!==null&&!Number.isFinite(min)||max!==null&&!Number.isFinite(max))throw Error('Minimum and maximum must be numbers.');
 if(min!==null&&max!==null&&min>max)throw Error('Minimum cannot be greater than maximum.');
 return {...exclusions,recode,min,max};
}
