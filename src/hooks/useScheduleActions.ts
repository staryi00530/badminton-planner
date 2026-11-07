import { computeSkill as computePlayerSkill } from '../utils/skill';
import { useCallback } from 'react';
import type { ForcedFirstSlot, GeneratorYield, Player } from '../algorithm/types';
import { extractState, generateSchedule, generateScheduleGen } from '../algorithm/scheduler';
import type { ScheduleOptions } from '../algorithm/scheduler';
import type { PlannerResult, PlannerState, RuntimePatch, ScoresMap, WinLossMap } from '../types';
import { initialLiveGamesForSchedule, liveQueueDebug } from '../utils/liveQueue';
import { getFutureChangeBoundary, reconcileFutureSessionChange } from '../utils/liveQueueTransition';
import { extractRuntimeScheduleState } from '../utils/runtimeScheduleState';
import type { GameRef } from '../utils/liveQueue';

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
  computeSkill: (name: string, level?: 1 | 2 | 3 | 4 | 5) => number;
  getPlayersWithAvailability: () => Player[];
  applyAvailability: (players: Player[]) => Player[];
  getCourtsPerSlot: (overrides?: Record<number, number>) => number[];
  getScheduleOptions: (players: Player[]) => ScheduleOptions;
  patchState: (patch: RuntimePatch) => void;
  keepGamesBeforeSlot: (games: PlannerState['liveGames'], slot: number) => PlannerState['liveGames'];
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
  computeSkill,
  getPlayersWithAvailability,
  applyAvailability,
  getCourtsPerSlot,
  getScheduleOptions,
  patchState,
  keepGamesBeforeSlot,
}: ScheduleActionOptions) {
  const runGenerate = useCallback(() => {
    if (players.length < 4 || isGenerating) return;
    patchState({ isGenerating: true, result: null, scheduleDirty: false, scores: {}, copied: false, genSlot: 0, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [], fromSlot: 1, fromSlotCourts: 0, courtOverrides: {} });
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
          const initialLiveGames = lastValue
            ? initialLiveGamesForSchedule(lastValue, getCourtsPerSlot({})[0] ?? 0)
            : [];
          liveQueueDebug('generate:complete', { completedSlots: lastValue?.schedule.length ?? 0, totalSlots });
          patchState({ result: lastValue, liveGames: initialLiveGames, activeTab: lastValue ? 'live' : 'setup', scheduleDirty: false, isGenerating: false });
        }
        else requestAnimationFrame(step);
      } catch (error) { fail(error); }
    }
    try {
      const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
      const courtsPerSlot = getCourtsPerSlot({});
      const options = getScheduleOptions(playersWithSkill);
      logRosterSnapshot(playersWithSkill, 'initial-generation', 1);
      liveQueueDebug('generate:start', { totalSlots, courtsPerSlot, playerCount: playersWithSkill.length, options });
      gen = generateScheduleGen(playersWithSkill, totalSlots, courtsPerSlot, 0, null, null, options);
      requestAnimationFrame(step);
    } catch (error) { fail(error); }
  }, [computeSkill, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, isGenerating, patchState, players.length, totalSlots, result, scores, liveGames, completedGames, courtOverrides, suspendedPlayerNames, fromSlot, fromSlotCourts, isConfirmed, scheduleDirty, loadedPlanId, activeTab]);

  const runRegenerateFromSlotWithCourts = useCallback((targetFromSlot: number, targetCourts: number) => {
    const fail = (reason: string) => { liveQueueDebug('regenerate:blocked', { reason, targetFromSlot, targetCourts, totalSlots }); patchState({ sessionChangeNotice: reason }); };
    if (players.length < 4 || !result) { fail('Add at least four eligible players and generate a schedule before regenerating games.'); return; }
    if (!Number.isInteger(targetFromSlot) || !Number.isInteger(targetCourts) || targetFromSlot < 1 || targetCourts < 0 || targetCourts > 5) { fail('Choose a valid starting slot and between one and five courts.'); return; }
    const boundarySlot = Math.max(targetFromSlot, getFutureChangeBoundary(liveGames, completedGames));
    if (boundarySlot > totalSlots) { fail('No upcoming slot can be regenerated. Extend the session duration to add more games.'); return; }
    const nextOverrides = targetCourts > 0 ? { ...courtOverrides, [boundarySlot]: targetCourts } : courtOverrides;
    const courtsArr = getCourtsPerSlot(nextOverrides);
    const patch = reconcileFutureSessionChange({
      result, totalSlots, boundarySlot, targetCapacity: courtsArr[boundarySlot - 1] ?? 1,
      courtOverrides: nextOverrides, liveGames, completedGames, scores,
      regenerate: () => {
        const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
        const snapshot = extractRuntimeScheduleState(result.schedule.slice(0, boundarySlot - 1), playersWithSkill, [...completedGames, ...liveGames]);
        const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, boundarySlot - 1, snapshot, null, getScheduleOptions(playersWithSkill));
        return newResult ? { newResult, nextScores: {} } : null;
      },
    });
    if (patch) {
      recordUndo();
      patchState({ ...patch, sessionChangeNotice: `Upcoming games regenerated from slot ${boundarySlot}. Current and completed games are unchanged.` });
      liveQueueDebug('regenerate:applied', { boundarySlot, totalSlots });
    } else fail('Unable to regenerate upcoming games with the current roster and availability. Review attendance and quarantine, then retry.');
  }, [completedGames, computeSkill, courtOverrides, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, liveGames, patchState, players.length, result, scores, totalSlots, recordUndo]);

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
    const keptSlots = baseResult.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractRuntimeScheduleState(keptSlots, playersWithSkill, actualGames);
    const newResult = generateSchedule(playersWithSkill, totalSlots, getCourtsPerSlot(overrideCourtOverrides), targetFromSlot - 1, stateSnapshot, forcedFirstSlot, getScheduleOptions(playersWithSkill));
    if (!newResult) return null;
    const nextScores: ScoresMap = {};
    const sourceScores = overrideScores ?? scores;
    for (const key in sourceScores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && sourceScores[key]) nextScores[key] = sourceScores[key];
    }
    return { newResult, nextScores };
  }, [applyAvailability, getCourtsPerSlot, getScheduleOptions, players, result, scores, totalSlots, winLoss, liveGames, completedGames]);

  return { runGenerate, runRegenerateFromSlotWithCourts, runRegenerateRemaining, regenerateRemaining, runClearSchedule, clearSchedule, confirmSchedule, unconfirmSchedule, doRegen };
}
