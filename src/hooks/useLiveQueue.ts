import { useCallback, useMemo } from 'react';
import type { Player, ForcedFirstSlot } from '../algorithm/types';
import type { PlannerResult, ScoresMap, WinLossMap } from '../types';
import {
  addUniqueGame,
  contiguousGamesForSlot,
  firstIncompleteSlot,
  gameMatches,
  hasGame,
  liveQueueDebug,
  normalizeGameRefs,
} from '../utils/liveQueue';
import type { GameRef } from '../utils/liveQueue';

interface RegenerateArgs {
  targetFromSlot: number;
  overridePlayers?: Player[] | null;
  blockedForFirstSlot?: Set<string>;
  overrideWinLoss?: WinLossMap | null;
  overrideScores?: ScoresMap | null;
  baseResult: PlannerResult;
  forcedFirstSlot?: ForcedFirstSlot | null;
}

interface RegeneratedPlan {
  newResult: PlannerResult;
  nextScores: ScoresMap;
}

interface LiveQueueOptions {
  result: PlannerResult | null;
  players: Player[];
  liveGames: GameRef[];
  completedGames: GameRef[];
  suspendedPlayerNames: string[];
  fromSlot: number;
  totalSlots: number;
  canPlayerJoin: boolean;
  getCourtsPerSlot: () => number[];
  regenerate: (args: RegenerateArgs) => RegeneratedPlan | null;
  patchState: (patch: Record<string, unknown>) => void;
}

export function useLiveQueue({
  result,
  players,
  liveGames,
  completedGames,
  suspendedPlayerNames,
  fromSlot,
  totalSlots,
  canPlayerJoin,
  getCourtsPerSlot,
  regenerate,
  patchState,
}: LiveQueueOptions) {
  const firstIncomplete = useCallback((games: GameRef[], scheduleResult = result) => {
    if (!scheduleResult) return fromSlot;
    return firstIncompleteSlot(scheduleResult.schedule, games, totalSlots);
  }, [fromSlot, result, totalSlots]);

  const livePlayerNamesFor = useCallback((games: GameRef[], scheduleResult = result) => {
    if (!scheduleResult || !games.length) return new Set<string>();
    const names = new Set<string>();
    for (const game of games) {
      const slot = scheduleResult.schedule.find(item => item.slot === game.slot);
      const court = slot?.courts[game.court];
      if (court) [...court.teamA, ...court.teamB].forEach(player => names.add(player.name));
    }
    return names;
  }, [result]);

  // The scheduler represents courts as a contiguous array. A sparse live slot cannot
  // be safely forced without changing a court's identity, so regeneration skips it.
  const forcedLiveCourtsForSlot = useCallback((slotNum: number, games: GameRef[], scheduleResult = result) => {
    if (!scheduleResult) return null;
    const liveInSlot = contiguousGamesForSlot(games, slotNum);
    if (!liveInSlot) return null;
    const slot = scheduleResult.schedule.find(item => item.slot === slotNum);
    if (!slot) return null;
    const forcedCourts: number[][] = [];
    for (const game of liveInSlot) {
      if (game.court !== forcedCourts.length) return null;
      const court = slot.courts[game.court];
      if (!court) return null;
      const indexes = [...court.teamA, ...court.teamB].map(player => players.findIndex(item => item.name === player.name));
      if (indexes.length !== 4 || indexes.some(index => index < 0)) return null;
      forcedCourts.push(indexes);
    }
    return forcedCourts;
  }, [players, result]);

  const nextPlayableQueuedGame = useCallback((scheduleResult: PlannerResult | null, gamesCompleted: GameRef[], gamesLive: GameRef[], startSlot: number) => {
    if (!scheduleResult) return null;
    const blockedNames = livePlayerNamesFor(gamesLive, scheduleResult);
    for (const slot of scheduleResult.schedule) {
      if (slot.slot < startSlot) continue;
      for (let court = 0; court < slot.courts.length; court++) {
        if (hasGame(gamesCompleted, slot.slot, court) || hasGame(gamesLive, slot.slot, court)) continue;
        const selectedCourt = slot.courts[court];
        if (!selectedCourt) continue;
        if (![...selectedCourt.teamA, ...selectedCourt.teamB].some(player => blockedNames.has(player.name))) {
          return { slot: slot.slot, court };
        }
      }
    }
    return null;
  }, [livePlayerNamesFor]);

  const applyLiveGamesUpdate = useCallback((newLiveGames: GameRef[], changedSlot: number, newCompletedGames = completedGames, extraPatch: Record<string, unknown> = {}, options: { targetLiveCount?: number; suspendedPlayerNames?: string[]; overridePlayers?: Player[] } = {}) => {
    const targetLiveCount = options.targetLiveCount ?? newLiveGames.length;
    liveQueueDebug('apply:start', {
      changedSlot,
      targetLiveCount,
      liveGames: newLiveGames,
      completedGames: newCompletedGames,
      extraPatch: Object.keys(extraPatch),
    });
    let nextLiveGames = normalizeGameRefs(newLiveGames, result?.schedule ?? null, targetLiveCount);
    let nextCompletedGames = newCompletedGames;
    let nextResult = result;
    let nextSuspendedPlayerNames = options.suspendedPlayerNames ?? suspendedPlayerNames;
    const patch: Record<string, unknown> = {
      liveGames: nextLiveGames,
      completedGames: nextCompletedGames,
      suspendedPlayerNames: nextSuspendedPlayerNames,
      fromSlot: firstIncomplete(nextCompletedGames, nextResult),
      ...extraPatch,
    };

    const regenerateFrom = (regenFromSlot: number) => {
      if (regenFromSlot > totalSlots || !nextResult) return false;
      const forcedLiveCourts = forcedLiveCourtsForSlot(regenFromSlot, nextLiveGames, nextResult);
      const forcedFirstSlot = forcedLiveCourts
        ? { courts: forcedLiveCourts, targetCourts: getCourtsPerSlot()[regenFromSlot - 1] }
        : null;
      const blockingLiveGames = forcedLiveCourts
        ? nextLiveGames.filter(game => game.slot !== regenFromSlot)
        : nextLiveGames;
      const blockedForFirstSlot = new Set([
        ...livePlayerNamesFor(blockingLiveGames, nextResult),
        ...nextSuspendedPlayerNames,
      ]);
      const regenerated = regenerate({
        targetFromSlot: regenFromSlot,
        overridePlayers: options.overridePlayers ?? null,
        blockedForFirstSlot,
        overrideWinLoss: (patch.winLoss as WinLossMap | undefined) ?? null,
        overrideScores: (patch.scores as ScoresMap | undefined) ?? null,
        baseResult: nextResult,
        forcedFirstSlot,
      });
      if (!regenerated) {
        liveQueueDebug('regenerate:failed', { regenFromSlot, liveGames: nextLiveGames, completedGames: nextCompletedGames });
        return false;
      }
      nextResult = regenerated.newResult;
      nextCompletedGames = nextCompletedGames.filter(game => game.slot < regenFromSlot);
      patch.result = nextResult;
      patch.scores = regenerated.nextScores;
      patch.completedGames = nextCompletedGames;
      patch.copied = false;
      patch.isConfirmed = false;
      patch.loadedPlanId = null;
      if (nextSuspendedPlayerNames.length > 0) {
        nextSuspendedPlayerNames = [];
        patch.suspendedPlayerNames = [];
      }
      liveQueueDebug('regenerate:success', { regenFromSlot, liveGames: nextLiveGames, completedGames: nextCompletedGames });
      return true;
    };

    const nextSafeRegenSlot = (startSlot: number) => {
      let slot = startSlot;
      while (slot <= totalSlots && nextLiveGames.some(game => game.slot === slot) && !forcedLiveCourtsForSlot(slot, nextLiveGames, nextResult)) slot++;
      return slot;
    };

    const initialRegenSlot = nextSafeRegenSlot(changedSlot + 1);
    if (regenerateFrom(initialRegenSlot) || initialRegenSlot > totalSlots) {
      while (nextLiveGames.length < targetLiveCount) {
        const queuedGame = nextPlayableQueuedGame(nextResult, nextCompletedGames, nextLiveGames, changedSlot + 1);
        if (!queuedGame) break;
        const beforeCount = nextLiveGames.length;
        nextLiveGames = addUniqueGame(nextLiveGames, queuedGame);
        if (nextLiveGames.length === beforeCount) break;
        regenerateFrom(nextSafeRegenSlot(queuedGame.slot + 1));
      }
    }

    nextLiveGames = normalizeGameRefs(nextLiveGames, nextResult?.schedule ?? null, targetLiveCount);
    patch.liveGames = nextLiveGames;
    patch.completedGames = nextCompletedGames;
    patch.suspendedPlayerNames = nextSuspendedPlayerNames;
    patch.fromSlot = firstIncomplete(nextCompletedGames, nextResult);
    liveQueueDebug('apply:final', {
      changedSlot,
      liveGames: nextLiveGames,
      completedGames: nextCompletedGames,
      fromSlot: patch.fromSlot,
      regenerated: Boolean(patch.result),
    });
    patchState(patch);
  }, [completedGames, firstIncomplete, forcedLiveCourtsForSlot, getCourtsPerSlot, livePlayerNamesFor, nextPlayableQueuedGame, regenerate, result, suspendedPlayerNames, totalSlots]);

  const toggleLiveGame = useCallback((slotNum: number, court: number) => {
    const isLive = hasGame(liveGames, slotNum, court);
    const activeCapacity = Math.max(1, getCourtsPerSlot()[Math.max(0, fromSlot - 1)] ?? 1);
    if (!isLive && liveGames.length >= activeCapacity) {
      liveQueueDebug('toggle:blocked-capacity', {
        clicked: { slot: slotNum, court },
        activeCapacity,
        liveGames,
      });
      return;
    }
    const withoutCompleted = completedGames.filter(game => !gameMatches(game, slotNum, court));
    const nextLiveGames = isLive
      ? liveGames.filter(game => !gameMatches(game, slotNum, court))
      : addUniqueGame(liveGames, { slot: slotNum, court });
    const nextCompletedGames = isLive ? [...withoutCompleted, { slot: slotNum, court }] : withoutCompleted;
    liveQueueDebug('toggle', {
      clicked: { slot: slotNum, court },
      action: isLive ? 'complete' : 'start',
      beforeLiveGames: liveGames,
      beforeCompletedGames: completedGames,
      nextLiveGames,
      nextCompletedGames,
    });
    applyLiveGamesUpdate(nextLiveGames, slotNum, nextCompletedGames, {}, isLive ? { targetLiveCount: liveGames.length } : {});
  }, [applyLiveGamesUpdate, completedGames, fromSlot, getCourtsPerSlot, liveGames]);

  const setPlayerLeaving = useCallback((index: number) => {
    const updatedPlayers = players.map((player, playerIndex) => playerIndex === index ? { ...player, leavesAt: fromSlot - 2 } : player);
    applyLiveGamesUpdate(liveGames, fromSlot - 1, completedGames, { players: updatedPlayers }, { overridePlayers: updatedPlayers });
  }, [applyLiveGamesUpdate, completedGames, fromSlot, liveGames, players]);

  const setPlayerJoining = useCallback((index: number) => {
    if (!canPlayerJoin || !players[index]) return;
    const updatedPlayers = players.map((player, playerIndex) => playerIndex === index ? { ...player, availFrom: fromSlot - 1 } : player);
    applyLiveGamesUpdate(liveGames, fromSlot - 1, completedGames, { players: updatedPlayers }, { overridePlayers: updatedPlayers });
  }, [applyLiveGamesUpdate, canPlayerJoin, completedGames, fromSlot, liveGames, players]);

  const togglePlayerSuspended = useCallback((index: number) => {
    const player = players[index];
    if (!player) return;
    const nextSuspended = suspendedPlayerNames.includes(player.name)
      ? suspendedPlayerNames.filter(name => name !== player.name)
      : [...suspendedPlayerNames, player.name];
    if (!result) {
      patchState({ suspendedPlayerNames: nextSuspended });
      return;
    }
    const regenStart = Math.max(1, firstIncomplete(completedGames, result));
    applyLiveGamesUpdate(liveGames, regenStart - 1, completedGames, {}, { suspendedPlayerNames: nextSuspended });
  }, [applyLiveGamesUpdate, completedGames, firstIncomplete, liveGames, patchState, players, result, suspendedPlayerNames]);

  const blockedPlayerNames = useMemo(() => livePlayerNamesFor(liveGames, result), [liveGames, livePlayerNamesFor, result]);

  return {
    applyLiveGamesUpdate,
    blockedPlayerNames,
    firstIncomplete,
    setPlayerJoining,
    setPlayerLeaving,
    toggleLiveGame,
    togglePlayerSuspended,
  };
}
