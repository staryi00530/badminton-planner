import { C } from '../constants';
import type { StaggerMode } from '../types';
import { SessionSummary } from './SessionStatusPanel';
import ScheduleGrid, { ScheduleGame, type ScheduledGame, type ScheduleGridProps } from './ScheduleGrid';

interface LiveSessionBoardProps extends ScheduleGridProps {
  staggerMode?: StaggerMode;
}

const key = (slot: number, court: number) => `${slot}:${court}`;

export default function LiveSessionBoard(props: LiveSessionBoardProps) {
  const { result, liveGames = [], completedGames = [], fromSlot, queueAdjustment } = props;
  const allGames = result.schedule.flatMap(slot => slot.courts.map((_, court) => ({ slot, court })));
  const completed = new Set(completedGames.map(game => key(game.slot, game.court)));
  const live = liveGames.flatMap(ref => {
    const slot = result.schedule.find(slot => slot.slot === ref.slot);
    return slot?.courts[ref.court] ? [{ slot, court: ref.court, displayCourt: ref.displayCourt ?? ref.court, ref }] : [];
  });
  const liveKeys = new Set(live.map(game => key(game.slot.slot, game.court)));
  const pending = allGames.filter(game => !completed.has(key(game.slot.slot, game.court)) && !liveKeys.has(key(game.slot.slot, game.court)));
  const plannedCapacity = props.liveCapacity ?? Math.max(0, ...result.schedule.map(slot => slot.courts.length));
  const capacity = Number.isFinite(plannedCapacity) ? plannedCapacity : 5;
  const laneCount = Math.min(5, Math.max(capacity, ...result.schedule.map(slot => slot.courts.length), ...live.map(game => game.displayCourt + 1)));
  const busyPlayers = new Map<string, number>();
  for (const game of live) {
    const court = game.slot.courts[game.court];
    if (!court) continue;
    for (const name of game.ref.players ?? [...court.teamA, ...court.teamB].map(player => player.name)) busyPlayers.set(name, game.displayCourt + 1);
  }
  const blockedPlayerNames = new Set([...busyPlayers.keys(), ...(props.blockedPlayerNames ?? [])]);
  const waitingReason = (game: ScheduledGame) => {
    const court = game.slot.courts[game.court];
    if (!court) return '';
    return [...court.teamA, ...court.teamB].filter(player => blockedPlayerNames.has(player.name)).map(player => {
      const lane = busyPlayers.get(player.name);
      return lane ? `${player.name} is still playing on Court ${lane}.` : `${player.name} is unavailable for this game.`;
    }).join(' ');
  };
  const laneGames = new Map<number, ScheduledGame>(live.map(game => [game.displayCourt, game]));
  const readyGames = pending.slice(0, Math.max(0, capacity - live.length));
  // Mirror physical lane preferences for display only; queue transitions stay in useLiveQueue.
  for (const game of readyGames) {
    const lane = game.court < capacity && !laneGames.has(game.court)
      ? game.court
      : Array.from({ length: capacity }, (_, index) => index).find(index => !laneGames.has(index));
    if (lane != null) laneGames.set(lane, game);
  }
  const lanes = Array.from({ length: laneCount }, (_, index) => {
    const current = live.find(game => game.displayCourt === index);
    const game = laneGames.get(index);
    const reason = !current && game ? waitingReason(game) : '';
    const upcomingSlot = result.schedule.find(slot => slot.slot >= fromSlot);
    const unfilled = !game && index < capacity && upcomingSlot != null && upcomingSlot.courts.length < capacity;
    const notYetAvailable = !game && index >= capacity && pending.some(game => game.court === index);
    const explanation = notYetAvailable ? 'This court is not available in the current slot.'
      : unfilled ? 'Fewer than four eligible players are available for this court.' : reason;
    return { index, game, current, explanation, status: current ? 'Live' : explanation ? 'Waiting' : game ? 'Ready' : 'Done' };
  });
  const upcoming = pending.slice(readyGames.length);
  const nextGames = upcoming.slice(0, capacity);
  const futureGames = upcoming.slice(capacity);
  const ready = lanes.find(lane => lane.status === 'Ready');
  const waiting = lanes.find(lane => lane.index < capacity && lane.status === 'Waiting');
  const instruction = ready
    ? `Court ${ready.index + 1} is ready. Send these four players to Court ${ready.index + 1}, then select Start game.`
    : waiting
      ? `Court ${waiting.index + 1} is waiting: ${waiting.explanation}`
      : live.length > 0
        ? 'Games are live. Select Finish game on the court when its game is over.'
        : 'No more games. The session is complete.';
  const gameProps = { ...props, blockedPlayerNames };
  return <div ref={props.scheduleRef} role="region" aria-label="Live session board" style={{ minWidth: 0, marginBottom: 24 }}>
    <SessionSummary players={props.players} liveGames={liveGames} completedGames={completedGames} result={result} fromSlot={fromSlot} staggerMode={props.staggerMode ?? 'none'} />
    <section aria-label="What happens now?" style={{ borderLeft: `3px solid ${waiting && !ready ? C.amber : C.green}`, padding: '8px 12px', marginBottom: 16, overflowWrap: 'anywhere' }}>
      <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>What happens now?</h2>
      <p role="status" style={{ margin: 0, fontSize: 14 }}>{instruction}</p>
      {queueAdjustment && <p role="status" style={{ margin: '8px 0 0', color: C.amber, fontSize: 13 }}>
        {queueAdjustment.replacements.length > 0
          ? queueAdjustment.replacements.map(({ court, replacer, replacee }) => `Court ${court} updated: ${replacer} replaced ${replacee} because ${replacee} is still playing.`).join(' ')
          : `Court ${queueAdjustment.promotedGame.displayCourt + 1} updated: the next playable game is now on court because ${queueAdjustment.unavailablePlayers.join(', ')} ${queueAdjustment.unavailablePlayers.length === 1 ? 'is' : 'are'} still playing.`}
      </p>}
    </section>
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>Current game</h3>
      <div className="schedule-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {lanes.map(lane => <div key={lane.index} role="region" aria-label={`Court ${lane.index + 1}`} style={{ minWidth: 0 }}>
          {lane.game ? <ScheduleGame props={gameProps} game={{ ...lane.game, displayCourt: lane.index }} sessionActions waitingReason={lane.explanation} />
            : <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, overflowWrap: 'anywhere' }}>
              <h4 style={{ fontSize: 14, margin: '0 0 6px' }}>Court {lane.index + 1}</h4>
              <strong style={{ color: lane.status === 'Waiting' ? C.amber : C.green }}>{lane.status}</strong>
              {lane.explanation && <p style={{ fontSize: 12 }}>{lane.explanation}</p>}
            </div>}
        </div>)}
      </div>
    </section>
    {nextGames.length > 0 && <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>Next game</h3>
      <div className="schedule-grid">{nextGames.map(game => <ScheduleGame key={key(game.slot.slot, game.court)} props={gameProps} game={game} sessionActions waitingReason={waitingReason(game)} />)}</div>
    </section>}
    <ScheduleGrid {...gameProps} futureGames={futureGames} />
  </div>;
}
