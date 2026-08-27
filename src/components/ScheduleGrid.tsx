import type { RefObject } from 'react';
import type { Court, Player, SlotResult } from '../algorithm/types';
import { C } from '../constants';
import { gameMatches, isSlotCompleted } from '../utils/liveQueue';
import type { GameRef } from '../utils/liveQueue';
import type { EditLayout, PlannerResult, ScoresMap } from '../types';
import SlotCard from './SlotCard';

interface ScheduleGridProps {
  result: PlannerResult;
  players: Player[];
  scores: ScoresMap;
  editingSlot: number | null;
  editLayout: EditLayout | null;
  isAdmin: boolean;
  scheduleRef: RefObject<HTMLDivElement>;
  minGames: number;
  maxGames: number;
  slotTime: (slot: number) => string;
  startSlotEdit: (slot: number) => void;
  applySlotEdit: () => void;
  applySlotEditOnly: () => void;
  cancelSlotEdit: () => void;
  assignToPosition: (position: { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number }, name: string) => void;
  updateScore: (slot: number, court: number, a: string, b: string, teamA: string[], teamB: string[]) => void;
  liveGames?: GameRef[];
  completedGames?: GameRef[];
  onToggleLive?: (slot: number, court: number) => void;
  onAdjustCourts?: (slot: number, delta: number) => void;
  blockedPlayerNames?: Set<string>;
  fromSlot: number;
}

export default function ScheduleGrid({
  result,
  players,
  scores,
  editingSlot,
  editLayout,
  isAdmin,
  scheduleRef,
  minGames,
  maxGames,
  slotTime,
  startSlotEdit,
  applySlotEdit,
  applySlotEditOnly,
  cancelSlotEdit,
  assignToPosition,
  updateScore,
  liveGames,
  completedGames = [],
  onToggleLive,
  onAdjustCourts,
  blockedPlayerNames,
  fromSlot,
}: ScheduleGridProps) {
  const courtHasBlockedPlayer = (court: Court) => blockedPlayerNames?.size > 0 &&
    [...court.teamA, ...court.teamB].some(p => blockedPlayerNames.has(p.name));
  const isCourtCompleted = (slot: SlotResult, ci: number) => completedGames.some(game => gameMatches(game, slot.slot, ci));
  const gameKey = (slotNum, courtIdx) => `${slotNum}:${courtIdx}`;
  const pastSlots = result.schedule.filter(slot => isSlotCompleted(slot, completedGames));
  const firstIncomplete = result.schedule.find(slot => !isSlotCompleted(slot, completedGames));
  const liveGameRefs = (liveGames ?? [])
    .map(game => {
      const slot = result.schedule.find(s => s.slot === game.slot);
      return slot?.courts[game.court] ? { slot, court: game.court } : null;
    })
    .filter((ref): ref is { slot: SlotResult; court: number } => ref !== null)
    .sort((a, b) => a.slot.slot - b.slot.slot || a.court - b.court);
  const fallbackCurrentRefs = liveGameRefs.length > 0 || !firstIncomplete
    ? []
    : firstIncomplete.courts
      .map((_, ci) => ({ slot: firstIncomplete, court: ci }))
      .filter(ref => !isCourtCompleted(ref.slot, ref.court));
  const currentGameRefs = liveGameRefs.length > 0 ? liveGameRefs : fallbackCurrentRefs;
  const currentGameKeys = new Set(currentGameRefs.map(ref => gameKey(ref.slot.slot, ref.court)));
  const queueStartSlot = firstIncomplete?.slot ?? fromSlot;
  const upcomingGameRefs = result.schedule
    .flatMap(slot => slot.courts.map((_, ci) => ({ slot, court: ci })))
    .filter(ref =>
      ref.slot.slot >= queueStartSlot &&
      !isCourtCompleted(ref.slot, ref.court) &&
      !currentGameKeys.has(gameKey(ref.slot.slot, ref.court))
    );
  const nextFutureSlot = upcomingGameRefs[0]?.slot.slot;
  const nextFutureGames = nextFutureSlot == null
    ? []
    : upcomingGameRefs.filter(ref => ref.slot.slot === nextFutureSlot);
  const foldedFutureGames = nextFutureSlot == null
    ? []
    : upcomingGameRefs.filter(ref => ref.slot.slot !== nextFutureSlot);
  const courtCount = Math.max(0, ...result.schedule.map(slot => slot.courts.length));
  const courtStatuses = Array.from({ length: courtCount }, (_, ci) => {
    const liveGame = liveGames
      ?.filter(game => game.court === ci)
      .sort((a, b) => a.slot - b.slot)[0];
    if (liveGame) return { court: ci + 1, label: 'Live', slot: liveGame.slot, color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };

    const nextCourt = result.schedule.find(slot => slot.courts[ci] && !isCourtCompleted(slot, ci));
    if (!nextCourt) return { court: ci + 1, label: 'Done', slot: null, color: C.green, bg: 'rgba(34,197,94,0.12)' };

    const waiting = courtHasBlockedPlayer(nextCourt.courts[ci]);
    return {
      court: ci + 1,
      label: waiting ? 'Waiting' : 'Ready',
      slot: nextCourt.slot,
      color: waiting ? C.amber : C.green,
      bg: waiting ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
    };
  });

  const renderSlot = (slot: SlotResult) => (
    <SlotCard
      key={slot.slot}
      slot={slot}
      scores={scores}
      editing={editingSlot === slot.slot}
      editLayout={editingSlot === slot.slot ? editLayout : null}
      isAdmin={isAdmin}
      slotTime={slotTime}
      startSlotEdit={startSlotEdit}
      applySlotEdit={applySlotEdit}
      applySlotEditOnly={applySlotEditOnly}
      cancelSlotEdit={cancelSlotEdit}
      assignToPosition={assignToPosition}
      editOptions={players}
      updateScore={updateScore}
      liveGames={liveGames}
      completedGames={completedGames}
      onToggleLive={onToggleLive}
      onAdjustCourts={onAdjustCourts}
      blockedPlayerNames={(slot.slot === fromSlot || slot.slot === fromSlot + 1) ? blockedPlayerNames : undefined}
      canShowReady={slot.slot === fromSlot + 1}
    />
  );

  const renderGame = ({ slot, court }: { slot: SlotResult; court: number }) => (
    <SlotCard
      key={`${slot.slot}-${court}`}
      slot={slot}
      scores={scores}
      editing={editingSlot === slot.slot}
      editLayout={editingSlot === slot.slot ? editLayout : null}
      isAdmin={isAdmin}
      slotTime={slotTime}
      startSlotEdit={startSlotEdit}
      applySlotEdit={applySlotEdit}
      applySlotEditOnly={applySlotEditOnly}
      cancelSlotEdit={cancelSlotEdit}
      assignToPosition={assignToPosition}
      editOptions={players}
      updateScore={updateScore}
      liveGames={liveGames}
      completedGames={completedGames}
      onToggleLive={onToggleLive}
      blockedPlayerNames={(slot.slot === fromSlot || slot.slot === fromSlot + 1) ? blockedPlayerNames : undefined}
      canShowReady={slot.slot === fromSlot + 1}
      visibleCourtIndexes={[court]}
      compactGameView={true}
    />
  );

  const sectionTitleStyle = {
    fontSize: 12,
    color: C.textDim,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: '0 0 10px',
  };

  const sectionStyle = { marginBottom: 18 };

  return (
    <div ref={scheduleRef} style={{ background: C.bg, padding: 16, borderRadius: 12 }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>🏸 Badminton Schedule</span>
      </div>

      {courtStatuses.length > 0 && (
        <div role="region" aria-label="Court status" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
          {courtStatuses.map(status => (
            <div key={status.court} style={{ background: status.bg, border: `1px solid ${status.color}55`, borderRadius: 8, padding: '8px 10px', minHeight: 50 }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 800, textTransform: 'uppercase', marginBottom: 3 }}>Court {status.court}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: status.color, fontSize: 13, fontWeight: 800 }}>{status.label}</span>
                {status.slot && <span style={{ color: C.textDim, fontSize: 12, fontWeight: 600 }}>Slot {status.slot}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 20, boxShadow: C.shadow }}>
        <h3 style={{ fontSize: 13, color: C.textDim, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>Games per Player</h3>
        <div className="stats-grid">
          {players.map((p, i) => {
            const g = result.gamesPlayed[i];
            const pct = maxGames > 0 ? (g / maxGames) * 100 : 0;
            return (
              <div key={`${p.name}-${i}`} className="stat-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: p.gender === 'F' ? C.pink : C.accent }}>{p.name}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{g}</span>
                </div>
                <div style={{ height: 5, background: C.border, borderRadius: 2 }}>
                  <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: p.gender === 'F' ? C.pink : C.accent }} />
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 13, color: C.textDim, margin: '12px 0 0', textAlign: 'center' }}>
          Spread: {minGames}–{maxGames} (diff: {maxGames - minGames})
          {maxGames - minGames <= 1 && <span style={{ color: C.green, marginLeft: 8 }}>✓ balanced</span>}
        </p>
      </div>

      {currentGameRefs.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Current game</h3>
          <div className="schedule-grid">
            {currentGameRefs.map(renderGame)}
          </div>
        </section>
      )}

      {nextFutureGames.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Next game</h3>
          <div className="schedule-grid">
            {nextFutureGames.map(renderGame)}
          </div>
        </section>
      )}

      {foldedFutureGames.length > 0 && (
        <details style={{ ...sectionStyle, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <summary style={{ ...sectionTitleStyle, margin: 0, cursor: 'pointer' }}>
            Future games ({foldedFutureGames.length})
          </summary>
          <div className="schedule-grid" style={{ marginTop: 12 }}>
            {foldedFutureGames.map(renderGame)}
          </div>
        </details>
      )}

      {pastSlots.length > 0 && (
        <details style={{ ...sectionStyle, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <summary style={{ ...sectionTitleStyle, margin: 0, cursor: 'pointer' }}>
            Past games ({pastSlots.length})
          </summary>
          <div className="schedule-grid" style={{ marginTop: 12 }}>
            {pastSlots.map(renderSlot)}
          </div>
        </details>
      )}
    </div>
  );
}
