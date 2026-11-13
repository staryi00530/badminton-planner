import type { Player } from '../algorithm/types';
import type { PlannerResult, StaggerMode } from '../types';
import type { GameRef } from './liveQueue';
import { applyAvailability } from './availability';
import { getFutureChangeBoundary } from './liveQueueTransition';

export interface WaitingClockState { trackingStartedAt?: number; since: Record<string, number> }
export interface WaitingClockContext {
  players: Player[]; result: PlannerResult | null; liveGames: GameRef[]; completedGames: GameRef[];
  staggerMode: StaggerMode; suspendedPlayerNames: string[];
}
// RTDB object keys cannot contain punctuation such as '.', '/', '$', '[' or '#'.
export const waitingPlayerKey = (player: Pick<Player, 'id' | 'name'>) => encodeURIComponent(player.id ?? `legacy:${player.name.trim().toLocaleLowerCase()}`).replace(/\./g, '%2E');
export function validWaitingClock(value: unknown): value is WaitingClockState {
  if (!value || typeof value !== 'object') return false;
  const clock = value as WaitingClockState;
  const time = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return (clock.trackingStartedAt === undefined || time(clock.trackingStartedAt)) && (clock.since === undefined || (clock.since !== null && typeof clock.since === 'object' && !Array.isArray(clock.since)))
    && Object.keys(clock.since ?? {}).length <= 1000 && Object.entries(clock.since ?? {}).every(([key, at]) => key.length > 0 && key.length <= 500 && time(at))
    && (clock.trackingStartedAt !== undefined || Object.keys(clock.since ?? {}).length === 0);
}
export function waitingPlayerStatuses(context: WaitingClockContext) {
  const { players, result, liveGames, completedGames, staggerMode, suspendedPlayerNames } = context;
  const onCourt = new Set(liveGames.flatMap(game => {
    const court = result?.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
    return game.players ?? (court ? [...court.teamA, ...court.teamB].map(p => p.name) : []);
  }));
  const totalSlots = Math.max(0, ...(result?.schedule.map(s => s.slot) ?? []));
  const futureBoundary = Math.max(getFutureChangeBoundary(liveGames, completedGames), result?.capacityProgressFloorSlot ?? 1) - 1;
  // The final games are still in progress even when no future slot can be edited.
  const boundary = liveGames.length ? Math.min(futureBoundary, Math.max(0, totalSlots - 1)) : futureBoundary;
  return applyAvailability(players, { staggerMode, totalSlots }).map(player => ({ player, key: waitingPlayerKey(player),
    status: onCourt.has(player.name) ? 'playing' as const : !player.quarantined && !suspendedPlayerNames.includes(player.name)
      && (player.availFrom ?? 0) <= boundary && (player.availTo ?? totalSlots - 1) >= boundary ? 'waiting' as const : 'unavailable' as const }));
}
export function reconcileWaitingClock(previous: WaitingClockState | undefined, before: WaitingClockContext, after: WaitingClockContext, at: number,
  options: { start?: boolean; reset?: boolean } = {}): WaitingClockState {
  if (options.reset) return { since: {} };
  const clock: WaitingClockState = validWaitingClock(previous) ? { ...previous, since: previous.since ?? {} } : { since: {} };
  if (!Number.isSafeInteger(at) || at < 0 || !after.result) return clock;
  const activated = options.start
    || after.liveGames.some(g => g.startedAt !== undefined && !before.liveGames.some(old => old.slot === g.slot && old.court === g.court && old.startedAt !== undefined))
    || after.completedGames.some(g => !before.completedGames.some(old => old.slot === g.slot && old.court === g.court));
  if (clock.trackingStartedAt === undefined && !activated) return clock;
  const since = Object.fromEntries(waitingPlayerStatuses(after).filter(row => row.status === 'waiting').map(row => [row.key, clock.since[row.key] ?? at]));
  const next = { trackingStartedAt: clock.trackingStartedAt ?? at, since };
  return JSON.stringify(next) === JSON.stringify(clock) && previous?.since ? previous : next;
}
