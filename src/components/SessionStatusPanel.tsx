import { C, FONT } from '../constants';
import type { Player } from '../algorithm/types';
import type { GameRef } from '../utils/liveQueue';
import type { PlannerResult, StaggerMode } from '../types';
import { applyAvailability } from '../utils/availability';

export function SessionSummary({ players, result, fromSlot, staggerMode, liveGames, completedGames }: {
  players: Player[];
  result: PlannerResult;
  fromSlot: number;
  staggerMode: StaggerMode;
  liveGames: GameRef[];
  completedGames: GameRef[];
}) {
  const onCourt = new Set(liveGames.flatMap(game => {
    const court = result.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
    return game.players ?? (court ? [...court.teamA, ...court.teamB].map(player => player.name) : []);
  }));
  const availablePlayers = applyAvailability(players, { staggerMode, totalSlots: Math.max(0, ...result.schedule.map(slot => slot.slot)) });
  const waiting = availablePlayers.filter(player => !onCourt.has(player.name) &&
    player.availFrom <= fromSlot - 1 && player.availTo >= fromSlot - 1).length;
  return <section aria-label="Session summary" style={{ marginBottom: 16 }}>
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, margin: 0 }}>
      {[
        ['Active courts', liveGames.length], ['Players on court', onCourt.size],
        ['Waiting players', waiting], ['Completed games', completedGames.length],
      ].map(([label, value]) => <div key={label}>
        <dt style={{ fontSize: 12, color: C.textDim }}>{label}</dt>
        <dd style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{value}</dd>
      </div>)}
    </dl>
  </section>;
}

interface SessionStatusPanelProps {
  players: Player[];
  fromSlot: number;
  totalSlots: number;
  liveGames?: GameRef[];
  completedGames?: GameRef[];
  suspendedPlayerNames?: string[];
  staggerMode: 'none' | 'group' | 'custom';
  setPlayerBack: (index: number) => void;
  setPlayerJoining: (index: number) => void;
  setPlayerLeaving: (index: number) => void;
  togglePlayerSuspended?: (index: number) => void;
}

export default function SessionStatusPanel({
  players,
  fromSlot,
  totalSlots,
  liveGames = [],
  completedGames = [],
  suspendedPlayerNames = [],
  staggerMode,
  setPlayerBack,
  setPlayerJoining,
  setPlayerLeaving,
  togglePlayerSuspended,
}: SessionStatusPanelProps) {
  const suspendedSet = new Set(suspendedPlayerNames);
  const sessionComplete = fromSlot > totalSlots && liveGames.length === 0;
  const nextSlotIdx = fromSlot - 1;
  const offCount = players.filter(player => {
    const departed = player.leavesAt != null && player.leavesAt < nextSlotIdx;
    const notArrived = staggerMode === 'custom' && player.availFrom != null && player.availFrom > nextSlotIdx;
    return departed || notArrived;
  }).length;
  const onCount = players.length - offCount;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: C.textDim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        {sessionComplete ? `Session Status · complete · ${totalSlots} done` : `Session Status · next: ${Math.min(fromSlot, totalSlots)}${liveGames.length > 0 ? ` · ${liveGames.length} live` : ` · ${fromSlot - 1} done`}`}
      </div>
      <div role="status" style={{ color: C.textDim, fontSize: 12, marginBottom: 10 }}>
        Available: <strong style={{ color: C.green }}>{onCount}</strong> · Unavailable: <strong style={{ color: C.textMuted }}>{offCount}</strong> · Active courts: <strong style={{ color: C.accent }}>{liveGames.length}</strong> · Completed games: <strong style={{ color: C.text }}>{completedGames.length}</strong>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {players.map((p, idx) => {
          // 0-based index of the next upcoming slot.
          const departed = p.leavesAt != null && p.leavesAt < nextSlotIdx;
          const notArrived = staggerMode === 'custom' && p.availFrom != null && p.availFrom > nextSlotIdx;
          const leavingScheduled = p.leavesAt != null && !departed;
          const isHere = !departed && !notArrived;
          const isSuspended = suspendedSet.has(p.name);
          return (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 4, background: isSuspended ? 'rgba(245,158,11,0.10)' : (departed || notArrived) ? 'rgba(100,116,139,0.06)' : 'rgba(125,211,252,0.06)', border: `1px solid ${isSuspended ? C.amber + '88' : (departed || notArrived) ? C.border : C.accentDim + '55'}`, borderRadius: 6, padding: '3px 8px', opacity: (departed || notArrived) ? 0.6 : 1 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: p.gender === 'F' ? C.pink : (isHere ? C.text : C.textMuted) }}>{p.name}</span>
              <span style={{ fontSize: 10, color: C.textMuted }}>{departed ? 'Left' : notArrived ? `Arrives slot ${(p.availFrom ?? 0) + 1}` : leavingScheduled ? `Leaving after slot ${(p.leavesAt ?? 0) + 1}` : 'Available'}</span>
              {isHere && !leavingScheduled && togglePlayerSuspended && (
                <button onClick={() => togglePlayerSuspended(idx)} title={isSuspended ? 'Undo skip-next for this player' : 'Skip this player for the next generated game only'} style={{ background: isSuspended ? C.amber : 'none', border: `1px solid ${isSuspended ? C.amber : C.border}`, color: isSuspended ? C.bg : C.textMuted, fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}>
                  {isSuspended ? 'Skipping next' : 'Skip next'}
                </button>
              )}
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
