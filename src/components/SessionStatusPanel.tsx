// @ts-nocheck
import { C, FONT } from '../constants';

export default function SessionStatusPanel({
  players,
  fromSlot,
  totalSlots,
  liveGames = [],
  staggerMode,
  setPlayerBack,
  setPlayerJoining,
  setPlayerLeaving,
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: C.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        Session Status · next: {Math.min(fromSlot, totalSlots)}{liveGames.length > 0 ? ` · ${liveGames.length} live` : ` · ${fromSlot - 1} done`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {players.map((p, idx) => {
          const nextSlotIdx = fromSlot - 1; // 0-based index of next upcoming slot
          const departed = p.leavesAt != null && p.leavesAt < nextSlotIdx;
          const notArrived = staggerMode === 'custom' && p.availFrom != null && p.availFrom > nextSlotIdx;
          const leavingScheduled = p.leavesAt != null && !departed;
          const isHere = !departed && !notArrived;
          return (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 4, background: (departed || notArrived) ? 'rgba(100,116,139,0.06)' : 'rgba(125,211,252,0.06)', border: `1px solid ${(departed || notArrived) ? C.border : C.accentDim + '55'}`, borderRadius: 6, padding: '3px 8px', opacity: (departed || notArrived) ? 0.6 : 1 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: p.gender === 'F' ? C.pink : (isHere ? C.text : C.textMuted) }}>{p.name}</span>
              {(departed || leavingScheduled) && (
                <button onClick={() => setPlayerBack(idx)} title="Restore player to session" style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, padding: '0 2px', cursor: 'pointer', fontFamily: FONT, lineHeight: 1 }}>↩</button>
              )}
              {notArrived && (
                <button onClick={() => setPlayerJoining(idx)} title="Player is here — add to upcoming round" style={{ background: 'none', border: `1px solid ${C.accentDim}`, color: C.accent, fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}>Here now</button>
              )}
              {isHere && !leavingScheduled && (
                <button onClick={() => setPlayerLeaving(idx)} title="Player is done for today" style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, padding: '0 2px', cursor: 'pointer', fontFamily: FONT, lineHeight: 1 }}>↗</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
