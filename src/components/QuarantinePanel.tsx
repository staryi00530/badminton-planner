import { C, FONT } from '../constants';
import type { Player } from '../algorithm/types';

export default function QuarantinePanel({ players, togglePlayerQuarantined }: {
  players: Player[];
  togglePlayerQuarantined?: (index: number) => void;
}) {
  const quarantined = players.map((player, index) => ({ player, index })).filter(({ player }) => player.quarantined);
  return <section aria-label="Quarantine" style={{ border: `1px dashed ${C.amber}`, background: C.card, borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 13, color: C.amber }}>Quarantine ({quarantined.length})</h3>
    <p style={{ margin: '0 0 10px', fontSize: 12, color: C.textDim }}>Unavailable until returned. Excluded from upcoming games and substitutions; current games can finish.</p>
    {quarantined.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.textMuted }}>No players in quarantine.</p> :
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{quarantined.map(({ player, index }) =>
        <div key={player.name} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', maxWidth: '100%', overflowWrap: 'anywhere' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: player.gender === 'F' ? C.pink : C.text }}>{player.name}</span>
          {togglePlayerQuarantined && <button aria-label={`Return ${player.name} to available`} onClick={() => togglePlayerQuarantined(index)} style={{ background: C.bg, color: C.accent, border: `1px solid ${C.accentDim}`, borderRadius: 4, padding: '5px 8px', fontSize: 11, fontFamily: FONT }}>Return to available</button>}
        </div>)}
      </div>}
  </section>;
}
