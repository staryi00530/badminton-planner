import { computeSkill as computePlayerSkill } from '../utils/skill';
import { useCallback } from 'react';
import type { ForcedFirstSlot, GeneratorYield, Player } from '../algorithm/types';
import { generateSchedule, generateScheduleGen } from '../algorithm/scheduler';
import type { ScheduleOptions } from '../algorithm/scheduler';
import type { PlannerResult, PlannerState, RuntimePatch, ScoresMap, WinLossMap } from '../types';
import { initialLiveGamesForSchedule, liveQueueDebug } from '../utils/liveQueue';
import { getFutureChangeBoundary, reconcileFutureSessionChange } from '../utils/liveQueueTransition';
import type { GameRef } from '../utils/liveQueue';
import { historyScheduleState, makePlayedGame, mergePlayedGames, migratePlayedGames, remainingCourtsPerSlot, type PlayedGame } from '../utils/playedHistory';
import type { SlotResult } from '../algorithm/types';

interface RegeneratedPlan {
  newResult: PlannerResult;
  nextScores: ScoresMap;
}

interface ScheduleActionOptions {
  recordUndo: () => void;
  players: Player[];
  result: PlannerResult | null;
  totalSlots: number;
  isGenerating: boolean;
  isConfirmed: boolean;
  scores: ScoresMap;
  winLoss: WinLossMap;
  liveGames: PlannerState['liveGames'];
  completedGames: PlannerState['completedGames'];
  fromSlot: number;
  fromSlotCourts: number;
  courtOverrides?: Record<number, number>;
  suspendedPlayerNames?: string[];
  scheduleDirty?: boolean;
  loadedPlanId?: number | null;
  activeTab?: PlannerState['activeTab'];
  playedGames?: PlayedGame[];
  historyEpoch?: number;
  computeSkill: (name: string, level?: 1 | 2 | 3 | 4 | 5) => number;
  getPlayersWithAvailability: () => Player[];
  applyAvailability: (players: Player[]) => Player[];
  getCourtsPerSlot: (overrides?: Record<number, number>) => number[];
  getScheduleOptions: (players: Player[]) => ScheduleOptions;
  patchState: (patch: RuntimePatch) => void;
  keepGamesBeforeSlot: (games: PlannerState['liveGames'], slot: number) => PlannerState['liveGames'];
}

/** Current-plan completions occupy protected prefix courts; earlier plans consume nominal budget. */
export function remainingPlanCourts(base: PlannerResult, history: PlayedGame[], nominal: number[]): number[] {
  return remainingCourtsPerSlot(history.filter(game => game.planId !== (base.planId ?? 'legacy')), nominal);
}

/** Preserve the prefix for display, but seed decisions only from completed/live reality. */
export function regenerationState(base: PlannerResult, players: Player[], completed: GameRef[], actual: GameRef[],
  scores: ScoresMap, history: PlayedGame[], targetSlot: number) {
  const retained = migratePlayedGames(base, players, completed.filter(ref => ref.slot < targetSlot), scores, history);
  const provisional = actual.filter(ref => ref.slot < targetSlot).flatMap((ref, index) => {
    const record = makePlayedGame(base, players, ref, scores, actual, index);
    return record ? [record] : [];
  });
  return historyScheduleState(mergePlayedGames(retained, provisional), players, base.schedule.slice(0, targetSlot - 1));
}

function logRosterSnapshot(players: Player[], phase: 'initial-generation' | 'regeneration', fromSlot: number) {
  liveQueueDebug('roster:snapshot', {
    phase,
    fromSlot,
    players: players.map(({ name, gender, level, availFrom, availTo }) => ({
      name,
      gender,
      level: level ?? null,
      availFrom,
      availTo,
    })),
  });
}

export function useScheduleActions({
  recordUndo,
  players,
  result,
  totalSlots,
  isGenerating,
  isConfirmed,
  scores,
  winLoss,
  liveGames,
  completedGames,
  fromSlot,
  fromSlotCourts,
  courtOverrides = {},
  suspendedPlayerNames = [],
  scheduleDirty = false,
  loadedPlanId = null,
  activeTab = 'setup',
  playedGames = [],
  historyEpoch = 0,
  computeSkill,
  getPlayersWithAvailability,
  applyAvailability,
  getCourtsPerSlot,
  getScheduleOptions,
  patchState,
  keepGamesBeforeSlot,
}: ScheduleActionOptions) {
  const runGenerate = useCallback((resetHistory = false) => {
    if (players.length < 4 || isGenerating) return;
    const retained = resetHistory ? [] : migratePlayedGames(result, players, completedGames, scores, playedGames);
    const nominalCourts = getCourtsPerSlot({});
    const courtsPerSlot = remainingCourtsPerSlot(retained, nominalCourts);
    const firstIndex = courtsPerSlot.findIndex(count => count > 0);
    if (firstIndex < 0) { patchState({ sessionChangeNotice: 'No remaining games in this session. Extend the session or choose Reset history to start a fresh block.' }); return; }
    recordUndo();
    // Keep the prior plan/history intact until the replacement is fully generated.
    patchState({ isGenerating: true, genSlot: 0, sessionChangeNotice: null });
    const planId = crypto.randomUUID();
    let lastValue: GeneratorYield | null = null;
    let gen: ReturnType<typeof generateScheduleGen>;
    const fail = (error: unknown) => {
      const failedSlot = (lastValue?.schedule.length ?? 0) + 1;
      liveQueueDebug('generate:failed', { failedSlot, totalSlots, playerCount: players.length,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      patchState({ ...(result ? { result } : {}), scores, liveGames, completedGames, courtOverrides, suspendedPlayerNames,
        fromSlot, fromSlotCourts, isConfirmed, scheduleDirty, loadedPlanId, activeTab,
        isGenerating: false, genSlot: 0,
        sessionChangeNotice: `Generation failed at slot ${failedSlot} of ${totalSlots}. ${result ? 'Your previous schedule was restored.' : 'No schedule was saved.'} Try again, or download debug logs if it repeats.`,
      });
    };
    function step() {
      try {
        const { value, done } = gen.next();
        if (value) {
          lastValue = value;
          liveQueueDebug('generate:progress', { completedSlots: value.schedule.length, totalSlots });
          patchState({ genSlot: value.schedule.length });
        }
        if (done) {
          const newResult = lastValue ? { ...lastValue, planId } : null;
          const initialLiveGames = newResult
            ? initialLiveGamesForSchedule(newResult, nominalCourts[firstIndex] ?? 0)
            : [];
          liveQueueDebug('generate:complete', { completedSlots: lastValue?.schedule.length ?? 0, totalSlots });
          patchState({ result: newResult, playedGames: retained, historyEpoch: resetHistory ? historyEpoch + 1 : historyEpoch,
            liveGames: initialLiveGames, completedGames: [], scores: {}, courtOverrides: {}, suspendedPlayerNames: [],
            fromSlot: firstIndex + 1, fromSlotCourts: 0, activeTab: newResult ? 'live' : 'setup', scheduleDirty: false, isGenerating: false,
            copied: false, isConfirmed: false, loadedPlanId: null,
          });
        }
        else requestAnimationFrame(step);
      } catch (error) { fail(error); }
    }
    try {
      const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
      const options = { ...getScheduleOptions(playersWithSkill), consumedSlots: courtsPerSlot.flatMap((count, i) => count === 0 ? [i + 1] : []) };
      const snapshot = historyScheduleState(retained, playersWithSkill);
      const prefix: SlotResult[] = Array.from({ length: firstIndex }, (_, index) => ({ slot: index + 1, courts: [], sitting: [], repeatedCourts: [],
        playerState: playersWithSkill.map((p, i) => ({ name: p.name, gender: p.gender, total: snapshot.gamesPlayed[i] ?? 0,
          conPlayed: snapshot.consecutivePlayed[i] ?? 0, conRested: snapshot.consecutiveRested[i] ?? 0, playing: false, available: false })),
      }));
      snapshot.keptSlots = prefix;
      logRosterSnapshot(playersWithSkill, 'initial-generation', 1);
      liveQueueDebug('generate:start', { totalSlots, courtsPerSlot, playerCount: playersWithSkill.length, options });
      gen = generateScheduleGen(playersWithSkill, totalSlots, courtsPerSlot, firstIndex, snapshot, null, options);
      requestAnimationFrame(step);
    } catch (error) { fail(error); }
  }, [computeSkill, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, isGenerating, patchState, players, totalSlots, result, scores, liveGames, completedGames, courtOverrides, suspendedPlayerNames, fromSlot, fromSlotCourts, isConfirmed, scheduleDirty, loadedPlanId, activeTab, playedGames, historyEpoch, recordUndo]);

  const runRegenerateFromSlotWithCourts = useCallback((targetFromSlot: number, targetCourts: number) => {
    const fail = (reason: string) => { liveQueueDebug('regenerate:blocked', { reason, targetFromSlot, targetCourts, totalSlots }); patchState({ sessionChangeNotice: reason }); };
    if (players.length < 4 || !result) { fail('Add at least four eligible players and generate a schedule before regenerating games.'); return; }
    if (!Number.isInteger(targetFromSlot) || !Number.isInteger(targetCourts) || targetFromSlot < 1 || targetCourts < 0 || targetCourts > 5) { fail('Choose a valid starting slot and between one and five courts.'); return; }
    let boundarySlot = Math.max(targetFromSlot, getFutureChangeBoundary(liveGames, completedGames));
    if (boundarySlot > totalSlots) { fail('No upcoming slot can be regenerated. Extend the session duration to add more games.'); return; }
    const nextOverrides = targetCourts > 0 ? { ...courtOverrides, [boundarySlot]: targetCourts } : courtOverrides;
    const nominalCourts = getCourtsPerSlot(nextOverrides);
    const courtsArr = remainingPlanCourts(result, playedGames, nominalCourts);
    const playableIndex = courtsArr.findIndex((count, index) => index >= boundarySlot - 1 && count > 0);
    if (playableIndex < 0) {
      fail('No remaining games in this session. Extend the session or choose Reset history to start a fresh block.');
      return;
    }
    boundarySlot = playableIndex + 1;
    const patch = reconcileFutureSessionChange({
      result, totalSlots, boundarySlot, targetCapacity: nominalCourts[boundarySlot - 1] ?? 1,
      courtOverrides: nextOverrides, liveGames, completedGames, scores,
      regenerate: () => {
        const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
        const snapshot = regenerationState(result, playersWithSkill, completedGames, [...completedGames, ...liveGames], scores, playedGames, boundarySlot);
        const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, boundarySlot - 1, snapshot, null, { ...getScheduleOptions(playersWithSkill), consumedSlots: courtsArr.flatMap((count, index) => count === 0 ? [index + 1] : []) });
        return newResult ? { newResult: { ...newResult, planId: result.planId }, nextScores: {} } : null;
      },
    });
    if (patch) {
      recordUndo();
      patchState({ ...patch, sessionChangeNotice: `Upcoming games regenerated from slot ${boundarySlot}. Current and completed games are unchanged.` });
      liveQueueDebug('regenerate:applied', { boundarySlot, totalSlots });
    } else fail('Unable to regenerate upcoming games with the current roster and availability. Review attendance and quarantine, then retry.');
  }, [completedGames, computeSkill, courtOverrides, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, liveGames, patchState, players.length, result, scores, totalSlots, recordUndo, playedGames]);

  const runRegenerateRemaining = useCallback(() => runRegenerateFromSlotWithCourts(fromSlot, fromSlotCourts), [fromSlot, fromSlotCourts, runRegenerateFromSlotWithCourts]);

  const regenerateRemaining = useCallback(() => {
    if (players.length < 4 || !result) return;
    if (isConfirmed) patchState({ pendingOverwrite: 'regenerateRemaining' });
    else runRegenerateRemaining();
  }, [isConfirmed, patchState, players.length, result, runRegenerateRemaining]);

  const runClearSchedule = useCallback(() => patchState({ result: null, activeTab: 'setup', scheduleDirty: false, scores: {}, fromSlot: 1, fromSlotCourts: 0, courtOverrides: {}, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [] }), [patchState]);
  const clearSchedule = useCallback(() => {
    if (isConfirmed) patchState({ pendingOverwrite: 'clear' });
    else runClearSchedule();
  }, [isConfirmed, patchState, runClearSchedule]);
  const confirmSchedule = useCallback(() => patchState({ isConfirmed: true }), [patchState]);
  const unconfirmSchedule = useCallback(() => patchState({ isConfirmed: false }), [patchState]);

  const doRegen = useCallback((targetFromSlot: number, overridePlayers: Player[] | null, blockedForFirstSlot: Set<string> = new Set(), overrideWinLoss: WinLossMap | null = null, overrideScores: ScoresMap | null = null, baseResult: PlannerResult | null = result, forcedFirstSlot: ForcedFirstSlot | null = null, overrideCourtOverrides?: Record<number, number>, actualGames: GameRef[] = [...completedGames, ...liveGames]): RegeneratedPlan | null => {
    if (!baseResult) return null;
    const basePlayers = overridePlayers ?? players;
    const targetSlotIdx = targetFromSlot - 1;
    const sourceWinLoss = overrideWinLoss ?? winLoss;
    const skillFor = (name: string, level?: Player['level']) => computePlayerSkill(basePlayers.find(p => p.name === name)?.statsKey ?? name, sourceWinLoss, level);
    const playersWithSkill = applyAvailability(basePlayers).map(p => ({ ...p, skill: skillFor(p.name, p.level), ...(blockedForFirstSlot.has(p.name) && targetSlotIdx >= p.availFrom && targetSlotIdx <= p.availTo ? { availFrom: Math.max(p.availFrom, targetSlotIdx + 1) } : {}) }));
    logRosterSnapshot(playersWithSkill, 'regeneration', targetFromSlot);
    const stateSnapshot = regenerationState(baseResult, playersWithSkill, completedGames, actualGames, overrideScores ?? scores, playedGames, targetFromSlot);
    const courtsArr = remainingPlanCourts(baseResult, playedGames, getCourtsPerSlot(overrideCourtOverrides));
    const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, targetFromSlot - 1, stateSnapshot, forcedFirstSlot, { ...getScheduleOptions(playersWithSkill), consumedSlots: courtsArr.flatMap((count, index) => count === 0 ? [index + 1] : []) });
    if (!newResult) return null;
    const nextScores: ScoresMap = {};
    const sourceScores = overrideScores ?? scores;
    for (const key in sourceScores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && sourceScores[key]) nextScores[key] = sourceScores[key];
    }
    return { newResult: { ...newResult, planId: baseResult.planId }, nextScores };
  }, [applyAvailability, getCourtsPerSlot, getScheduleOptions, players, result, scores, totalSlots, winLoss, liveGames, completedGames, playedGames]);

  return { runGenerate, runRegenerateFromSlotWithCourts, runRegenerateRemaining, regenerateRemaining, runClearSchedule, clearSchedule, confirmSchedule, unconfirmSchedule, doRegen };
}
