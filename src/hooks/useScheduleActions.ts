import { useCallback } from 'react';
import type { ForcedFirstSlot, GeneratorYield, Player } from '../algorithm/types';
import { extractState, generateSchedule, generateScheduleGen } from '../algorithm/scheduler';
import type { ScheduleOptions } from '../algorithm/scheduler';
import type { PlannerResult, PlannerState, RuntimePatch, ScoresMap, WinLossMap } from '../types';
import { initialLiveGamesForSchedule, liveQueueDebug } from '../utils/liveQueue';
import { getFutureChangeBoundary, reconcileFutureSessionChange } from '../utils/liveQueueTransition';

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
  computeSkill: (name: string, level?: 1 | 2 | 3) => number;
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
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
    logRosterSnapshot(playersWithSkill, 'initial-generation', 1);
    const gen = generateScheduleGen(playersWithSkill, totalSlots, getCourtsPerSlot({}), 0, null, null, getScheduleOptions(playersWithSkill));
    let lastValue: GeneratorYield | null = null;
    function step() {
      const { value, done } = gen.next();
      if (value) {
        lastValue = value;
        patchState({ genSlot: value.schedule.length });
      }
      if (done) {
        const initialLiveGames = lastValue
          ? initialLiveGamesForSchedule(lastValue, getCourtsPerSlot({})[0] ?? 0)
          : [];
        patchState({ result: lastValue, liveGames: initialLiveGames, activeTab: lastValue ? 'live' : 'setup', scheduleDirty: false, isGenerating: false });
      }
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [computeSkill, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, isGenerating, patchState, players.length, totalSlots]);

  const runRegenerateFromSlotWithCourts = useCallback((targetFromSlot: number, targetCourts: number) => {
    if (players.length < 4 || !result) return;
    if (!Number.isInteger(targetFromSlot) || !Number.isInteger(targetCourts) || targetCourts < 0 || targetCourts > 5) return;
    const boundarySlot = Math.max(targetFromSlot, getFutureChangeBoundary(liveGames, completedGames));
    const nextOverrides = targetCourts > 0 ? { ...courtOverrides, [boundarySlot]: targetCourts } : courtOverrides;
    const courtsArr = getCourtsPerSlot(nextOverrides);
    const patch = reconcileFutureSessionChange({
      result, totalSlots, boundarySlot, targetCapacity: courtsArr[boundarySlot - 1] ?? 1,
      courtOverrides: nextOverrides, liveGames, completedGames, scores,
      regenerate: () => {
        const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
        const snapshot = extractState(result.schedule.slice(0, boundarySlot - 1), playersWithSkill);
        const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, boundarySlot - 1, snapshot, null, getScheduleOptions(playersWithSkill));
        return newResult ? { newResult, nextScores: {} } : null;
      },
    });
    if (patch) {
      recordUndo();
      patchState(patch);
    }
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

  const doRegen = useCallback((targetFromSlot: number, overridePlayers: Player[] | null, blockedForFirstSlot: Set<string> = new Set(), overrideWinLoss: WinLossMap | null = null, overrideScores: ScoresMap | null = null, baseResult: PlannerResult | null = result, forcedFirstSlot: ForcedFirstSlot | null = null, overrideCourtOverrides?: Record<number, number>): RegeneratedPlan | null => {
    if (!baseResult) return null;
    const basePlayers = overridePlayers ?? players;
    const targetSlotIdx = targetFromSlot - 1;
    const sourceWinLoss = overrideWinLoss ?? winLoss;
    const skillFor = (name: string, level?: 1 | 2 | 3) => {
      const wl = sourceWinLoss[name];
      const games = (wl?.wins ?? 0) + (wl?.losses ?? 0);
      if (level == null) return games === 0 ? 0.5 : wl!.wins / games;
      const prior = (level - 1) / 2;
      if (games === 0) return prior;
      return (prior * 3 + (wl!.wins / games) * games) / (3 + games);
    };
    const playersWithSkill = applyAvailability(basePlayers).map(p => ({ ...p, skill: skillFor(p.name, p.level), ...(blockedForFirstSlot.has(p.name) && targetSlotIdx >= p.availFrom && targetSlotIdx <= p.availTo ? { availFrom: Math.max(p.availFrom, targetSlotIdx + 1) } : {}) }));
    logRosterSnapshot(playersWithSkill, 'regeneration', targetFromSlot);
    const keptSlots = baseResult.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const newResult = generateSchedule(playersWithSkill, totalSlots, getCourtsPerSlot(overrideCourtOverrides), targetFromSlot - 1, stateSnapshot, forcedFirstSlot, getScheduleOptions(playersWithSkill));
    if (!newResult) return null;
    const nextScores: ScoresMap = {};
    const sourceScores = overrideScores ?? scores;
    for (const key in sourceScores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && sourceScores[key]) nextScores[key] = sourceScores[key];
    }
    return { newResult, nextScores };
  }, [applyAvailability, getCourtsPerSlot, getScheduleOptions, players, result, scores, totalSlots, winLoss]);

  return { runGenerate, runRegenerateFromSlotWithCourts, runRegenerateRemaining, regenerateRemaining, runClearSchedule, clearSchedule, confirmSchedule, unconfirmSchedule, doRegen };
}
