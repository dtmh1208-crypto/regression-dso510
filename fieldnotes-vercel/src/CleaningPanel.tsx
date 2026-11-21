import { useState } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { draftFor, parseDraft, parseExclusions, type CleaningRule, type CleaningDraft } from './cleaning';

type Variable={name:string;label:string;codes:{value:string;label:string}[];rule:CleaningRule};
type Config={x:string;y:string;z:string;control:string;rules:Record<string,CleaningRule>};
type Counts={variable:string;missing_before:number;excluded:number;code_excluded:number;range_excluded:number;recoded:number;retained:number;recodes:{from:number;to:number;n:number}[]};
type Preview={base_n:number;n:number;removed:number;variable:string;audit:Counts[];examples:{before:number;after:number|null;retained_in_sample:boolean}[];config:Config};
type Props={config:Config;variables:Variable[];profiles:Record<string,{missing:number;unique:number;values:{value:number;n:number}[]}>;active:string;setActive:(n:string)=>void;drafts:Record<string,CleaningDraft>;setDrafts:(drafts:Record<string,CleaningDraft>)=>void;onApply:(name:string,rule:CleaningRule)=>void;onBack:()=>void};
const num=(n:number)=>n.toLocaleString();

export default function CleaningPanel({config,variables,profiles,active,setActive,drafts,setDrafts,onApply,onBack}:Props){
 const selected=[...new Set([config.y,config.x,config.z,config.control])];
 const name=selected.includes(active)?active:config.y;
 const variable=variables.find(v=>v.name===name);
 const current=config.rules[name]||variable?.rule||{exclude:[],recode:{},min:null,max:null};
 const draft=drafts[name]||draftFor(current);
 const dirty=JSON.stringify(draft)!==JSON.stringify(draftFor(current));
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const profile=profiles[name];
 function edit(changes:Partial<CleaningDraft>){if(busy)return;setDrafts({...drafts,[name]:{...draft,...changes}});setError('');}
 async function apply(candidate=draft){
  setError('');setBusy(true);
  try{
   const rule=parseDraft(candidate);
   const snapshot={...config,rules:{...config.rules,[name]:rule},preview_variable:name};
   const response=await fetch('/api/preview-cleaning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to preview cleaning.');
   onApply(name,rule);const next={...drafts};delete next[name];setDrafts(next);setPreview(data);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function codeCount(code:string){
  if(!profile||profile.unique>profile.values.length)return '—';
  try{const rule=parseExclusions(code);return num(profile.values.filter(v=>rule.exclude.includes(v.value)||rule.exclude_ranges.some(([a,b])=>v.value>=a&&v.value<=b)).reduce((n,v)=>n+v.n,0));}catch{return code==='BLANK'?num(profile.missing):'—';}
 }
 const counts=preview?.audit.find(a=>a.variable===name);
 const previewStale=preview&&(dirty||preview.variable!==name||JSON.stringify(preview.config.rules)!==JSON.stringify(config.rules)||preview.config.x!==config.x||preview.config.y!==config.y||preview.config.z!==config.z||preview.config.control!==config.control);
 return <section className="panel cleaning-panel">
  <div className="section-heading"><div><span className="eyebrow">01 / VARIABLES / OPTIONAL</span><h2>Clean & Inspect codes</h2></div><button className="button" onClick={onBack}><ArrowLeft size={15}/> Back to Variables</button></div>
  <p className="muted">This is an optional part of Variables. Inspect or apply rules here, then return to Variables to continue to Preview Data before Regression.</p>
  <ol className="cleaning-guide"><li>Pick a variable</li><li>Edit optional rules</li><li>Apply & preview counts</li><li>Back to Variables</li></ol>
  <div className="tabs">{selected.map(n=><button key={n} className={'tab '+(name===n?'active':'')} onClick={()=>setActive(n)}>{n}{drafts[n]&&JSON.stringify(drafts[n])!==JSON.stringify(draftFor(config.rules[n]||variables.find(v=>v.name===n)!.rule))?' · unsaved':''}</button>)}</div>
  <h3>{variable?.label||name}</h3>
  <div className="clean-layout"><div>
   <p className="muted">Start with the frozen Part 1 rows. Rules run in this order: exclusions → recodes → minimum/maximum. Missing values are always excluded.</p>
   <label className="field">Exclude response codes or ranges<small>Examples: 77, 99 or 80-99. Ranges include both endpoints. Quotes around numeric codes/ranges are optional.</small><input value={draft.exclude} onChange={e=>edit({exclude:e.target.value})} placeholder="77, 80-99"/></label>
   <p className="tiny">A codebook entry such as “80 - 99” describes numeric values, not a string stored in the data. Literal text categories are not supported here; use the numeric survey codes.</p>
   {name==='_AGE80'&&<div className="alert">Age code 80 is valid and means “80 or older.” Excluding 80-99 removes those respondents; it does not just remove missing answers.</div>}
   <label className="field">Recode values<small>Example: 88:0 changes code 88 to zero. Multiple rules: 1:0, 2:1. This changes values, not column names.</small><input value={draft.recode} onChange={e=>edit({recode:e.target.value})} placeholder="88:0"/></label>
   <div className="range-fields"><label className="field">Minimum<input type="number" value={draft.min} placeholder="No limit" onChange={e=>edit({min:e.target.value})}/></label><label className="field">Maximum<input type="number" value={draft.max} placeholder="No limit" onChange={e=>edit({max:e.target.value})}/></label></div>
   {dirty&&<p className="draft-warning">Unapplied changes. Apply & preview to save them. Your draft stays here when you switch tabs or return to Variables.</p>}
   {error&&<div className="alert error" role="alert">{error}</div>}
   <div className="cleaning-actions"><button className="button primary" disabled={busy||!variable} onClick={()=>apply()}><Check size={15}/>{busy?'Checking rows…':'Apply & preview cleaning'}</button><button className="button" disabled={busy||!variable} onClick={()=>apply(draftFor(variable!.rule))}><RotateCcw size={14}/> Dictionary defaults</button></div>
   <p className="tiny">MENTHLTH 88 → 0 was already applied in Part 1. Its extra recode count can correctly be zero. Original CSV values remain unchanged.</p>
  </div><div className="codebook"><div className="codebook-title">CODEBOOK & FROZEN-SAMPLE COUNTS</div><div className="table-scroll"><table><thead><tr><th>Code / range</th><th>Meaning</th><th>Rows</th></tr></thead><tbody>{variable?.codes.map((c,i)=><tr key={i}><td><code>{c.value}</code></td><td>{c.label}</td><td>{codeCount(c.value)}</td></tr>)}</tbody></table></div><p className="tiny">Before extra cleaning. Missing: {profile?num(profile.missing):'…'}. “—” means a count is unavailable in the stored profile.</p></div></div>
  {preview&&<div className="cleaning-preview" aria-live="polite" role="status">
   <div className="section-heading"><div><span className="eyebrow">{previewStale?'LAST PREVIEW · UPDATE TO REFRESH':'RULES APPLIED · PREVIEW COMPLETE'}</span><h3>{previewStale?'Previous cleaning preview':`Cleaning saved for ${preview.variable}`}</h3></div></div>
   {counts&&<div className="cleaning-counts"><div><span>Missing before rules</span><strong>{num(counts.missing_before)}</strong></div><div><span>Excluded by codes/ranges</span><strong>{num(counts.code_excluded)}</strong></div><div><span>Values recoded</span><strong>{num(counts.recoded)}</strong></div><div><span>Excluded by min/max</span><strong>{num(counts.range_excluded)}</strong></div></div>}
   <p className="cleaning-total">Across all four variables: <strong>{num(preview.n)}</strong> complete rows remain from <strong>{num(preview.base_n)}</strong>. <strong>{num(preview.removed)}</strong> rows are excluded in total.</p>
   <table><thead><tr><th>Variable</th><th>Missing</th><th>Excluded by rules</th><th>Recoded</th><th>Valid values remaining</th></tr></thead><tbody>{preview.audit.map(a=><tr key={a.variable}><td>{a.variable}</td><td>{num(a.missing_before)}</td><td>{num(a.excluded)}</td><td>{num(a.recoded)}</td><td>{num(a.retained)}</td></tr>)}</tbody></table>
   {counts&&counts.recodes.length>0&&<><h3>Recode confirmations · {name}</h3><table><thead><tr><th>Original value</th><th>New value</th><th>Rows changed</th></tr></thead><tbody>{counts.recodes.map((r,i)=><tr key={i}><td>{r.from}</td><td>{r.to}</td><td>{num(r.n)}</td></tr>)}</tbody></table></>}
   {preview.examples.length>0&&<details className="cleaning-examples"><summary>Before / after examples · {preview.variable}</summary><table><thead><tr><th>Before</th><th>After</th><th>In final sample?</th></tr></thead><tbody>{preview.examples.map((e,i)=><tr key={i}><td>{e.before}</td><td>{e.after===null?'Excluded':e.after}</td><td>{e.retained_in_sample?'Yes':'No'}</td></tr>)}</tbody></table></details>}
   <p className="tiny">Counts are calculated from the frozen sample, not accumulated across clicks. A recoded row can still be excluded by a later limit or another variable. Missing/excluded counts may overlap between variables. This preview does not fit regressions.</p>
  </div>}
  <div className="cleaning-footer"><button className="button" onClick={onBack}><ArrowLeft size={15}/> Back to Variables</button></div>
 </section>;
}
