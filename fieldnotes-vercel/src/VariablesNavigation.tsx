import { ChevronDown, SlidersHorizontal, ShieldCheck } from 'lucide-react';

export default function VariablesNavigation({selected,cleaning,open,onVariables,onCleaning}:{selected:boolean;cleaning:boolean;open:boolean;onVariables:()=>void;onCleaning:()=>void}){
 return <div className="regression-menu variables-menu">
  <button className={'side-link '+(selected?'selected':'')} aria-expanded={open} aria-controls="variables-submenu" onClick={onVariables}><SlidersHorizontal size={17}/><span>01. Variables</span><ChevronDown size={15} className={open?'submenu-chevron open':'submenu-chevron'}/></button>
  {open&&<div id="variables-submenu" className="regression-submenu"><button className={cleaning?'current':''} aria-current={cleaning?'page':undefined} onClick={onCleaning}><ShieldCheck size={13}/><span>Clean & Inspect <small className="optional-label">Optional</small></span></button></div>}
 </div>;
}
