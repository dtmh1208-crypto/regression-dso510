import { buildNarrative, statisticParts, type NarrativeResult } from './interpretation';

export default function ExperimentNarrative({result}:{result:NarrativeResult}){
  const narrative=buildNarrative(result);
  return <section id="equations-interpretation" className="panel experiment-narrative results-anchor">
    <div className="section-heading"><div><span className="eyebrow">EQUATIONS & INTERPRETATION</span><h2>Tell the story across the three models</h2></div></div>
    {narrative.sections.map((section,sectionIndex)=><article className="narrative-section" key={section.title}>
      <h3>{section.title}</h3>
      <div className="fitted-equations">{section.equations.map(equation=><code key={equation}>{equation}</code>)}</div>
      <div className="interpretation-points">{section.paragraphs.map((text,i)=><div className={'interpretation-point '+(i===0?'main-finding':'')} key={i}>
        <span className="interpretation-label">{[
          ['Main slope','Intercept'],
          ['Adjusted slope','Change in slope','What the change means','Control coefficient'],
          ['Group definition','D = 0 slope','D = 1 slope','Interaction test','Group difference'],
        ][sectionIndex][i]}</span>
        <p>{statisticParts(text).map((part,index)=>index%2?<strong className="statistic" key={index}>{part}</strong>:part)}</p>
      </div>)}</div>
    </article>)}
    <p className="tiny"><em>{narrative.note}</em></p>
  </section>;
}
