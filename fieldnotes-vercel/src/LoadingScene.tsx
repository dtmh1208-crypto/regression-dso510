import { Check, FlaskConical, RotateCcw } from 'lucide-react';

export type LoadingTask={id:string;label:string;done:boolean};
export function loadingProgress(tasks:LoadingTask[]){
 const completed=tasks.filter(task=>task.done).length;
 return {completed,total:tasks.length,percent:tasks.length?Math.round(completed/tasks.length*100):0,ready:tasks.length>0&&completed===tasks.length};
}

export default function LoadingScene({tasks,error,onRetry}:{tasks:LoadingTask[];error:string;onRetry:()=>void}){
 const {completed,total,percent}=loadingProgress(tasks);
 const filled=Math.floor(percent/100*12);
 return <main className="loading-page" aria-busy={!error}>
  <div className="loading-brand"><FlaskConical size={23}/><strong>field<span className="highlight">notes</span></strong><small>/ DSO 510</small></div>
  <section className="loading-scene" aria-labelledby="loading-title">
   <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
   <h1 id="loading-title">{error?'A little help getting ready.':'Getting your data ready.'}</h1>
   <p className="loading-description">Preparing your variables, response codes, and moderator groups before you begin.</p>
   <div className="ascii-building-panel">
    <div className="ascii-building" role="progressbar" aria-label="Data preparation tasks completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${completed} of ${total} preparation tasks complete`}>
     <span className="ascii-building-label" aria-hidden="true">building</span><span className="ascii-building-blocks" aria-hidden="true">{Array.from({length:12},(_,i)=><span className={i<filled?'ascii-block filled':'ascii-block pending'} style={{animationDelay:`${i*.09}s`}} key={i}>{i<filled?'█':'░'}</span>)}</span><strong aria-hidden="true">{percent}%</strong>
    </div>
    <p className="loading-progress-caption" role="status">{completed} of {total} preparation tasks complete</p>
   </div>
   <ul className="loading-checklist" aria-label="Loading checklist">{tasks.map(task=><li className={task.done?'complete':'waiting'} key={task.id}><span className="loading-task-icon" aria-hidden="true">{task.done?<Check size={13}/>:<span className="loading-task-dot"/>}</span><span>{task.label}</span><small>{task.done?'ready':'waiting'}</small></li>)}</ul>
   {error?<div className="loading-error" role="alert"><p>{error}</p><button className="button primary" onClick={onRetry}><RotateCcw size={14}/> Retry loading</button></div>:<p className="loading-footnote">The page opens when every selected variable is ready, including the choices for D = 1. Your first visit may take a little longer.</p>}
  </section>
 </main>;
}
