import { useId, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { coefficient, type NarrativeResult } from './interpretation';

type PlotResult=NarrativeResult & {
  scatter:{x:number;y:number}[];
  stats:{variable:string;mean:number;median:number;std:number}[];
  plot?:{x_min:number;x_max:number;control_reference:number;control_levels:number[]};
};

export function predict(result:NarrativeResult,model:number,x:number,d:number,control:number|string){
  const coefficients=result.models[model].coefficients;
  let value=coefficients[0].estimate+coefficients[1].estimate*x;
  if(model===2)value+=coefficients[2].estimate*d+coefficients[3].estimate*x*d;
  if(model>0){
    for(const term of coefficients.slice(model===2?4:2)){
      value+=term.estimate*(result.config.control_type==='categorical'?(term.term===control?1:0):Number(control));
    }
  }
  return value;
}

export default function RegressionPlot({result}:{result:PlotResult}){
  const mean=result.stats.find(s=>s.variable===result.config.control)!.mean;
  const [view,setView]=useState('all'),[showPoints,setShowPoints]=useState(false);
  const [control,setControl]=useState<number|string>(result.config.control_type==='categorical'?'__reference__':mean);
  const [hover,setHover]=useState<{x:number;left:number;top:number;active:string}|null>(null);
  const chartRef=useRef<HTMLDivElement>(null);
  const tooltipId=useId();
  const categorical=result.config.control_type==='categorical';
  const xmin=result.plot?.x_min??Math.min(...result.scatter.map(p=>p.x));
  const xmax=result.plot?.x_max??Math.max(...result.scatter.map(p=>p.x));
  const specs=[
    {name:'Model 1 · unadjusted',model:0,d:0,color:'#bd7d4d',dash:'7 4'},
    {name:'Model 2 · adjusted',model:1,d:0,color:'#6489b2',dash:''},
    {name:'Model 3 · D = 0',model:2,d:0,color:'#8974ad',dash:''},
    {name:'Model 3 · D = 1',model:2,d:1,color:'#588860',dash:''}
  ].filter(s=>view==='all'||s.model===Number(view));
  const lines=specs.map(s=>({...s,points:Array.from({length:61},(_,i)=>{const x=xmin+(xmax-xmin)*i/60;return {x,y:predict(result,s.model,x,s.d,control)};})}));
  const values=[...lines.flatMap(s=>s.points.map(p=>p.y)),...(showPoints?result.scatter.map(p=>p.y):[])];
  const low=Math.min(...values),high=Math.max(...values),padding=(high-low||1)*.1;
  const ymin=low-padding,ymax=high+padding;
  const xx=(x:number)=>78+(x-xmin)/(xmax-xmin||1)*690;
  const yy=(y:number)=>312-(y-ymin)/(ymax-ymin||1)*260;
  const hoveredLines=hover?lines.map(line=>({...line,y:predict(result,line.model,hover.x,line.d,control)})):[];
  function movePointer(event:PointerEvent<SVGSVGElement>){
    const svg=event.currentTarget, matrix=svg.getScreenCTM(), box=chartRef.current?.getBoundingClientRect();
    if(!matrix||!box)return;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(matrix.inverse());
    if(local.x<78||local.x>768||local.y<52||local.y>312){setHover(null);return;}
    const x=xmin+(local.x-78)/690*(xmax-xmin);
    const nearest=lines.reduce((best,line)=>Math.abs(yy(predict(result,line.model,x,line.d,control))-local.y)<Math.abs(yy(predict(result,best.model,x,best.d,control))-local.y)?line:best);
    const width=Math.min(282,box.width-16), pointerLeft=event.clientX-box.left;
    const left=pointerLeft+width+24<box.width?pointerLeft+18:pointerLeft-width-18;
    setHover({x,left:Math.max(8,Math.min(left,box.width-width-8)),top:Math.max(8,Math.min(event.clientY-box.top-75,box.height-240)),active:nearest.name});
  }
  function keyboardHover(event:KeyboardEvent<SVGSVGElement>){
    if(event.key==='Escape'){setHover(null);return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const x=event.key==='Home'?xmin:event.key==='End'?xmax:Math.max(xmin,Math.min(xmax,(hover?.x??(xmin+xmax)/2)+(event.key==='ArrowLeft'?-1:1)*(xmax-xmin)/50));
    setHover({x,left:12,top:12,active:''});
  }
  const ref=result.plot?.control_reference;
  return <section id="regression-lines" className="panel regression-plot results-anchor">
    <div className="section-heading"><div><span className="eyebrow">FITTED REGRESSION LINES</span><h2>See what each model predicts</h2></div></div>
    <div className="plot-options">
      <label className="field">Show lines<select value={view} onChange={e=>setView(e.target.value)}><option value="all">Compare all three models</option><option value="0">Model 1 · baseline</option><option value="1">Model 2 · with control</option><option value="2">Model 3 · D = 0 and D = 1</option></select></label>
      <label className="field">Hold {result.config.control} at{categorical?
        <select value={control} onChange={e=>setControl(e.target.value)}><option value="__reference__">Reference category{ref!==undefined?` · code ${ref}`:''}</option>{result.models[1].coefficients.slice(2).map(c=><option key={c.term} value={c.term}>{c.term}</option>)}</select>:
        <input aria-label={`Plot value for ${result.config.control}`} type="number" step="any" value={control} onChange={e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))setControl(Number(e.target.value));}}/>
      }</label>
      {!categorical&&<button className="button" onClick={()=>setControl(mean)}>Use sample mean</button>}
      <label className="point-toggle"><input type="checkbox" checked={showPoints} onChange={e=>setShowPoints(e.target.checked)}/> Show sampled observations</label>
    </div>
    <p className="muted">Models 2 and 3 hold {result.config.control} {categorical?`in ${control==='__reference__'?'the omitted reference category':String(control)}`:`at ${coefficient(Number(control))}`}. Model 1 has no control adjustment. Changing this plot setting changes predictions without refitting the models.</p>
    <div className="regression-chart-wrap" ref={chartRef}>
    <svg viewBox="0 0 820 380" role="img" tabIndex={0} aria-describedby={hover?tooltipId:undefined} aria-label={`Fitted regression lines for ${result.config.y} against ${result.config.x}. Hover or use left and right arrow keys to inspect predictions. Escape dismisses the tooltip.`} onPointerMove={movePointer} onPointerLeave={()=>setHover(null)} onPointerDown={movePointer} onFocus={()=>setHover({x:(xmin+xmax)/2,left:12,top:12,active:''})} onBlur={()=>setHover(null)} onKeyDown={keyboardHover} style={{width:'100%',minHeight:240,fontFamily:'var(--mono)',fontSize:10}}>
      {Array.from({length:6},(_,i)=>{const y=ymin+(ymax-ymin)*i/5;return <g key={i}><line x1="78" x2="768" y1={yy(y)} y2={yy(y)} stroke="#dfd5c5" strokeDasharray="3 4"/><text x="67" y={yy(y)+4} fill="#857b6d" textAnchor="end">{y.toFixed(2)}</text></g>;})}
      {Array.from({length:7},(_,i)=>{const x=xmin+(xmax-xmin)*i/6;return <text key={i} x={xx(x)} y="336" textAnchor="middle" fill="#857b6d">{x.toFixed(1)}</text>;})}
      <text x="425" y="365" textAnchor="middle">{result.config.x}</text><text transform="translate(17,180) rotate(-90)" textAnchor="middle">Predicted {result.config.y}</text>
      {showPoints&&result.scatter.map((p,i)=><circle key={i} cx={xx(p.x)} cy={yy(p.y)} r="2.7" fill="#a69b86" opacity=".2"/>)}
      {lines.map(line=><polyline key={line.name} points={line.points.map(p=>`${xx(p.x)},${yy(p.y)}`).join(' ')} fill="none" stroke={line.color} strokeWidth={hover?.active===line.name?4:3} strokeDasharray={line.dash}/>)}
      {hover&&<g pointerEvents="none"><line x1={xx(hover.x)} x2={xx(hover.x)} y1="52" y2="312" stroke="#9a927f" strokeDasharray="3 5"/>{hoveredLines.map(line=><circle key={line.name} cx={xx(hover.x)} cy={yy(line.y)} r={hover.active===line.name?5:4} fill="#fcf9f2" stroke={line.color} strokeWidth="2.5"/>)}</g>}
    </svg>
    {hover&&<div id={tooltipId} role="tooltip" className="regression-tooltip" style={{left:hover.left,top:hover.top}}>
      <div className="regression-tooltip-heading"><span>FITTED PREDICTIONS</span><span className="tooltip-live-dot"/></div>
      <div className="regression-tooltip-x"><span>{result.config.x}</span><strong>{coefficient(hover.x)}</strong></div>
      <div className="regression-tooltip-outcome">Predicted {result.config.y}</div>
      {hoveredLines.map(line=><div className={'regression-tooltip-row '+(hover.active===line.name?'nearest':'')} key={line.name}><span><i style={{background:line.color}}/>{line.name}</span><strong>{coefficient(line.y)}</strong></div>)}
      <div className="regression-tooltip-note">{categorical?`${result.config.control}: ${control==='__reference__'?'reference category':String(control)}`:`${result.config.control} held at ${coefficient(Number(control))}`}<br/>Model 1 remains unadjusted.</div>
    </div>}
    </div>
    <div className="regression-legend">{lines.map(line=><span key={line.name}><i style={{borderColor:line.color,borderStyle:line.dash?'dashed':'solid'}}/>{line.name}</span>)}</div>
    <p className="tiny">D = 1: codes {result.config.one_values.join(', ')} of {result.config.z}; D = 0: remaining valid categories. Lines show fitted means, without confidence bands. Regression estimates use all complete cases; optional dots show {result.scatter.length.toLocaleString()} sampled rows. {result.plot?'The X range covers the regression sample.':'For this saved experiment, the X range covers its stored display sample.'} Linear predictions can fall outside the outcome’s possible range and should not be read as causal effects.</p>
  </section>;
}
