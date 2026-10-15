import type { ForcedFirstSlot, Player } from '../algorithm/types';
import type { PlannerResult, RuntimePatch, ScoresMap, WinLossMap } from '../types';
import type { GameRef } from './liveQueue';

type ScheduleLike = PlannerResult['schedule'];

export interface RegenerateArgs {
  targetFromSlot: number;
  overridePlayers?: Player[] | null;
  blockedForFirstSlot?: Set<string>;
  overrideWinLoss?: WinLossMap | null;
  overrideScores?: ScoresMap | null;
  baseResult: PlannerResult;
  forcedFirstSlot?: ForcedFirstSlot | null;
  courtOverrides?: Record<number, number>;
}

export interface RegeneratedPlan {
  newResult: PlannerResult;
  nextScores: ScoresMap;
}

/** Slots containing runtime records cannot be regenerated as contiguous court arrays. */
export function getFutureChangeBoundary(liveGames: GameRef[], completedGames: GameRef[]) {
  return Math.max(1, ...liveGames.map(game => game.slot + 1), ...completedGames.map(game => game.slot + 1));
}

export function reconcileFutureSessionChange(input: {
  result: PlannerResult;
  totalSlots: number;
  boundarySlot: number;
  targetCapacity: number;
  overridePlayers?: Player[];
  courtOverrides: Record<number, number>;
  liveGames: GameRef[];
  completedGames: GameRef[];
  scores: ScoresMap;
  regenerate: (args: RegenerateArgs) => RegeneratedPlan | null;
}): RuntimePatch | null {
  const boundarySlot = Math.max(input.boundarySlot, getFutureChangeBoundary(input.liveGames, input.completedGames));
  if (!Number.isInteger(boundarySlot) || boundarySlot > input.totalSlots) return null;
  if (!Number.isInteger(input.targetCapacity) || input.targetCapacity < 1 || input.targetCapacity > 5) return null;
  const regenerated = input.regenerate({
    targetFromSlot: boundarySlot,
    baseResult: input.result,
    overridePlayers: input.overridePlayers,
    courtOverrides: input.courtOverrides,
  });
  if (!regenerated) return null;
  const scores: ScoresMap = {};
  for (const [key, score] of Object.entries(input.scores)) {
    const match = key.match(/^s(\d+)c/);
    if (match && Number(match[1]) < boundarySlot) scores[key] = score;
  }
  return {
    result: {
      ...regenerated.newResult,
      schedule: [
        ...input.result.schedule.filter(slot => slot.slot < boundarySlot),
        ...regenerated.newResult.schedule.filter(slot => slot.slot >= boundarySlot),
      ],
    },
    scores,
    liveGames: input.liveGames,
    completedGames: input.completedGames,
    ...(input.overridePlayers ? { players: input.overridePlayers } : {}),
    courtOverrides: input.courtOverrides,
    fromSlot: boundarySlot,
    fromSlotCourts: input.targetCapacity,
    scheduleDirty: false,
    copied: false,
    isConfirmed: false,
    loadedPlanId: null,
  };
}

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

export interface QueuePromotionDecision {
  first: GameRef | null;
  firstBlockedPlayers: string[];
  lookahead: GameRef | null;
  mode: 'promote-first' | 'choose' | 'substitute-first';
}

function gameKey(game: GameRef) {
  return `${game.slot}:${game.court}`;
}

function courtPlayers(schedule: ScheduleLike, game: GameRef) {
  if (game.players?.length === 4) return [...game.players];
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

/**
 * Inspect only the first queued game and one immediate lookahead. This keeps a
 * blocked queue from silently cascading through an arbitrary number of games.
 */
export function getQueuePromotionDecision(input: Omit<LiveQueueTransitionInput, 'capacity'>): QueuePromotionDecision {
  const completedKeys = new Set(input.completedGames.map(gameKey));
  const liveKeys = new Set(input.liveGames.map(gameKey));
  const liveNames = new Set(input.liveGames.flatMap(game => courtPlayers(input.schedule, game)));
  const suspendedNames = new Set(input.suspendedPlayerNames);
  const candidates = input.schedule
    .flatMap(slot => slot.courts.map((_, court) => ({ slot: slot.slot, court })))
    .filter(game => game.slot > input.changedSlot && !completedKeys.has(gameKey(game)) && !liveKeys.has(gameKey(game)))
    .slice(0, 2);
  const first = candidates[0] ?? null;
  if (!first) return { first: null, firstBlockedPlayers: [], lookahead: null, mode: 'substitute-first' };

  const firstPlayers = courtPlayers(input.schedule, first);
  const firstBlockedPlayers = firstPlayers.filter(name => liveNames.has(name) || suspendedNames.has(name));
  if (firstBlockedPlayers.length === 0) {
    return { first, firstBlockedPlayers, lookahead: null, mode: 'promote-first' };
  }

  const lookahead = candidates[1] ?? null;
  const lookaheadPlayable = lookahead && playableCandidate(input.schedule, lookahead, input.liveGames, input.completedGames, suspendedNames)
    && !courtPlayers(input.schedule, lookahead).some(name => liveNames.has(name));
  return {
    first,
    firstBlockedPlayers,
    lookahead: lookaheadPlayable ? lookahead : null,
    mode: lookaheadPlayable ? 'choose' : 'substitute-first',
  };
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
