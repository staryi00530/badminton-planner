import { useState } from 'react';
import { C } from '../constants';
import type { scoreGameQuality } from '../utils/gameQuality';

export type GameQualityAssessment = ReturnType<typeof scoreGameQuality>;
const labels = { gender: 'Format match', levels: 'Level balance', partners: 'Repeated partners', opponents: 'Repeated opponents', preferred: 'Preferred pairings' };
const signed = (value: number) => value > 0 ? `+${value}` : `${value}`;

export default function GameQualityBreakdown({ quality }: { quality: GameQualityAssessment }) {
  const [expanded, setExpanded] = useState(false);
  return <details aria-label="Game quality breakdown" onToggle={event => setExpanded(event.currentTarget.open)} style={{ marginBottom: 10, fontSize: 12 }}>
    <summary style={{ cursor: 'pointer', color: C.accent, minHeight: 36, display: 'list-item', paddingTop: 6, boxSizing: 'border-box' }}>Point breakdown</summary>
    {expanded && <div style={{ padding: '6px 0 10px', color: C.textDim }}>
      <p style={{ margin: '0 0 8px' }}>{quality.format}{quality.formatCompromise ? ` · ${quality.formatCompromise}` : ''}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead><tr><th scope="col">Factor</th><th scope="col">Calculation</th><th scope="col" style={{ textAlign: 'right' }}>Points</th></tr></thead>
        <tbody>{(Object.keys(labels) as Array<keyof typeof labels>).map(key => {
          const item = quality.breakdown[key];
          return <tr key={key}><th scope="row" style={{ fontWeight: 400, padding: '6px 4px 6px 0' }}>{labels[key]}</th><td>{item.raw} × {item.weight}</td><td style={{ textAlign: 'right', color: item.points < 0 ? C.amber : item.points > 0 ? C.green : C.textDim }}>{signed(item.points)}</td></tr>;
        })}</tbody>
      </table>
      <p style={{ color: C.text, fontWeight: 700 }}>Total: {quality.score} points</p>
      <p>Waiting priority is separate and adds 0 matchup points.</p>
      <p>Live scores use played history. Upcoming scores also include earlier projected games.</p>
      {quality.assumedLevels.length > 0 && <p>Level 3 assumed for: {quality.assumedLevels.join(', ')}.</p>}
    </div>}
  </details>;
}
