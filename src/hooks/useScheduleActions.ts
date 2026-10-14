import { useCallback } from 'react';
import type { ForcedFirstSlot, GeneratorYield, Player } from '../algorithm/types';
import { extractState, generateSchedule, generateScheduleGen } from '../algorithm/scheduler';
import type { ScheduleOptions } from '../algorithm/scheduler';
import type { PlannerResult, PlannerState, RuntimePatch, ScoresMap, WinLossMap } from '../types';

interface RegeneratedPlan {
  newResult: PlannerResult;
  nextScores: ScoresMap;
}

interface ScheduleActionOptions {
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
  computeSkill: (name: string, level?: 1 | 2 | 3) => number;
  getPlayersWithAvailability: () => Player[];
  applyAvailability: (players: Player[]) => Player[];
  getCourtsPerSlot: () => number[];
  getScheduleOptions: (players: Player[]) => ScheduleOptions;
  patchState: (patch: RuntimePatch) => void;
  keepGamesBeforeSlot: (games: PlannerState['liveGames'], slot: number) => PlannerState['liveGames'];
}

export function useScheduleActions({
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
    patchState({ isGenerating: true, result: null, scheduleDirty: false, scores: {}, copied: false, genSlot: 0, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [], fromSlot: 1 });
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
    const gen = generateScheduleGen(playersWithSkill, totalSlots, getCourtsPerSlot(), 0, null, null, getScheduleOptions(playersWithSkill));
    let lastValue: GeneratorYield | null = null;
    function step() {
      const { value, done } = gen.next();
      if (value) {
        lastValue = value;
        patchState({ genSlot: value.schedule.length });
      }
      if (done) patchState({ result: lastValue, scheduleDirty: false, isGenerating: false });
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [computeSkill, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, isGenerating, patchState, players.length, totalSlots]);

  const runRegenerateFromSlotWithCourts = useCallback((targetFromSlot: number, targetCourts: number) => {
    if (players.length < 4 || !result) return;
    const playersWithSkill = getPlayersWithAvailability().map(p => ({ ...p, skill: computeSkill(p.name, p.level) }));
    const keptSlots = result.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const courtsArr = getCourtsPerSlot();
    if (targetCourts > 0) {
      for (let i = targetFromSlot - 1; i < totalSlots; i++) courtsArr[i] = targetCourts;
    }
    const newResult = generateSchedule(playersWithSkill, totalSlots, courtsArr, targetFromSlot - 1, stateSnapshot, null, getScheduleOptions(playersWithSkill));
    if (!newResult) return;
    const nextScores: ScoresMap = {};
    for (const key in scores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && scores[key]) nextScores[key] = scores[key];
    }
    patchState({ result: newResult, scheduleDirty: false, scores: nextScores, copied: false, isConfirmed: false, loadedPlanId: null, liveGames: keepGamesBeforeSlot(liveGames, targetFromSlot), completedGames: keepGamesBeforeSlot(completedGames, targetFromSlot), suspendedPlayerNames: [], fromSlot: targetFromSlot, fromSlotCourts: targetCourts });
  }, [completedGames, computeSkill, getCourtsPerSlot, getPlayersWithAvailability, getScheduleOptions, keepGamesBeforeSlot, liveGames, patchState, players.length, result, scores, totalSlots]);

  const runRegenerateRemaining = useCallback(() => runRegenerateFromSlotWithCourts(fromSlot, fromSlotCourts), [fromSlot, fromSlotCourts, runRegenerateFromSlotWithCourts]);

  const regenerateRemaining = useCallback(() => {
    if (players.length < 4 || !result) return;
    if (isConfirmed) patchState({ pendingOverwrite: 'regenerateRemaining' });
    else runRegenerateRemaining();
  }, [isConfirmed, patchState, players.length, result, runRegenerateRemaining]);

  const adjustCourtsAtSlot = useCallback((slotNum: number, delta: number) => {
    if (!result) return;
    const slotData = result.schedule.find(s => s.slot === slotNum);
    const current = slotData ? slotData.courts.length : 0;
    const next = Math.max(1, Math.min(5, current + delta));
    if (next === current) return;
    if (isConfirmed) patchState({ fromSlot: slotNum, fromSlotCourts: next, pendingOverwrite: 'regenerateRemaining' });
    else runRegenerateFromSlotWithCourts(slotNum, next);
  }, [isConfirmed, patchState, result, runRegenerateFromSlotWithCourts]);

  const runClearSchedule = useCallback(() => patchState({ result: null, scheduleDirty: false, scores: {}, fromSlot: 1, isConfirmed: false, loadedPlanId: null, liveGames: [], completedGames: [], suspendedPlayerNames: [] }), [patchState]);
  const clearSchedule = useCallback(() => {
    if (isConfirmed) patchState({ pendingOverwrite: 'clear' });
    else runClearSchedule();
  }, [isConfirmed, patchState, runClearSchedule]);
  const confirmSchedule = useCallback(() => patchState({ isConfirmed: true }), [patchState]);
  const unconfirmSchedule = useCallback(() => patchState({ isConfirmed: false }), [patchState]);

  const doRegen = useCallback((targetFromSlot: number, overridePlayers: Player[] | null, blockedForFirstSlot: Set<string> = new Set(), overrideWinLoss: WinLossMap | null = null, overrideScores: ScoresMap | null = null, baseResult: PlannerResult | null = result, forcedFirstSlot: ForcedFirstSlot | null = null): RegeneratedPlan | null => {
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
    const keptSlots = baseResult.schedule.slice(0, targetFromSlot - 1);
    const stateSnapshot = extractState(keptSlots, playersWithSkill);
    const newResult = generateSchedule(playersWithSkill, totalSlots, getCourtsPerSlot(), targetFromSlot - 1, stateSnapshot, forcedFirstSlot, getScheduleOptions(playersWithSkill));
    if (!newResult) return null;
    const nextScores: ScoresMap = {};
    const sourceScores = overrideScores ?? scores;
    for (const key in sourceScores) {
      const match = key.match(/^s(\d+)c/);
      if (match && parseInt(match[1]!, 10) < targetFromSlot && sourceScores[key]) nextScores[key] = sourceScores[key];
    }
    return { newResult, nextScores };
  }, [applyAvailability, getCourtsPerSlot, getScheduleOptions, players, result, scores, totalSlots, winLoss]);

  return { runGenerate, runRegenerateFromSlotWithCourts, runRegenerateRemaining, regenerateRemaining, adjustCourtsAtSlot, runClearSchedule, clearSchedule, confirmSchedule, unconfirmSchedule, doRegen };
}
