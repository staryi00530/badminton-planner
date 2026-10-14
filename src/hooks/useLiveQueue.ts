import { useCallback, useMemo, useState } from 'react';
import type { Player, ForcedFirstSlot } from '../algorithm/types';
import type { PlannerResult, RuntimePatch, ScoresMap, WinLossMap } from '../types';
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
import { reconcileLiveQueue } from '../utils/liveQueueTransition';

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
  patchState: (patch: RuntimePatch) => void;
}

function assignDisplayCourts(games: GameRef[], capacity: number): GameRef[] {
  const laneCount = Math.max(0, capacity, games.length);
  const used = new Set<number>();
  const assigned = games.map(game => ({ ...game }));

  for (const game of assigned) {
    const lane = game.displayCourt;
    if (lane != null && lane >= 0 && lane < laneCount && !used.has(lane)) used.add(lane);
    else delete game.displayCourt;
  }
  for (const game of assigned) {
    if (game.displayCourt != null) continue;
    const preferred = game.court;
    const lane = preferred >= 0 && preferred < laneCount && !used.has(preferred)
      ? preferred
      : Array.from({ length: laneCount }, (_, index) => index).find(index => !used.has(index));
    if (lane == null) continue;
    used.add(lane);
    game.displayCourt = lane;
  }
  return assigned;
}

export interface QueueAdjustmentNotice {
  queuedGame: { slot: number; court: number; players: string[] };
  promotedGame: { slot: number; court: number; displayCourt: number; players: string[] };
  unavailablePlayers: string[];
  replacements: Array<{ replacee: string; replacer: string; court: number }>;
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
  const [queueAdjustment, setQueueAdjustment] = useState<QueueAdjustmentNotice | null>(null);
  const describeGames = useCallback((games: GameRef[], scheduleResult = result) => games.map(game => {
    const slot = scheduleResult?.schedule.find(item => item.slot === game.slot);
    const court = slot?.courts[game.court];
    return {
      slot: game.slot,
      court: game.court + 1,
      players: game.players ? [...game.players] : court ? [...court.teamA, ...court.teamB].map(player => player.name) : [],
    };
  }), [result]);

  const snapshotGame = useCallback((slot: number, court: number): GameRef => {
    const selected = result?.schedule.find(item => item.slot === slot)?.courts[court];
    return { slot, court, players: selected ? [...selected.teamA, ...selected.teamB].map(player => player.name) : [] };
  }, [result]);

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

  const applyLiveGamesUpdate = useCallback((newLiveGames: GameRef[], changedSlot: number, newCompletedGames = completedGames, extraPatch: RuntimePatch = {}, options: { targetLiveCount?: number; suspendedPlayerNames?: string[]; overridePlayers?: Player[]; overrideResult?: PlannerResult } = {}) => {
    const scheduleResult = options.overrideResult ?? result;
    const targetLiveCount = options.targetLiveCount ?? newLiveGames.length;
    liveQueueDebug('apply:start', {
      changedSlot,
      targetLiveCount,
      liveGames: describeGames(newLiveGames),
      completedGames: describeGames(newCompletedGames),
      extraPatch: Object.keys(extraPatch),
    });
    const normalized = scheduleResult
      ? reconcileLiveQueue({
        schedule: scheduleResult.schedule,
        liveGames: newLiveGames,
        completedGames: newCompletedGames,
        capacity: targetLiveCount,
        changedSlot: totalSlots,
        suspendedPlayerNames: options.suspendedPlayerNames ?? suspendedPlayerNames,
      })
      : { liveGames: normalizeGameRefs(newLiveGames, null, targetLiveCount), completedGames: newCompletedGames, promotedGames: [] };
    let nextCompletedGames = normalized.completedGames;
    let nextLiveGames = assignDisplayCourts(normalized.liveGames, targetLiveCount);
    let nextResult = scheduleResult;
    let nextSuspendedPlayerNames = options.suspendedPlayerNames ?? suspendedPlayerNames;
    const shouldPromote = targetLiveCount > nextLiveGames.length;
    const queuedPreviewGame = shouldPromote && nextResult
      ? nextResult.schedule
        .flatMap(slot => slot.courts.map((_, court) => ({ slot: slot.slot, court })))
        .find(game => game.slot >= changedSlot + 1
          && !hasGame(nextCompletedGames, game.slot, game.court)
          && !hasGame(nextLiveGames, game.slot, game.court)) ?? null
      : null;
    // Keep the queued court identity stable while regeneration finds a playable
    // replacement for anyone who is still active on another court.
    const reservedQueuedGame = queuedPreviewGame;
    const reservedGroupRepeats = reservedQueuedGame && nextResult
      ? (() => {
        const slot = nextResult.schedule.find(item => item.slot === reservedQueuedGame.slot);
        const court = slot?.courts[reservedQueuedGame.court];
        if (!court) return false;
        const group = [...court.teamA, ...court.teamB].map(player => player.name).sort().join('|');
        return [...nextCompletedGames, ...nextLiveGames].some(game => {
          const priorSlot = nextResult?.schedule.find(item => item.slot === game.slot);
          const priorCourt = priorSlot?.courts[game.court];
          return priorCourt && [...priorCourt.teamA, ...priorCourt.teamB].map(player => player.name).sort().join('|') === group;
        });
      })()
      : false;
    if (reservedGroupRepeats && reservedQueuedGame) {
      liveQueueDebug('queue:reservation-rejected-repeat', {
        queuedGame: describeGames([reservedQueuedGame], scheduleResult)[0],
        liveGames: describeGames(nextLiveGames, scheduleResult),
        completedGames: describeGames(nextCompletedGames, scheduleResult),
      });
    }
    const unavailableQueuedPlayers = queuedPreviewGame && nextResult
      ? [...(nextResult.schedule.find(slot => slot.slot === queuedPreviewGame.slot)?.courts[queuedPreviewGame.court]?.teamA ?? []), ...(nextResult.schedule.find(slot => slot.slot === queuedPreviewGame.slot)?.courts[queuedPreviewGame.court]?.teamB ?? [])]
        .map(player => player.name)
        .filter(name => livePlayerNamesFor(nextLiveGames, nextResult).has(name))
      : [];
    const patch: RuntimePatch = {
      liveGames: nextLiveGames,
      completedGames: nextCompletedGames,
      suspendedPlayerNames: nextSuspendedPlayerNames,
      fromSlot: firstIncomplete(nextCompletedGames, nextResult),
      ...extraPatch,
    };
    if (options.overrideResult) patch.result = options.overrideResult;

    const regenerateFrom = (regenFromSlot: number) => {
      if (regenFromSlot > totalSlots || !nextResult) return false;
      const gamesToPreserve = reservedQueuedGame && !reservedGroupRepeats && unavailableQueuedPlayers.length === 0 && reservedQueuedGame.slot === regenFromSlot && !hasGame(nextLiveGames, reservedQueuedGame.slot, reservedQueuedGame.court)
        ? [...nextLiveGames, ...nextCompletedGames, reservedQueuedGame]
        : [...nextLiveGames, ...nextCompletedGames];
      const forcedLiveCourts = forcedLiveCourtsForSlot(regenFromSlot, gamesToPreserve, nextResult);
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
      // Completion is an event, not part of the generated lineup. Keep it when
      // future slots are regenerated so a played game cannot re-enter the queue.
      nextCompletedGames = nextCompletedGames.filter(game => nextResult.schedule.some(slot => slot.slot === game.slot && slot.courts[game.court]));
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
      while (slot <= totalSlots) {
        const hasLive = nextLiveGames.some(game => game.slot === slot);
        const hasCompleted = nextCompletedGames.some(game => game.slot === slot);
        if ((!hasLive && !hasCompleted) || forcedLiveCourtsForSlot(slot, [...nextLiveGames, ...nextCompletedGames], nextResult)) break;
        slot++;
      }
      return slot;
    };

    const initialRegenSlot = nextSafeRegenSlot(changedSlot + 1);
    if (regenerateFrom(initialRegenSlot) || initialRegenSlot > totalSlots) {
      while (nextLiveGames.length < targetLiveCount) {
        const transition = reconcileLiveQueue({
          schedule: nextResult?.schedule ?? [],
          liveGames: nextLiveGames,
          completedGames: nextCompletedGames,
          capacity: nextLiveGames.length + 1,
          changedSlot,
          suspendedPlayerNames: nextSuspendedPlayerNames,
        });
        const queuedGame = transition.promotedGames[0] ?? null;
        if (!queuedGame) break;
        const beforeCount = nextLiveGames.length;
        nextLiveGames = addUniqueGame(nextLiveGames, queuedGame);
        if (nextLiveGames.length === beforeCount) break;
        liveQueueDebug('queue:promote', {
          queuedGame: reservedQueuedGame ? describeGames([reservedQueuedGame], scheduleResult)[0] : null,
          promotedGame: describeGames([queuedGame], nextResult)[0],
          unavailableQueuedPlayers,
          beforeLiveGames: describeGames(nextLiveGames.slice(0, beforeCount), nextResult),
          afterLiveGames: describeGames(nextLiveGames, nextResult),
          completedGames: describeGames(nextCompletedGames, nextResult),
        });
        if (reservedQueuedGame && unavailableQueuedPlayers.length > 0) {
          const queuedDescription = describeGames([reservedQueuedGame], scheduleResult)[0]!;
          const promotedDescription = describeGames([queuedGame], nextResult)[0]!;
          const queuedNames = new Set(queuedDescription.players);
          const promotedNames = new Set(promotedDescription.players);
          const replacers = promotedDescription.players.filter(name => !queuedNames.has(name));
          const promotedWithLane = assignDisplayCourts([...nextLiveGames, queuedGame], targetLiveCount)
            .find(game => game.slot === queuedGame.slot && game.court === queuedGame.court);
          const displayCourt = promotedWithLane?.displayCourt ?? queuedGame.court;
          setQueueAdjustment({
            queuedGame: queuedDescription,
            promotedGame: { ...promotedDescription, displayCourt },
            unavailablePlayers: unavailableQueuedPlayers,
            replacements: unavailableQueuedPlayers.flatMap((replacee, index) => {
              const replacer = replacers[index];
              return replacer ? [{ replacee, replacer, court: displayCourt + 1 }] : [];
            }),
          });
        } else {
          setQueueAdjustment(null);
        }
        regenerateFrom(nextSafeRegenSlot(queuedGame.slot + 1));
      }
    }

    nextLiveGames = assignDisplayCourts(normalizeGameRefs(nextLiveGames, nextResult?.schedule ?? null, targetLiveCount), targetLiveCount);
    patch.liveGames = nextLiveGames;
    patch.completedGames = nextCompletedGames;
    patch.suspendedPlayerNames = nextSuspendedPlayerNames;
    patch.fromSlot = firstIncomplete(nextCompletedGames, nextResult);
    liveQueueDebug('apply:final', {
      changedSlot,
      liveGames: describeGames(nextLiveGames, nextResult),
      completedGames: describeGames(nextCompletedGames, nextResult),
      fromSlot: patch.fromSlot,
      regenerated: Boolean(patch.result),
    });
    patchState(patch);
  }, [completedGames, describeGames, firstIncomplete, forcedLiveCourtsForSlot, getCourtsPerSlot, livePlayerNamesFor, regenerate, result, suspendedPlayerNames, totalSlots]);

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
    const nextCompletedGames = isLive ? [...withoutCompleted, snapshotGame(slotNum, court)] : withoutCompleted;
    liveQueueDebug('toggle', {
      clicked: { slot: slotNum, court },
      action: isLive ? 'complete' : 'start',
      beforeLiveGames: describeGames(liveGames),
      beforeCompletedGames: describeGames(completedGames),
      nextLiveGames: describeGames(nextLiveGames),
      nextCompletedGames: describeGames(nextCompletedGames),
    });
    applyLiveGamesUpdate(nextLiveGames, slotNum, nextCompletedGames, {}, isLive ? { targetLiveCount: liveGames.length } : {});
  }, [applyLiveGamesUpdate, completedGames, describeGames, fromSlot, getCourtsPerSlot, liveGames, snapshotGame]);

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
    queueAdjustment,
    setPlayerJoining,
    setPlayerLeaving,
    toggleLiveGame,
    togglePlayerSuspended,
  };
}
