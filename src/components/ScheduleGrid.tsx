import type { RefObject } from 'react';
import type { Player, SlotResult } from '../algorithm/types';
import { C } from '../constants';
import { gameMatches } from '../utils/liveQueue';
import type { GameRef } from '../utils/liveQueue';
import type { EditLayout, PlannerResult, ScoresMap } from '../types';
import type { QueueAdjustmentNotice } from '../hooks/useLiveQueue';
import SlotCard from './SlotCard';

export interface ScheduleGridProps {
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
  liveCapacity?: number;
  queueAdjustment?: QueueAdjustmentNotice | null;
}

export interface ScheduledGame {
  slot: SlotResult;
  court: number;
  displayCourt?: number;
}

export function ScheduleGame({ props, game, sessionActions = false, waitingReason, canStartGame }: {
  props: ScheduleGridProps;
  game: ScheduledGame;
  sessionActions?: boolean;
  waitingReason?: string;
  canStartGame?: boolean;
}) {
  const { slot, court, displayCourt } = game;
  return <SlotCard
    slot={slot}
    scores={props.scores}
    editing={props.editingSlot === slot.slot}
    editLayout={props.editingSlot === slot.slot ? props.editLayout : null}
    isAdmin={props.isAdmin}
    slotTime={props.slotTime}
    startSlotEdit={props.startSlotEdit}
    applySlotEdit={props.applySlotEdit}
    applySlotEditOnly={props.applySlotEditOnly}
    cancelSlotEdit={props.cancelSlotEdit}
    assignToPosition={props.assignToPosition}
    editOptions={props.players}
    updateScore={props.updateScore}
    liveGames={props.liveGames}
    completedGames={props.completedGames}
    onToggleLive={props.onToggleLive}
    blockedPlayerNames={props.blockedPlayerNames}
    canShowReady={sessionActions || slot.slot === props.fromSlot + 1}
    canStartGame={canStartGame ?? (props.liveGames?.length ?? 0) < (props.liveCapacity ?? Infinity)}
    visibleCourtIndexes={[court]}
    compactGameView={true}
    displayCourt={displayCourt}
    sessionActions={sessionActions}
    waitingReason={waitingReason}
  />;
}

export default function ScheduleGrid(props: ScheduleGridProps & { futureGames?: ScheduledGame[] }) {
  const { result, players, completedGames = [], minGames, maxGames } = props;
  const futureGames = props.futureGames ?? result.schedule.flatMap(slot => slot.courts.map((_, court) => ({ slot, court })))
    .filter(game => !completedGames.some(ref => gameMatches(ref, game.slot.slot, game.court)));
  const renderGame = (game: ScheduledGame) => <ScheduleGame key={`${game.slot.slot}:${game.court}`} props={props} game={game} />;
  return <>
    {completedGames.length > 0 && <details style={{ marginBottom: 18 }}>
      <summary style={{ cursor: 'pointer', color: C.textDim }}>Past games played ({completedGames.length})</summary>
      <div className="schedule-grid" style={{ marginTop: 12 }}>
        {completedGames.map(game => {
          const slot = result.schedule.find(item => item.slot === game.slot);
          return slot?.courts[game.court] ? renderGame({ slot, court: game.court, displayCourt: game.displayCourt }) : null;
        })}
      </div>
    </details>}
    {futureGames.length > 0 && <details style={{ marginBottom: 18 }}>
      <summary style={{ cursor: 'pointer', color: C.textDim }}>Future games ({futureGames.length})</summary>
      <div className="schedule-grid" style={{ marginTop: 12 }}>{futureGames.map(renderGame)}</div>
    </details>}
    <details style={{ marginBottom: 18 }}>
      <summary style={{ cursor: 'pointer', color: C.textDim }}>Games per Player</summary>
      <div className="stats-grid" style={{ marginTop: 12 }}>
        {players.map((p, i) => {
          const games = result.gamesPlayed[i] ?? 0;
          return <div key={`${p.name}-${i}`} className="stat-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: p.gender === 'F' ? C.pink : C.accent, overflowWrap: 'anywhere' }}>{p.name}</span>
              <strong>{games}</strong>
            </div>
            <div style={{ height: 5, background: C.border, borderRadius: 2 }}>
              <div style={{ height: '100%', borderRadius: 2, width: `${maxGames > 0 ? games / maxGames * 100 : 0}%`, background: p.gender === 'F' ? C.pink : C.accent }} />
            </div>
          </div>;
        })}
      </div>
      <p style={{ fontSize: 13, color: C.textDim, textAlign: 'center' }}>Spread: {minGames}–{maxGames} (diff: {maxGames - minGames})</p>
    </details>
  </>;
}
