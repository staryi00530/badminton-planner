// @ts-nocheck
import { C } from '../constants';
import SlotCard from './SlotCard';

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
}) {
  const slotHasLiveGame = slotNum => liveGames?.some(lg => lg.slot === slotNum);
  const courtHasBlockedPlayer = court => blockedPlayerNames?.size > 0 &&
    [...court.teamA, ...court.teamB].some(p => blockedPlayerNames.has(p.name));
  const isCourtCompleted = (slot, ci) => completedGames.some(game => game.slot === slot.slot && game.court === ci);
  const isSlotCompleted = slot => slot.courts.length > 0 &&
    slot.courts.every((_, ci) => isCourtCompleted(slot, ci));
  const pastSlots = result.schedule.filter(slot => isSlotCompleted(slot));
  const liveSlots = result.schedule.filter(slot => slotHasLiveGame(slot.slot));
  const currentSlots = liveSlots.length > 0
    ? liveSlots
    : result.schedule.filter(slot => !isSlotCompleted(slot) && slot.slot === Math.min(fromSlot, result.schedule.length));
  const currentSlotNumbers = new Set(currentSlots.map(slot => slot.slot));
  const upcomingSlots = result.schedule.filter(slot =>
    slot.slot >= fromSlot &&
    !isSlotCompleted(slot) &&
    !currentSlotNumbers.has(slot.slot)
  );
  const nextFutureSlots = upcomingSlots.slice(0, 1);
  const foldedFutureSlots = upcomingSlots.slice(1);
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

  const renderSlot = slot => (
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
      updateScore={updateScore}
      liveGames={liveGames}
      completedGames={completedGames}
      onToggleLive={onToggleLive}
      onAdjustCourts={onAdjustCourts}
      blockedPlayerNames={(slot.slot === fromSlot || slot.slot === fromSlot + 1) ? blockedPlayerNames : undefined}
      canShowReady={slot.slot === fromSlot + 1}
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

      {currentSlots.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Current game</h3>
          <div className="schedule-grid">
            {currentSlots.map(renderSlot)}
          </div>
        </section>
      )}

      {nextFutureSlots.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Next game</h3>
          <div className="schedule-grid">
            {nextFutureSlots.map(renderSlot)}
          </div>
        </section>
      )}

      {foldedFutureSlots.length > 0 && (
        <details style={{ ...sectionStyle, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <summary style={{ ...sectionTitleStyle, margin: 0, cursor: 'pointer' }}>
            Future games ({foldedFutureSlots.length})
          </summary>
          <div className="schedule-grid" style={{ marginTop: 12 }}>
            {foldedFutureSlots.map(renderSlot)}
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
