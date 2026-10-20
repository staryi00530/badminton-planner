import { useCallback, useMemo } from 'react';
import type { Player } from '../algorithm/types';
import type { PlannerResult, QueueRuntimeState, RuntimePatch, ScoresMap, WinLossMap } from '../types';
import { EMPTY_QUEUE_STATE } from '../utils/undoSnapshot';
export type { QueueAdjustmentNotice } from '../types';
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
import { getFutureChangeBoundary, getQueuePromotionDecision, reconcileFutureSessionChange, reconcileLiveQueue } from '../utils/liveQueueTransition';
import type { RegenerateArgs, RegeneratedPlan } from '../utils/liveQueueTransition';

interface LiveQueueOptions extends QueueRuntimeState {
  recordUndo: () => void;
  result: PlannerResult | null;
  players: Player[];
  liveGames: GameRef[];
  completedGames: GameRef[];
  suspendedPlayerNames: string[];
  fromSlot: number;
  totalSlots: number;
  canPlayerJoin: boolean;
  scores: ScoresMap;
  courtOverrides: Record<number, number>;
  isConfirmed: boolean;
  getCourtsPerSlot: (overrides?: Record<number, number>) => number[];
  regenerate: (args: RegenerateArgs) => RegeneratedPlan | null;
  patchState: (patch: RuntimePatch) => void;
  onConfirmedScheduleChange?: (previousResult: PlannerResult) => void;
}

let queueFlowSequence = 0;

function nextQueueFlowId() {
  queueFlowSequence += 1;
  return `${Date.now()}-${queueFlowSequence}`;
}

function assignDisplayCourts(games: GameRef[], capacity: number): GameRef[] {
  const laneCount = Math.max(0, capacity, games.length, ...games.map(game => (game.displayCourt ?? -1) + 1));
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

function courtPlayersForLog(schedule: PlannerResult, game: GameRef) {
  const court = schedule.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
  return court ? [...court.teamA, ...court.teamB].map(player => player.name) : [];
}

function substituteQueuedGame(
  schedule: PlannerResult,
  game: GameRef,
  players: Player[],
  activeNames: Set<string>,
  suspendedNames: Set<string>,
) {
  const slot = schedule.schedule.find(item => item.slot === game.slot);
  const court = slot?.courts[game.court];
  if (!slot || !court) return null;
  const originalPlayers = game.players?.length === 4
    ? [...game.players]
    : [...court.teamA, ...court.teamB].map(player => player.name);
  const playerInfo = new Map(players.map(player => [player.name, player]));
  const slotPool = [
    ...slot.sitting.map(player => player.name),
    ...slot.courts.flatMap(item => [...item.teamA, ...item.teamB].map(player => player.name)),
  ];
  const used = new Set(originalPlayers);
  const replacements: Array<{ replacee: string; replacer: string }> = [];
  const nextPlayers = originalPlayers.map(name => {
    if (!activeNames.has(name)) return name;
    const gender = playerInfo.get(name)?.gender ?? [...court.teamA, ...court.teamB].find(player => player.name === name)?.gender;
    const candidates = [...new Set(slotPool)].filter(candidate => {
      if (used.has(candidate) || activeNames.has(candidate) || suspendedNames.has(candidate)) return false;
      return true;
    });
    const replacer = candidates.find(candidate => playerInfo.get(candidate)?.gender === gender) ?? candidates[0];
    if (!replacer) return name;
    used.add(replacer);
    replacements.push({ replacee: name, replacer });
    return replacer;
  });
  return {
    game: { ...game, players: nextPlayers },
    conflictingPlayers: originalPlayers.filter(name => activeNames.has(name)),
    unavailablePlayers: originalPlayers.filter(name => activeNames.has(name) && !replacements.some(item => item.replacee === name)),
    replacements,
  };
}

export function useLiveQueue({
  recordUndo,
  sessionChangeNotice,
  pendingSessionChange,
  queueAdjustment,
  queuePromotionPrompt,
  result,
  players,
  liveGames,
  completedGames,
  suspendedPlayerNames,
  fromSlot,
  totalSlots,
  canPlayerJoin,
  scores,
  courtOverrides,
  isConfirmed,
  getCourtsPerSlot,
  regenerate,
  patchState,
  onConfirmedScheduleChange,
}: LiveQueueOptions) {
  const changeSlot = getFutureChangeBoundary(liveGames, completedGames);
  const liveCapacity = getCourtsPerSlot()[Math.min(totalSlots - 1, changeSlot - 1)] ?? 1;
  const setSessionChangeNotice = (sessionChangeNotice: QueueRuntimeState['sessionChangeNotice']) => patchState({ sessionChangeNotice });
  const setPendingSessionChange = (pendingSessionChange: QueueRuntimeState['pendingSessionChange']) => patchState({ pendingSessionChange });
  const setQueueAdjustment = (queueAdjustment: QueueRuntimeState['queueAdjustment']) => patchState({ queueAdjustment });
  const setQueuePromotionPrompt = (queuePromotionPrompt: QueueRuntimeState['queuePromotionPrompt']) => patchState({ queuePromotionPrompt });
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
    const live = liveGames.find(game => gameMatches(game, slot, court));
    const selected = result?.schedule.find(item => item.slot === slot)?.courts[court];
    return {
      slot, court, ...live,
      players: live?.players?.length === 4 ? [...live.players] : selected ? [...selected.teamA, ...selected.teamB].map(player => player.name) : [],
    };
  }, [liveGames, result]);

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
      if (game.players?.length === 4) game.players.forEach(name => names.add(name));
      else if (court) [...court.teamA, ...court.teamB].forEach(player => names.add(player.name));
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
      const names = game.players?.length === 4 ? game.players : [...court.teamA, ...court.teamB].map(player => player.name);
      const indexes = names.map(name => players.findIndex(item => item.name === name));
      if (indexes.length !== 4 || indexes.some(index => index < 0)) return null;
      forcedCourts.push(indexes);
    }
    return forcedCourts;
  }, [players, result]);

  const applyLiveGamesUpdate = useCallback((newLiveGames: GameRef[], changedSlot: number, newCompletedGames = completedGames, extraPatch: RuntimePatch = {}, options: { targetLiveCount?: number; suspendedPlayerNames?: string[]; overridePlayers?: Player[]; overrideResult?: PlannerResult; regenerate?: boolean; queueChoice?: 'lookahead' | 'substitute'; queueGame?: GameRef | null; flowId?: string } = {}) => {
    recordUndo();
    const scheduleResult = options.overrideResult ?? result;
    const targetLiveCount = options.targetLiveCount ?? newLiveGames.length;
    const displayCapacity = Math.max(targetLiveCount, getCourtsPerSlot()[Math.max(0, fromSlot - 1)] ?? targetLiveCount);
    const flowId = options.flowId ?? nextQueueFlowId();
    const priorFromSlot = scheduleResult ? firstIncomplete(completedGames, scheduleResult) : fromSlot;
    liveQueueDebug('apply:start', {
      flowId,
      changedSlot,
      targetLiveCount,
      displayCapacity,
      priorFromSlot,
      queueChoice: options.queueChoice ?? null,
      requestedQueueGame: options.queueGame ? describeGames([options.queueGame], scheduleResult)[0] : null,
      liveGames: describeGames(newLiveGames),
      completedGames: describeGames(newCompletedGames),
      activePlayerNames: [...livePlayerNamesFor(newLiveGames, scheduleResult)].sort(),
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
    let nextLiveGames = assignDisplayCourts(normalized.liveGames, displayCapacity);
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
    if (shouldPromote && nextResult) {
      const blockedNames = livePlayerNamesFor(nextLiveGames, nextResult);
      liveQueueDebug('queue:scan', {
        flowId,
        changedSlot,
        capacity: targetLiveCount,
        currentLive: describeGames(nextLiveGames, nextResult),
        completed: describeGames(nextCompletedGames, nextResult),
        candidates: nextResult.schedule
          .flatMap(slot => slot.courts.map((_, court) => ({ slot: slot.slot, court })))
          .filter(game => game.slot > changedSlot && !hasGame(nextCompletedGames, game.slot, game.court) && !hasGame(nextLiveGames, game.slot, game.court))
          .slice(0, 8)
          .map(game => {
            const players = courtPlayersForLog(nextResult!, game);
            return { ...game, players, blockedByLive: players.filter(name => blockedNames.has(name)) };
          }),
      });
    }
    const queuedSubstitution = queuedPreviewGame && nextResult
      ? substituteQueuedGame(nextResult, queuedPreviewGame, options.overridePlayers ?? players, livePlayerNamesFor(nextLiveGames, nextResult), new Set(nextSuspendedPlayerNames))
      : null;
    if (shouldPromote && nextResult) {
      liveQueueDebug('queue:substitution-preview', {
        flowId,
        queuedGame: queuedPreviewGame ? describeGames([queuedPreviewGame], nextResult)[0] : null,
        activePlayerNames: [...livePlayerNamesFor(nextLiveGames, nextResult)].sort(),
        conflictingPlayers: queuedSubstitution?.conflictingPlayers ?? [],
        unavailablePlayers: queuedSubstitution?.unavailablePlayers ?? [],
        replacements: queuedSubstitution?.replacements ?? [],
        substitutedGame: queuedSubstitution ? describeGames([queuedSubstitution.game], nextResult)[0] : null,
        queueChoice: options.queueChoice ?? null,
      });
    }
    if (options.queueChoice === 'substitute' && queuedSubstitution && queuedSubstitution.unavailablePlayers.length === 0) {
      nextLiveGames = addUniqueGame(nextLiveGames, queuedSubstitution.game);
    }
    if (options.queueChoice === 'lookahead' && options.queueGame) {
      nextLiveGames = addUniqueGame(nextLiveGames, options.queueGame);
    }
    // Keep the queued court identity stable while regeneration finds a playable
    // replacement for anyone who is still active on another court.
    const reservedQueuedGame = queuedSubstitution && queuedSubstitution.unavailablePlayers.length === 0 && options.queueChoice !== 'lookahead'
      ? queuedSubstitution.game
      : null;
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
      liveQueueDebug('queue:reservation-repeat-allowed', {
        queuedGame: describeGames([reservedQueuedGame], scheduleResult)[0],
        liveGames: describeGames(nextLiveGames, scheduleResult),
        completedGames: describeGames(nextCompletedGames, scheduleResult),
      });
    }
    const unavailableQueuedPlayers = queuedSubstitution?.conflictingPlayers ?? [];
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
      const gamesToPreserve = reservedQueuedGame && queuedSubstitution?.unavailablePlayers.length === 0 && reservedQueuedGame.slot === regenFromSlot && !hasGame(nextLiveGames, reservedQueuedGame.slot, reservedQueuedGame.court)
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
      liveQueueDebug('regenerate:start', {
        flowId,
        regenFromSlot,
        preservedLiveGames: describeGames(nextLiveGames, nextResult),
        preservedCompletedGames: describeGames(nextCompletedGames, nextResult),
        preservedReservation: reservedQueuedGame ? describeGames([reservedQueuedGame], nextResult)[0] : null,
        blockedPlayerNames: [...blockedForFirstSlot].sort(),
        forcedFirstSlot: forcedFirstSlot?.courts ?? null,
        targetCourts: forcedFirstSlot?.targetCourts ?? getCourtsPerSlot()[regenFromSlot - 1] ?? null,
      });
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
        liveQueueDebug('regenerate:failed', { flowId, regenFromSlot, liveGames: describeGames(nextLiveGames, nextResult), completedGames: describeGames(nextCompletedGames, nextResult) });
        return false;
      }
      const regeneratedSlots = regenerated.newResult.schedule
        .filter(slot => slot.slot >= regenFromSlot && slot.slot < regenFromSlot + 3)
        .map(slot => ({ slot: slot.slot, courts: slot.courts.map((court, index) => ({ court: index + 1, players: [...court.teamA, ...court.teamB].map(player => player.name) })) }));
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
      liveQueueDebug('regenerate:success', {
        flowId,
        regenFromSlot,
        liveGames: describeGames(nextLiveGames, nextResult),
        completedGames: describeGames(nextCompletedGames, nextResult),
        regeneratedSlots,
      });
      return true;
    };

    const nextSafeRegenSlot = (startSlot: number) => {
      let slot = startSlot;
      const skippedSlots: Array<{ slot: number; hasLive: boolean; hasCompleted: boolean; forceable: boolean }> = [];
      while (slot <= totalSlots) {
        const hasLive = nextLiveGames.some(game => game.slot === slot);
        const hasCompleted = nextCompletedGames.some(game => game.slot === slot);
        const forceable = Boolean(forcedLiveCourtsForSlot(slot, [...nextLiveGames, ...nextCompletedGames], nextResult));
        if ((!hasLive && !hasCompleted) || forceable) break;
        skippedSlots.push({ slot, hasLive, hasCompleted, forceable });
        slot++;
      }
      liveQueueDebug('queue:regen-boundary', {
        flowId,
        requestedStartSlot: startSlot,
        selectedSlot: slot,
        skippedSlots,
      });
      return slot;
    };

    const initialRegenSlot = nextSafeRegenSlot(changedSlot + 1);
    const shouldRegenerate = options.regenerate ?? Boolean(
      nextResult && (
        options.overrideResult ||
        newCompletedGames.length > completedGames.length ||
        Object.keys(extraPatch).length > 0 ||
        options.overridePlayers ||
        options.suspendedPlayerNames
      ),
    );
    liveQueueDebug('apply:regeneration-plan', {
      flowId,
      shouldRegenerate,
      initialRegenSlot,
      totalSlots,
      hasOverrideResult: Boolean(options.overrideResult),
      completedCountBefore: completedGames.length,
      completedCountAfter: newCompletedGames.length,
      extraPatchKeys: Object.keys(extraPatch),
      hasOverridePlayers: Boolean(options.overridePlayers),
      hasSuspensionUpdate: Boolean(options.suspendedPlayerNames),
    });
    if (shouldRegenerate && (regenerateFrom(initialRegenSlot) || initialRegenSlot > totalSlots)) {
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
        if (!queuedGame) {
          liveQueueDebug('queue:promotion-stop', {
            flowId,
            reason: 'no-playable-candidate',
            targetLiveCount,
            currentLiveCount: nextLiveGames.length,
            changedSlot,
            activePlayerNames: [...livePlayerNamesFor(nextLiveGames, nextResult)].sort(),
            remainingCandidates: nextResult?.schedule.flatMap(slot => slot.courts.map((_, court) => ({ slot: slot.slot, court })))
              .filter(game => game.slot > changedSlot && !hasGame(nextCompletedGames, game.slot, game.court) && !hasGame(nextLiveGames, game.slot, game.court))
              .slice(0, 8)
              .map(game => ({ ...game, players: courtPlayersForLog(nextResult!, game) })),
          });
          break;
        }
        const beforeCount = nextLiveGames.length;
        nextLiveGames = addUniqueGame(nextLiveGames, queuedGame);
        if (nextLiveGames.length === beforeCount) break;
        liveQueueDebug('queue:promote', {
          flowId,
          queuedGame: queuedPreviewGame ? describeGames([queuedPreviewGame], scheduleResult)[0] : null,
          promotedGame: describeGames([queuedGame], nextResult)[0],
          unavailableQueuedPlayers,
          beforeLiveGames: describeGames(nextLiveGames.slice(0, beforeCount), nextResult),
          afterLiveGames: describeGames(nextLiveGames, nextResult),
          completedGames: describeGames(nextCompletedGames, nextResult),
        });
        if (queuedSubstitution && queuedSubstitution.replacements.length > 0) {
          const queuedDescription = describeGames([queuedPreviewGame!], scheduleResult)[0]!;
          const promotedDescription = describeGames([queuedGame], nextResult)[0]!;
          const replacers = queuedSubstitution.replacements.map(item => item.replacer);
          const promotedWithLane = assignDisplayCourts([...nextLiveGames, queuedGame], displayCapacity)
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

    nextLiveGames = assignDisplayCourts(normalizeGameRefs(nextLiveGames, nextResult?.schedule ?? null, targetLiveCount), displayCapacity);
    patch.liveGames = nextLiveGames;
    patch.completedGames = nextCompletedGames;
    patch.suspendedPlayerNames = nextSuspendedPlayerNames;
    patch.fromSlot = firstIncomplete(nextCompletedGames, nextResult);
    const completionProgress = nextResult?.schedule.map(slot => ({
      slot: slot.slot,
      courtCount: slot.courts.length,
      completedCount: slot.courts.filter((_, court) => hasGame(nextCompletedGames, slot.slot, court)).length,
      liveCount: slot.courts.filter((_, court) => hasGame(nextLiveGames, slot.slot, court)).length,
    })).filter(slot => slot.completedCount > 0 || slot.liveCount > 0 || slot.slot <= Math.min(totalSlots, Math.max(priorFromSlot, patch.fromSlot ?? 1) + 1)) ?? [];
    const playerOccurrences = describeGames(nextLiveGames, nextResult).flatMap(game => game.players.map(player => ({ player, slot: game.slot, court: game.court })));
    const duplicateLivePlayers = playerOccurrences.filter((entry, index, all) => all.findIndex(other => other.player === entry.player) !== index);
    liveQueueDebug('apply:final', {
      flowId,
      changedSlot,
      liveGames: describeGames(nextLiveGames, nextResult),
      completedGames: describeGames(nextCompletedGames, nextResult),
      fromSlot: patch.fromSlot,
      completionProgress,
      duplicateLivePlayers,
      regenerated: Boolean(patch.result),
    });
    patchState(patch);
  }, [completedGames, describeGames, firstIncomplete, forcedLiveCourtsForSlot, fromSlot, getCourtsPerSlot, livePlayerNamesFor, regenerate, result, suspendedPlayerNames, totalSlots, patchState, recordUndo]);

  const toggleLiveGame = useCallback((slotNum: number, court: number, displayCourt?: number) => {
    const flowId = nextQueueFlowId();
    const isLive = hasGame(liveGames, slotNum, court);
    const activeCapacity = liveCapacity;
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
      : addUniqueGame(liveGames, { slot: slotNum, court, ...(displayCourt != null ? { displayCourt } : {}) });
    const nextCompletedGames = isLive ? [...withoutCompleted, snapshotGame(slotNum, court)] : withoutCompleted;
    // Finishing replaces at most one game; new lanes still require an explicit Start.
    const targetLiveCount = Math.max(nextLiveGames.length, Math.min(activeCapacity, liveGames.length));
    liveQueueDebug('toggle', {
      flowId,
      clicked: { slot: slotNum, court },
      action: isLive ? 'complete' : 'start',
      beforeLiveGames: describeGames(liveGames),
      beforeCompletedGames: describeGames(completedGames),
      nextLiveGames: describeGames(nextLiveGames),
      nextCompletedGames: describeGames(nextCompletedGames),
    });
    if (isLive && result && nextLiveGames.length < targetLiveCount) {
      const decision = getQueuePromotionDecision({
        schedule: result.schedule,
        liveGames: nextLiveGames,
        completedGames: nextCompletedGames,
        changedSlot: slotNum,
        suspendedPlayerNames,
      });
      liveQueueDebug('queue:promotion-decision', {
        flowId,
        completedGame: describeGames([snapshotGame(slotNum, court)], result)[0],
        remainingLiveGames: describeGames(nextLiveGames, result),
        firstGame: decision.first ? describeGames([decision.first], result)[0] : null,
        firstBlockedPlayers: decision.firstBlockedPlayers,
        lookaheadGame: decision.lookahead ? describeGames([decision.lookahead], result)[0] : null,
        mode: decision.mode,
      });
      if (decision.first && decision.firstBlockedPlayers.length > 0) {
        const substitution = substituteQueuedGame(
          result,
          decision.first,
          players,
          livePlayerNamesFor(nextLiveGames, result),
          new Set(suspendedPlayerNames),
        );
        const completedGame = liveGames.find(game => gameMatches(game, slotNum, court));
        const completedCourt = (completedGame?.displayCourt ?? court) + 1;
        setQueuePromotionPrompt({
          flowId,
          prompt: {
            completedCourt,
            firstGame: describeGames([decision.first], result)[0]!,
            blockedPlayers: decision.firstBlockedPlayers,
            lookaheadGame: decision.lookahead ? describeGames([decision.lookahead], result)[0]! : null,
            replacements: substitution?.replacements ?? [],
          },
          nextLiveGames,
          nextCompletedGames,
          lookaheadGame: decision.lookahead ? { ...decision.lookahead, players: describeGames([decision.lookahead], result)[0]!.players } : null,
          changedSlot: slotNum,
          targetLiveCount,
        });
        liveQueueDebug('queue:prompt-open', {
          flowId,
          completedCourt,
          firstGame: describeGames([decision.first], result)[0],
          blockedPlayers: decision.firstBlockedPlayers,
          lookaheadGame: decision.lookahead ? describeGames([decision.lookahead], result)[0] : null,
          replacements: substitution?.replacements ?? [],
        });
        return;
      }
    }
    applyLiveGamesUpdate(nextLiveGames, slotNum, nextCompletedGames, {}, isLive ? { targetLiveCount, flowId } : { flowId });
  }, [applyLiveGamesUpdate, completedGames, describeGames, liveCapacity, liveGames, livePlayerNamesFor, players, result, snapshotGame, suspendedPlayerNames, patchState]);

  const resolveQueuePromotion = useCallback((choice: 'lookahead' | 'substitute') => {
    if (!queuePromotionPrompt) return;
    const pending = queuePromotionPrompt;
    liveQueueDebug('queue:prompt-choice', {
      flowId: pending.flowId ?? null,
      choice,
      selectedGame: choice === 'lookahead' ? pending.lookaheadGame : null,
      queuedFirstGame: pending.prompt.firstGame,
      blockedPlayers: pending.prompt.blockedPlayers,
      replacementsPreview: pending.prompt.replacements,
      liveGamesBeforeApply: describeGames(pending.nextLiveGames),
      completedGamesBeforeApply: describeGames(pending.nextCompletedGames),
    });
    applyLiveGamesUpdate(pending.nextLiveGames, pending.changedSlot, pending.nextCompletedGames, {}, {
      targetLiveCount: pending.targetLiveCount,
      queueChoice: choice,
      queueGame: choice === 'lookahead' ? pending.lookaheadGame : null,
      flowId: pending.flowId,
    });
    setQueuePromotionPrompt(null);
  }, [applyLiveGamesUpdate, describeGames, queuePromotionPrompt, patchState]);

  const cancelQueuePromotion = useCallback(() => {
    if (queuePromotionPrompt) {
      liveQueueDebug('queue:prompt-cancel', {
        flowId: queuePromotionPrompt.flowId ?? null,
        queuedGame: queuePromotionPrompt.prompt.firstGame,
        selectedAlternative: queuePromotionPrompt.prompt.lookaheadGame,
      });
    }
    patchState({ queuePromotionPrompt: null });
  }, [patchState, queuePromotionPrompt]);

  const applySessionChange = useCallback((change: NonNullable<typeof pendingSessionChange>) => {
    if (!result) return;
    const boundarySlot = Math.max(change.boundarySlot, getFutureChangeBoundary(liveGames, completedGames));
    if (boundarySlot > totalSlots) {
      setSessionChangeNotice('No upcoming slot can be changed. Current and completed games are unchanged.');
      return;
    }
    const patch = reconcileFutureSessionChange({
      result, totalSlots, boundarySlot, targetCapacity: change.targetCapacity,
      overridePlayers: change.overridePlayers, courtOverrides: change.courtOverrides,
      liveGames, completedGames, scores, regenerate,
    });
    if (!patch) {
      setSessionChangeNotice('Unable to update upcoming games. No session changes were applied.');
      return;
    }
    recordUndo();
    patchState(patch);
    if (isConfirmed && change.archiveOnConfirm) onConfirmedScheduleChange?.(result);
    setQueueAdjustment(null);
    setSessionChangeNotice(`${change.description} from slot ${boundarySlot}. ${change.targetCapacity} court${change.targetCapacity === 1 ? '' : 's'} planned; ${liveGames.length} currently active. Current and completed games are unchanged.`);
  }, [completedGames, isConfirmed, liveGames, onConfirmedScheduleChange, patchState, regenerate, result, scores, totalSlots, recordUndo]);

  const requestSessionChange = useCallback((change: NonNullable<typeof pendingSessionChange>) => {
    if (change.boundarySlot > totalSlots) {
      setSessionChangeNotice('No upcoming slot can be changed. Current and completed games are unchanged.');
    } else if (isConfirmed) setPendingSessionChange(change);
    else applySessionChange(change);
  }, [applySessionChange, isConfirmed, totalSlots, patchState]);

  const confirmSessionChange = useCallback(() => {
    if (pendingSessionChange) applySessionChange(pendingSessionChange);
    setPendingSessionChange(null);
  }, [applySessionChange, pendingSessionChange, patchState]);
  const cancelSessionChange = useCallback(() => patchState({ pendingSessionChange: null }), [patchState]);
  const resetSessionChanges = useCallback(() => patchState({ ...EMPTY_QUEUE_STATE, undoSnapshot: null }), [patchState]);

  const regenerateUpcoming = useCallback((requestedSlot: number, targetCourts: number) => {
    if (!result || !Number.isInteger(requestedSlot) || !Number.isInteger(targetCourts) || targetCourts < 0 || targetCourts > 5) return;
    const boundarySlot = Math.max(changeSlot, requestedSlot);
    const overrides = targetCourts > 0 ? { ...courtOverrides, [boundarySlot]: targetCourts } : courtOverrides;
    requestSessionChange({
      boundarySlot, targetCapacity: getCourtsPerSlot(overrides)[boundarySlot - 1] ?? liveCapacity,
      courtOverrides: overrides, description: 'Upcoming games updated',
      archiveOnConfirm: true,
    });
  }, [changeSlot, courtOverrides, getCourtsPerSlot, liveCapacity, requestSessionChange, result]);

  const adjustCourtsAtSlot = useCallback((requestedSlot: number, delta: number) => {
    if (!result || !Number.isInteger(requestedSlot)) return;
    const boundarySlot = Math.max(changeSlot, requestedSlot);
    const currentCapacity = getCourtsPerSlot()[boundarySlot - 1] ?? liveCapacity;
    const targetCapacity = Math.max(1, Math.min(5, currentCapacity + delta));
    if (targetCapacity === currentCapacity) return;
    requestSessionChange({
      boundarySlot, targetCapacity, courtOverrides: { ...courtOverrides, [boundarySlot]: targetCapacity },
      description: delta > 0 ? 'Court added' : 'Court removed',
      archiveOnConfirm: true,
    });
  }, [changeSlot, courtOverrides, getCourtsPerSlot, liveCapacity, requestSessionChange, result]);

  const setPlayerLeaving = useCallback((index: number) => {
    if (!players[index]) return;
    requestSessionChange({
      boundarySlot: changeSlot, targetCapacity: liveCapacity, courtOverrides,
      overridePlayers: players.map((player, i) => i === index ? { ...player, leavesAt: changeSlot - 2 } : player),
      description: `${players[index]!.name} leaving`,
    });
  }, [changeSlot, courtOverrides, liveCapacity, players, requestSessionChange]);

  const setPlayerJoining = useCallback((index: number) => {
    if (!canPlayerJoin || !players[index]) return;
    requestSessionChange({
      boundarySlot: changeSlot, targetCapacity: liveCapacity, courtOverrides,
      overridePlayers: players.map((player, i) => i === index ? { ...player, availFrom: changeSlot - 1 } : player),
      description: `${players[index]!.name} here now`,
    });
  }, [canPlayerJoin, changeSlot, courtOverrides, liveCapacity, players, requestSessionChange]);

  const setPlayerBack = useCallback((index: number) => {
    if (!players[index]) return;
    requestSessionChange({
      boundarySlot: changeSlot, targetCapacity: liveCapacity, courtOverrides,
      overridePlayers: players.map((player, i) => i === index ? { ...player, leavesAt: null } : player),
      description: `${players[index]!.name} back`,
    });
  }, [changeSlot, courtOverrides, liveCapacity, players, requestSessionChange]);

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
    adjustCourtsAtSlot,
    blockedPlayerNames,
    changeSlot,
    liveCapacity,
    sessionChangeNotice,
    pendingSessionChange,
    confirmSessionChange,
    cancelSessionChange,
    resetSessionChanges,
    regenerateUpcoming,
    firstIncomplete,
    queueAdjustment,
    queuePromotionPrompt,
    resolveQueuePromotion,
    cancelQueuePromotion,
    setPlayerJoining,
    setPlayerLeaving,
    setPlayerBack,
    toggleLiveGame,
    togglePlayerSuspended,
  };
}
