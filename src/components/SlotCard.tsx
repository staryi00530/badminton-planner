import { C, COURT_BG, COURT_COLORS, FONT } from '../constants';
import type { CSSProperties } from 'react';
import type { Court, Player, SlotResult } from '../algorithm/types';
import type { EditLayout, ScoresMap } from '../types';
import type { GameRef } from '../utils/liveQueue';

type Position = { type: 'court'; ci: number; idx: number } | { type: 'sit'; idx: number };

interface SlotCardProps {
  slot: SlotResult;
  scores: ScoresMap;
  editing: boolean;
  editLayout: EditLayout | null;
  isAdmin: boolean;
  slotTime: (slot: number) => string;
  startSlotEdit: (slot: number) => void;
  applySlotEdit: () => void;
  applySlotEditOnly: () => void;
  cancelSlotEdit: () => void;
  assignToPosition: (position: Position, name: string) => void;
  editOptions?: Player[];
  updateScore: (slot: number, court: number, a: string, b: string, teamA: string[], teamB: string[]) => void;
  liveGames?: GameRef[];
  completedGames?: GameRef[];
  onToggleLive?: (slot: number, court: number) => void;
  onAdjustCourts?: (slot: number, delta: number) => void;
  blockedPlayerNames?: Set<string>;
  canShowReady: boolean;
  visibleCourtIndexes?: number[];
  compactGameView?: boolean;
}

export default function SlotCard({
  slot,
  scores,
  editing,
  editLayout,
  isAdmin,
  slotTime,
  startSlotEdit,
  applySlotEdit,
  applySlotEditOnly,
  cancelSlotEdit,
  assignToPosition,
  editOptions = [],
  updateScore,
  liveGames,
  completedGames = [],
  onToggleLive,
  onAdjustCourts,
  blockedPlayerNames,
  canShowReady,
  visibleCourtIndexes,
  compactGameView = false,
}: SlotCardProps) {
  const stepBtnStyle = { background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, color: C.textMuted, fontSize: 12, fontWeight: 700, fontFamily: FONT, width: 20, height: 20, lineHeight: 1, cursor: 'pointer' };
  const visibleCourts = (visibleCourtIndexes ?? slot.courts.map((_, ci) => ci))
    .map(ci => ({ ci, court: slot.courts[ci] }))
    .filter((item): item is { ci: number; court: Court } => item.court != null);
  const isSingleCourtView = visibleCourts.length === 1 && visibleCourtIndexes;
  const headerCourt = isSingleCourtView ? visibleCourts[0]?.court ?? null : null;
  const slotPicker = (pos: Position, currentName: string, genderByName: Map<string, string>, allNames: string[]) => {
    const g = genderByName.get(currentName);
    const color = g === 'F' ? C.pink : C.accent;
    return (
      <select
        value={currentName}
        onChange={e => assignToPosition(pos, e.target.value)}
        style={{ background: C.bg, color, border: `1.5px solid ${g === 'F' ? C.pinkDim : C.accentDim}`, borderRadius: 8, padding: '8px 10px', fontSize: 14, fontWeight: 600, fontFamily: FONT, minHeight: 38, minWidth: 92 }}
      >
        {allNames.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    );
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${editing ? C.amber : C.border}`, borderRadius: 10, padding: '14px 16px', boxShadow: C.shadow }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: C.textDim, fontWeight: 600 }}>
          SLOT {slot.slot}{headerCourt ? ` · COURT ${headerCourt.court}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>{slotTime(slot.slot)}</span>
          {onAdjustCourts && !editing && !isSingleCourtView && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <button onClick={() => onAdjustCourts(slot.slot, -1)} disabled={slot.courts.length <= 1} title="Remove a court, starting this slot through the rest of the session" style={{ ...stepBtnStyle, opacity: slot.courts.length <= 1 ? 0.35 : 1 }}>
                −
              </button>
              <span style={{ fontSize: 11, color: C.textMuted, minWidth: 16, textAlign: 'center' }}>{slot.courts.length}C</span>
              <button onClick={() => onAdjustCourts(slot.slot, 1)} disabled={slot.courts.length >= 4} title="Add a court, starting this slot through the rest of the session" style={{ ...stepBtnStyle, opacity: slot.courts.length >= 4 ? 0.35 : 1 }}>
                +
              </button>
            </div>
          )}
          {editing ? (
            <span style={{ fontSize: 11, color: C.amber, fontWeight: 700, textTransform: 'uppercase' }}>Editing</span>
          ) : (
            <button onClick={() => startSlotEdit(slot.slot)} title="Edit who plays in this slot" style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, padding: '6px 10px', lineHeight: 1, cursor: 'pointer', minHeight: 36, minWidth: 36 }}>
              ✏️
            </button>
          )}
        </div>
      </div>

      {editing && editLayout && (() => {
        const genderByName = new Map<string, string>([
          ...editOptions.map(p => [p.name, p.gender] as [string, string]),
          ...slot.courts.flatMap(c => [...c.teamA, ...c.teamB]).map(p => [p.name, p.gender] as [string, string]),
          ...slot.sitting.map(p => [p.name, p.gender] as [string, string]),
        ]);
        const allNames = [...new Set([...editLayout.courts.flat(), ...editLayout.sitting, ...editOptions.map(p => p.name)])]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontWeight: 600 }}>Tap any name to swap with another player</p>
            {(visibleCourtIndexes ?? editLayout.courts.map((_, ci) => ci)).map((ci) => {
              const court = editLayout.courts[ci];
              if (!court) return null;
              return (
              <div key={ci} style={{ background: COURT_BG[ci], borderLeft: `3px solid ${COURT_COLORS[ci]}`, borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                {(editLayout.courts.length > 1 || isSingleCourtView) && <div style={{ fontSize: 10, color: COURT_COLORS[ci], fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>Court {ci + 1}</div>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {slotPicker({ type: 'court', ci, idx: 0 }, court[0] ?? '', genderByName, allNames)}
                    {slotPicker({ type: 'court', ci, idx: 1 }, court[1] ?? '', genderByName, allNames)}
                  </div>
                  <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700 }}>VS</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {slotPicker({ type: 'court', ci, idx: 2 }, court[2] ?? '', genderByName, allNames)}
                    {slotPicker({ type: 'court', ci, idx: 3 }, court[3] ?? '', genderByName, allNames)}
                  </div>
                </div>
              </div>
              );
            })}
            {editLayout.sitting.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: C.textMuted }}>Sit:</span>
                {editLayout.sitting.map((name, si) => (
                  <span key={si}>{slotPicker({ type: 'sit', idx: si }, name, genderByName, allNames)}</span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <button onClick={applySlotEditOnly} title="Swap players in this game only — every other slot stays exactly as already generated/shared" style={{ background: C.card, color: C.text, border: `1px solid ${C.accentDim}`, borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, fontFamily: FONT, minHeight: 30 }}>
                This game only
              </button>
              <button onClick={applySlotEdit} title="Apply and regenerate every later slot for fairness" style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 700, fontFamily: FONT, minHeight: 30 }}>
                Apply &amp; regenerate after
              </button>
              <button onClick={cancelSlotEdit} style={{ background: C.card, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 11, fontFamily: FONT, minHeight: 30 }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {!editing && visibleCourts.map(({ court, ci }, visibleIdx) => {
        const isLive = liveGames?.some(lg => lg.slot === slot.slot && lg.court === ci) ?? false;
        const isCompleted = completedGames?.some(game => game.slot === slot.slot && game.court === ci) ?? false;
        const hasBlockedPlayer = blockedPlayerNames && blockedPlayerNames.size > 0 &&
          [...court.teamA, ...court.teamB].some(p => blockedPlayerNames.has(p.name));
        // "Ready" = every player on this court is currently free (not stuck in a live
        // game elsewhere) — only meaningful when something else actually IS live, and
        // gated to canShowReady (the slot right after fromSlot) since fromSlot itself
        // is ambiguous — its courts could be live, already Done, or about to start.
        const isWaiting = !isLive && !isCompleted && hasBlockedPlayer;
        const isReady = canShowReady && !isLive && !isCompleted && blockedPlayerNames && blockedPlayerNames.size > 0 && !hasBlockedPlayer;
        const actionLabel = isLive ? '✓ Done' : isCompleted ? 'Restart' : isWaiting ? 'Waiting' : 'Start';
        const actionColor = isLive ? '#fff' : isWaiting ? C.amber : isCompleted ? C.green : C.accent;
        const actionBorder = isLive ? '#ef4444' : isWaiting ? C.amber : isCompleted ? C.green : C.accentDim;
        const actionTitle = isLive ? 'Mark game as finished' : isWaiting ? 'Waiting for players still on court' : isCompleted ? 'Restart this game' : 'Start this game';
        return (
        <div key={ci} style={{ background: COURT_BG[ci], borderLeft: `3px solid ${isLive ? '#ef4444' : isCompleted ? C.green : isWaiting ? C.amber : COURT_COLORS[ci]}`, borderRadius: 6, padding: '8px 10px', marginBottom: visibleIdx < visibleCourts.length - 1 ? 6 : 0 }}>
          {(slot.courts.length > 1 || isSingleCourtView || slot.repeatedCourts?.includes(ci) || onToggleLive || isReady || isWaiting) && (
            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              {(slot.courts.length > 1 || isSingleCourtView) && <span style={{ color: isLive ? '#ef4444' : isCompleted ? C.green : isWaiting ? C.amber : COURT_COLORS[ci] }}>Court {court.court}</span>}
              {slot.repeatedCourts?.includes(ci) && <span style={{ color: C.amber }}>⚠ repeat group</span>}
              {isLive && <span style={{ color: '#ef4444' }}>● LIVE</span>}
              {isCompleted && !isLive && <span style={{ color: C.green }}>✓ DONE</span>}
              {isWaiting && <span style={{ color: C.amber }}>⏳ WAITING</span>}
              {isReady && <span style={{ color: C.green }} title="Everyone on this court is free to start">✓ Ready</span>}
              <div style={{ flex: 1 }} />
              {onToggleLive && (
                <button onClick={() => onToggleLive(slot.slot, ci)} disabled={isWaiting} title={actionTitle} style={{ background: isLive ? '#ef4444' : 'none', color: actionColor, border: `1px solid ${actionBorder}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, fontFamily: FONT, cursor: isWaiting ? 'not-allowed' : 'pointer', lineHeight: 1.4, opacity: isWaiting ? 0.75 : 1 }}>
                  {actionLabel}
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ textAlign: 'center' }}>
              {court.teamA.map((p, pi) => {
                const blocked = !isLive && blockedPlayerNames?.has(p.name);
                return (
                  <span key={pi} style={{ color: blocked ? C.amber : (p.gender === 'F' ? C.pink : C.accent), fontSize: 15, fontWeight: 600 }}>
                    {p.name}{blocked ? ' ⏳' : ''}{pi === 0 ? ' · ' : ''}
                  </span>
                );
              })}
            </div>
            <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700 }}>VS</span>
            <div style={{ textAlign: 'center' }}>
              {court.teamB.map((p, pi) => {
                const blocked = !isLive && blockedPlayerNames?.has(p.name);
                return (
                  <span key={pi} style={{ color: blocked ? C.amber : (p.gender === 'F' ? C.pink : C.accent), fontSize: 15, fontWeight: 600 }}>
                    {p.name}{blocked ? ' ⏳' : ''}{pi === 0 ? ' · ' : ''}
                  </span>
                );
              })}
            </div>
          </div>

          {(() => {
            const key = `s${slot.slot}c${ci}`;
            const sc = scores[key] ?? { a: '', b: '', applied: false, teamA: [], teamB: [] };
            const tA = court.teamA.map(p => p.name);
            const tB = court.teamB.map(p => p.name);
            const inputStyle = (active: boolean): CSSProperties => ({
              width: 38,
              background: C.bg,
              border: `1px solid ${active ? C.green : C.border}`,
              borderRadius: 4,
              padding: '4px 0',
              color: C.text,
              fontSize: 13,
              fontFamily: FONT,
              textAlign: 'center',
              outline: 'none',
            });
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <input type="number" min={0} max={30} value={sc.a} onChange={e => updateScore(slot.slot, ci, e.target.value, sc.b, tA, tB)} placeholder="–" disabled={!isAdmin} title={!isAdmin ? 'Unlock admin to enter scores' : undefined} style={{ ...inputStyle(sc.applied), opacity: isAdmin ? 1 : 0.4 }} />
                <span style={{ color: C.textMuted, fontSize: 12, fontWeight: 600 }}>–</span>
                <input type="number" min={0} max={30} value={sc.b} onChange={e => updateScore(slot.slot, ci, sc.a, e.target.value, tA, tB)} placeholder="–" disabled={!isAdmin} title={!isAdmin ? 'Unlock admin to enter scores' : undefined} style={{ ...inputStyle(sc.applied), opacity: isAdmin ? 1 : 0.4 }} />
                {sc.applied && <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{parseInt(sc.a) > parseInt(sc.b) ? tA.join(' & ') : tB.join(' & ')} won</span>}
              </div>
            );
          })()}
        </div>
        );
      })}

      {slot.courts.length === 0 && <div style={{ textAlign: 'center', padding: 10, color: C.textMuted, fontSize: 12 }}>Not enough players</div>}

      {!editing && !compactGameView && slot.sitting && slot.sitting.length > 0 && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Sit: {slot.sitting.map(p => p.name).join(', ')}</span>
        </div>
      )}

      {!compactGameView && <div className="player-tracker" style={{ borderTop: `1px solid ${C.border}` }}>
        {slot.playerState.filter(ps => ps.available).map((ps, pi) => (
          <div key={pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: ps.playing ? (ps.gender === 'F' ? C.pink : C.accent) : C.textMuted }}>{ps.name}</span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, background: ps.playing ? 'rgba(125,211,252,0.15)' : 'rgba(100,116,139,0.15)', color: ps.playing ? C.green : C.textMuted, padding: '2px 6px', borderRadius: 4 }}>
                {ps.playing ? `ON ${ps.conPlayed}` : `OFF ${ps.conRested}`}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.text, background: 'rgba(226,232,240,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                {ps.total}
              </span>
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
