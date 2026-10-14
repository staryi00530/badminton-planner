import type { PlannerResult } from '../types';
import type { GameRef } from './liveQueue';

type ScheduleLike = PlannerResult['schedule'];

export interface LiveQueueTransitionInput {
  schedule: ScheduleLike;
  liveGames: GameRef[];
  completedGames: GameRef[];
  capacity: number;
  changedSlot: number;
  suspendedPlayerNames: string[];
}

export interface LiveQueueTransitionResult {
  liveGames: GameRef[];
  completedGames: GameRef[];
  promotedGames: GameRef[];
}

function gameKey(game: GameRef) {
  return `${game.slot}:${game.court}`;
}

function courtPlayers(schedule: ScheduleLike, game: GameRef) {
  const court = schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
  return court ? [...court.teamA, ...court.teamB].map(player => player.name) : [];
}

function normalizeGames(games: GameRef[], schedule: ScheduleLike) {
  const seen = new Set<string>();
  return games.filter(game => {
    const key = gameKey(game);
    if (seen.has(key) || courtPlayers(schedule, game).length !== 4) return false;
    seen.add(key);
    return true;
  });
}

function playableCandidate(
  schedule: ScheduleLike,
  game: GameRef,
  liveGames: GameRef[],
  completedGames: GameRef[],
  suspendedNames: Set<string>,
) {
  if (completedGames.some(existing => gameKey(existing) === gameKey(game))) return false;
  if (liveGames.some(existing => gameKey(existing) === gameKey(game))) return false;
  const players = courtPlayers(schedule, game);
  return players.length === 4 && !players.some(name => suspendedNames.has(name));
}

export function reconcileLiveQueue(input: LiveQueueTransitionInput): LiveQueueTransitionResult {
  const schedule = input.schedule;
  const completedGames = normalizeGames(input.completedGames, schedule);
  const liveGames = normalizeGames(input.liveGames, schedule)
    .filter(game => !completedGames.some(completed => gameKey(completed) === gameKey(game)))
    .slice(0, Math.max(0, input.capacity));
  const targetCapacity = Math.max(0, input.capacity);
  const suspendedNames = new Set(input.suspendedPlayerNames);
  const blockedNames = new Set(liveGames.flatMap(game => courtPlayers(schedule, game)));
  const promotedGames: GameRef[] = [];

  for (const slot of schedule) {
    if (slot.slot <= input.changedSlot) continue;
    for (let court = 0; court < slot.courts.length && liveGames.length < targetCapacity; court++) {
      const candidate = { slot: slot.slot, court };
      if (!playableCandidate(schedule, candidate, liveGames, completedGames, suspendedNames)) continue;
      const players = courtPlayers(schedule, candidate);
      if (players.some(name => blockedNames.has(name))) continue;
      liveGames.push(candidate);
      promotedGames.push(candidate);
      players.forEach(name => blockedNames.add(name));
    }
    if (liveGames.length >= targetCapacity) break;
  }

  return { liveGames, completedGames, promotedGames };
}
