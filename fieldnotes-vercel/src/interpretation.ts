export type Estimate = {term:string; estimate:number; se:number; p:number; low:number; high:number};
export type NarrativeResult = {
  config:{x:string;y:string;z:string;control:string;control_type:string;one_values:number[];se:string};
  models:{coefficients:Estimate[];n:number;r2:number}[];
  slopes:(Estimate & {group:string})[];
};

export function coefficient(value:number):string {
  if (value === 0) return '0.0000';
  return Math.abs(value)<.0001 ? value.toExponential(3) : value.toFixed(4);
}

// Keep text as React/text nodes; no HTML interpretation of variable names or values.
export function statisticParts(text:string):string[]{
  return text.split(/(95% CI\s*\[[^\]]+\]|\bp\s*(?:<|=)\s*\d+(?:\.\d+)?|\[[−+\-\d., eE]+\]|[−+\-]?\d+\.\d+(?:e[+\-]?\d+)?%?|\b\d{1,3}(?:,\d{3})+\b|\b(?:do not reject equal slopes|reject equal slopes|do not reject|reject)\b)/g);
}

export function emphasizeMarkdown(text:string):string{
  return statisticParts(text).map((part,i)=>i%2?`**${part}**`:part).join('');
}

const signed=(value:number)=>`${value<0?'−':'+'} ${coefficient(Math.abs(value))}`;
export function fittedEquation(result:NarrativeResult, model:number, group?:0|1):string {
  const {x,y,control}=result.config;
  const c=result.models[model].coefficients;
  let intercept=c[0].estimate;
  let slope=c[1].estimate;
  if(model===2 && group===1){intercept+=c[2].estimate;slope+=c[3].estimate;}
  let equation=`Predicted ${y} = ${coefficient(intercept)} ${signed(slope)} × ${x}`;
  if(model===2 && group===undefined){
    equation+=` ${signed(c[2].estimate)} × D ${signed(c[3].estimate)} × (${x} × D)`;
  }
  const controls=model===0?[]:c.slice(model===2?4:2);
  for(const term of controls){
    const name=result.config.control_type==='categorical'?`I(${control} = ${term.term.split('=').slice(1).join('=')})`:control;
    equation+=` ${signed(term.estimate)} × ${name}`;
  }
  return equation;
}

function unit(name:string,axis:'x'|'y'){
  if(name==='SLEPTIM1')return axis==='x'?'one additional hour of reported sleep per 24 hours':'hours of reported sleep per 24 hours';
  if(name==='MENTHLTH')return axis==='x'?'one additional poor mental health day in the past 30 days':'poor mental health days per 30 days';
  if(name==='PHYSHLTH')return axis==='x'?'one additional poor physical health day in the past 30 days':'poor physical health days per 30 days';
  if(name==='_AGE80')return axis==='x'?'a one-year increase in capped, imputed age':'years of capped, imputed age';
  return axis==='x'?`a one-unit increase in ${name}`:`units of ${name}`;
}
function association(result:NarrativeResult,slope:number){
  if(slope===0)return `${unit(result.config.x,'x')} is associated with no predicted difference in ${unit(result.config.y,'y')}, on average`;
  return `${unit(result.config.x,'x')} is associated with ${coefficient(Math.abs(slope))} ${slope<0?'fewer':'more'} ${unit(result.config.y,'y')}, on average`;
}
function inference(c:Estimate){
  const interval=`95% CI [${coefficient(c.low)}, ${coefficient(c.high)}]; p ${c.p<.001?'< 0.001':`= ${c.p.toFixed(3)}`}`;
  return `${interval}. At α = 0.05, ${c.p<.05?'reject':'do not reject'} a zero slope.`;
}
function change(before:number,after:number){
  const delta=after-before;
  const signFlip=before*after<0;
  const magnitude=Math.abs(after)-Math.abs(before);
  const percent=Math.abs(before)>1e-10?` (${(100*Math.abs(magnitude)/Math.abs(before)).toFixed(1)}% ${magnitude<0?'smaller':'larger'} in magnitude)`:'';
  return `The slope moves from ${coefficient(before)} to ${coefficient(after)}, a signed change of ${delta<0?'−':'+'}${coefficient(Math.abs(delta))}${signFlip?'; its sign reverses':Math.abs(magnitude)<1e-10?'; its magnitude is unchanged':`, moving ${magnitude<0?'toward':'away from'} zero${percent}`}.`;
}

export function buildNarrative(result:NarrativeResult){
  const {x,y,z,control,control_type}=result.config;
  const [m1,m2,m3]=result.models;
  const first=m1.coefficients[1],second=m2.coefficients[1],third=m3.coefficients;
  const controlHeld=control_type==='categorical'?`holding the ${control} category fixed`:`holding ${control} constant`;
  const sections=[
    {title:'Model 1 · the unadjusted relationship',equations:[fittedEquation(result,0)],paragraphs:[
      `Without adjusting for ${control} or moderator groups, ${association(result,first.estimate)}. ${inference(first)}`,
      `The intercept, ${coefficient(m1.coefficients[0].estimate)}, is the predicted ${y} when ${x} = 0. If zero is outside the observed range or has no meaningful interpretation, treat this as a line-fitting parameter.`
    ]},
    {title:'Model 1 → Model 2 · adding the control',equations:[fittedEquation(result,1)],paragraphs:[
      `After ${controlHeld}, ${association(result,second.estimate)}. ${inference(second)}`,
      `${change(first.estimate,second.estimate)} Both models use the same ${m2.n.toLocaleString()} respondents, so this movement reflects the changed specification rather than a changed sample.`,
      `Adding ${control} adjusts for its association with X and Y in this model. The coefficient movement alone does not prove confounding or causation, and is not a formal test that the two coefficients differ.`,
      ...(control_type==='categorical'?[`Each I(${control} = category) equals 1 for that category and 0 otherwise. Its coefficient is the predicted outcome difference from the omitted reference category at the same X. All displayed indicators are zero for that reference category.`]:[
        `The control coefficient is ${coefficient(m2.coefficients[2].estimate)}: at the same ${x}, one additional unit of ${control} is associated with ${coefficient(Math.abs(m2.coefficients[2].estimate))} ${m2.coefficients[2].estimate<0?'fewer':'more'} ${unit(y,'y')}.`
      ])
    ]},
    {title:'Model 2 → Model 3 · allowing different group slopes',equations:[fittedEquation(result,2),`D = 0: ${fittedEquation(result,2,0)}`,`D = 1: ${fittedEquation(result,2,1)}`],paragraphs:[
      `D = 1 contains codes ${result.config.one_values.join(', ')} of ${z}; D = 0 contains the remaining valid categories. Model 2 imposes a common adjusted slope of ${coefficient(second.estimate)}. Model 3 adds a group intercept difference and an X × D interaction.`,
      `For D = 0, ${association(result,result.slopes[0].estimate)}, ${controlHeld}. ${change(second.estimate,result.slopes[0].estimate)} The coefficient on X now describes D = 0, so it no longer has the same population-wide interpretation as Model 2.`,
      `For D = 1, the slope is ${coefficient(third[1].estimate)} ${signed(third[3].estimate)} = ${coefficient(result.slopes[1].estimate)}. In this group, ${association(result,result.slopes[1].estimate)}, ${controlHeld}. ${change(second.estimate,result.slopes[1].estimate)}`,
      `The interaction coefficient, ${coefficient(third[3].estimate)}, is the D = 1 slope minus the D = 0 slope. Its 95% CI is [${coefficient(third[3].low)}, ${coefficient(third[3].high)}], with p ${third[3].p<.001?'< 0.001':`= ${third[3].p.toFixed(3)}`}. At α = 0.05, ${third[3].p<.05?'reject equal slopes; the model provides evidence that the association differs across groups':'do not reject equal slopes; this is insufficient evidence of a difference, rather than proof of equal slopes'}.`,
      `The D coefficient, ${coefficient(third[2].estimate)}, is the predicted D = 1 minus D = 0 outcome difference when ${x} = 0, ${controlHeld}. At a different X, this group difference is ${coefficient(third[2].estimate)} ${signed(third[3].estimate)} × X. Adding an interaction changes the meaning of the main X and D coefficients.`
    ]}
  ];
  return {sections,note:'Equations show fitted predictions, so no residual/error term is added. Coefficients are rounded for display; calculations use their full precision. Estimates describe observational associations. Confidence intervals and p-values use the selected standard-error method and do not incorporate the BRFSS survey design.'};
}

export function narrativeMarkdown(result:NarrativeResult){
  const {sections,note}=buildNarrative(result);
  return `# Regression experiment: ${result.config.y} vs ${result.config.x}\n\nN = ${result.models[0].n}; control: ${result.config.control}; moderator: ${result.config.z}; standard errors: ${result.config.se}\n\n`+sections.map(s=>`## ${s.title}\n\n${s.equations.map(e=>'```text\n'+e+'\n```').join('\n\n')}\n\n${s.paragraphs.map(emphasizeMarkdown).join('\n\n')}`).join('\n\n')+`\n\n${note}\n`;
}
