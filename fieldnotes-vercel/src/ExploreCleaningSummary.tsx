import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import type { CleaningRule } from './cleaning';

type Config={x:string;y:string;z:string;control:string;rules:Record<string,CleaningRule>};
type Variable={name:string;label:string;rule:CleaningRule};
type Audit={variable:string;missing_before:number;code_excluded:number;range_excluded:number;excluded:number;recoded:number;retained:number;recodes:{from:number;to:number;n:number}[]};
type Summary={base_n:number;n:number;removed:number;recoded_rows:number;recoded_rows_retained:number;recoded_rows_removed:number;recoded_cells:number;audit:Audit[]};
const num=(n:number)=>n.toLocaleString();

export function cleaningRuleDescription(rule:CleaningRule){
 const exclusions=[...rule.exclude.map(String),...(rule.exclude_ranges||[]).map(([a,b])=>`${a}–${b}`)];
 const recodes=Object.entries(rule.recode).map(([a,b])=>`${a} → ${b}`);
 return {exclude:exclusions.length?exclusions.join(', '):'None',recode:recodes.length?recodes.join(', '):'None',limits:rule.min===null&&rule.max===null?'None':`${rule.min??'No minimum'} to ${rule.max??'No maximum'}`};
}

export default function ExploreCleaningSummary({config,variables,pending,busy,onVariables,onRun}:{config:Config;variables:Variable[];pending:boolean;busy:boolean;onVariables:()=>void;onRun:()=>void}){
 const [summary,setSummary]=useState<Summary|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const request=JSON.stringify({x:config.x,y:config.y,z:config.z,control:config.control,rules:config.rules});
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setSummary(null);
  fetch('/api/preview-cleaning',{method:'POST',headers:{'Content-Type':'application/json'},body:request,signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to summarize cleaning.');return data;}).then(data=>{setSummary(data);setLoading(false);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
  return()=>controller.abort();
 },[request,retry]);
 const roles:Record<string,string>={[config.x]:'X · Driver',[config.y]:'Y · Outcome',[config.z]:'Z · Moderator',[config.control]:'Control'};
 return <section className="panel explore-cleaning-summary" aria-labelledby="cleaning-summary-title">
  <div className="section-heading"><div><span className="eyebrow">02 / PREVIEW DATA BEFORE REGRESSION</span><h2 id="cleaning-summary-title">Cleaning across all four variables</h2></div><button className="button" onClick={onVariables}><ArrowLeft size={14}/> Back to Variables</button></div>
  <p className="muted">Each variable keeps its own rules. This summary combines all applied rules before you run any regressions.</p>
  {pending&&<div className="alert">You have unapplied drafts. Counts below use saved rules only. Return to Variables and open optional Clean & Inspect to apply your edits before running.</div>}
  {loading&&<p className="cleaning-loading" role="status">Counting exclusions and recodes across all four variables… No regressions are running.</p>}
  {error&&<div className="alert error" role="alert">{error}<button onClick={()=>setRetry(v=>v+1)}>Retry summary</button></div>}
  {summary&&!loading&&<>
   <div className="cleaning-counts explore-counts" aria-live="polite"><div><span>Starting frozen rows</span><strong>{num(summary.base_n)}</strong></div><div><span>Unique rows removed</span><strong>{num(summary.removed)}</strong></div><div><span>Unique rows with recodes</span><strong>{num(summary.recoded_rows)}</strong></div><div><span>Rows ready for regression</span><strong>{num(summary.n)}</strong></div></div>
   <p className="cleaning-total"><ShieldCheck size={15}/> <span><strong>{num(summary.base_n)}</strong> starting rows − <strong>{num(summary.removed)}</strong> removed = <strong>{num(summary.n)}</strong> complete rows. These are the rows all three models will share.</span></p>
   <div className="cleaning-summary-table"><table><thead><tr><th>Variable / role</th><th>Applied rules</th><th>Already missing</th><th>Code / range exclusions</th><th>Min / max exclusions</th><th>Values recoded</th><th>Valid values left</th></tr></thead><tbody>{summary.audit.map(a=>{
    const variable=variables.find(v=>v.name===a.variable);
    const rule=config.rules[a.variable]||variable?.rule||{exclude:[],recode:{},min:null,max:null};
    const description=cleaningRuleDescription(rule);
    return <tr key={a.variable}><td><strong>{a.variable}</strong><small>{roles[a.variable]}</small></td><td className="summary-rules"><div><b>Exclude:</b> {description.exclude}</div><div><b>Recode:</b> {description.recode}</div><div><b>Limits:</b> {description.limits}</div></td><td>{num(a.missing_before)}</td><td>{num(a.code_excluded)}</td><td>{num(a.range_excluded)}</td><td><strong>{num(a.recoded)}</strong>{a.recodes.map((r,i)=><small key={i}>{r.from} → {r.to}: {num(r.n)} rows</small>)}</td><td>{num(a.retained)}</td></tr>;
   })}</tbody></table></div>
   <div className="cleaning-summary-notes"><p><strong>Removed rows are counted once.</strong> A respondent excluded by two variables appears in both variable rows above, but only once in the combined removed total.</p><p><strong>Recoding changes values; it does not automatically remove rows.</strong> There are <strong>{num(summary.recoded_cells)}</strong> changed values across <strong>{num(summary.recoded_rows)}</strong> unique respondents. Of those respondents, <strong>{num(summary.recoded_rows_retained)}</strong> remain in the final sample and <strong>{num(summary.recoded_rows_removed)}</strong> are excluded by another rule or missing value.</p></div>
  </>}
  <div className="cleaning-footer"><span className="tiny">Counts start from Part 1; original CSV values stay unchanged.</span><button className="button primary" disabled={busy||pending||loading||!!error||!summary||summary.n<30} onClick={onRun}>Run all three models <ArrowRight size={15}/></button></div>
 </section>;
}
