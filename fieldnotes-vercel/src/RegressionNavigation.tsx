import { ChevronDown, GitBranch } from 'lucide-react';

export const regressionSections = [
  {id:'regression-overview',label:'Overview'},
  {id:'regression-lines',label:'Regression lines'},
  {id:'full-coefficients',label:'Coefficient tables'},
  {id:'equations-interpretation',label:'Interpretation'},
];

export default function RegressionNavigation({selected,open,active,onToggle,onNavigate,disabled=false}:{
  selected:boolean;open:boolean;active:string;onToggle:()=>void;onNavigate:(id:string)=>void;disabled?:boolean;
}){
  return <div className="regression-menu">
    <button className={'side-link '+(selected?'selected':'')} disabled={disabled} onClick={onToggle} aria-expanded={open} aria-controls="regression-submenu">
      <GitBranch size={17}/><span>03. Regressions</span><ChevronDown size={15} className={open?'submenu-chevron open':'submenu-chevron'}/>
    </button>
    {open&&<div id="regression-submenu" className="regression-submenu" aria-label="Regression sections">
      {regressionSections.map(section=><button key={section.id} disabled={disabled} onClick={()=>onNavigate(section.id)} aria-current={selected&&active===section.id?'location':undefined} className={selected&&active===section.id?'current':''}><span className="submenu-dot"/>{section.label}</button>)}
    </div>}
  </div>;
}
