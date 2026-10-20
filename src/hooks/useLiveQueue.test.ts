// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlannerState } from './usePlannerState';
import { useScheduleActions } from './useScheduleActions';
import { useLiveQueue } from './useLiveQueue';
import { generateSchedule } from '../algorithm/scheduler';
import { applyAvailability } from '../utils/availability';
import { computeCourtsPerSlot } from '../utils/courtsPerSlot';
import { exportLiveQueueLogs, initialLiveGamesForSchedule, keepGamesBeforeSlot } from '../utils/liveQueue';
import type { Player } from '../algorithm/types';

const roster: Player[] = Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', level: 2, availFrom: 0, availTo: 5 }));

function session(courts = 3, players = roster, regenerationFails = false) {
  const plan = generateSchedule(players, 6, Array(6).fill(courts), 0, null, null, {}, () => 0.5)!;
  localStorage.setItem('bp-players', JSON.stringify(players));
  localStorage.setItem('bp-result', JSON.stringify(plan));
  localStorage.setItem('bp-numCourts', JSON.stringify(courts));
  localStorage.setItem('bp-totalMinutes', '90');
  localStorage.setItem('bp-staggerMode', JSON.stringify('custom'));
  const hook = renderHook(() => {
    const planner = usePlannerState();
    const { state, patchState } = planner;
    const getCourtsPerSlot = (courtOverrides = state.courtOverrides) => computeCourtsPerSlot({ totalSlots: 6, gameMinutes: 15, numCourts: state.numCourts, extraCourt: state.extraCourt, courtOverrides });
    const resolvePlayers = (players: Player[]) => applyAvailability(players, { staggerMode: state.staggerMode, totalSlots: 6 });
    const actions = useScheduleActions({
      ...state, totalSlots: 6, computeSkill: () => 0.5,
      getPlayersWithAvailability: () => resolvePlayers(state.players), applyAvailability: resolvePlayers,
      getCourtsPerSlot, getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot, recordUndo: planner.recordUndo,
    });
    const queue = useLiveQueue({
      ...state, totalSlots: 6, canPlayerJoin: true, getCourtsPerSlot, patchState, recordUndo: planner.recordUndo,
      regenerate: args => regenerationFails ? null : actions.doRegen(args.targetFromSlot, args.overridePlayers ?? null, args.blockedForFirstSlot, args.overrideWinLoss, args.overrideScores, args.baseResult, args.forcedFirstSlot, args.courtOverrides),
    });
    return { ...planner, ...queue, actions };
  });
  act(() => hook.result.current.patchState({ liveGames: initialLiveGamesForSchedule(plan, courts).map((game, displayCourt) => ({ ...game, displayCourt })) }));
  return hook;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('useLiveQueue future session changes with the real scheduler', () => {
  it('logs the roster attributes used for the initial schedule', () => {
    const players = roster.map((player, index) => index === 0
      ? { ...player, gender: 'F' as const, level: 3 as const, availFrom: 2, availTo: 5 }
      : player);
    const { result } = session(2, players);
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => {
      callback(0);
      return 0;
    };

    try {
      act(() => result.current.actions.runGenerate());
    } finally {
      window.requestAnimationFrame = requestFrame;
    }

    const logs = JSON.parse(exportLiveQueueLogs()).logs;
    expect(logs).toContainEqual(expect.objectContaining({
      label: 'roster:snapshot',
      details: expect.objectContaining({
        phase: 'initial-generation',
        fromSlot: 1,
        players: expect.arrayContaining([
          { name: 'P1', gender: 'F', level: 3, availFrom: 2, availTo: 5 },
          { name: 'P2', gender: 'M', level: 2, availFrom: 0, availTo: 5 },
        ]),
      }),
    }));
  });

  it('logs the roster attributes used for a regenerated schedule', () => {
    const players = roster.map((player, index) => index === 0
      ? { ...player, gender: 'F' as const, level: 3 as const, availFrom: 2, availTo: 5 }
      : player);
    const { result } = session(2, players);

    act(() => result.current.actions.doRegen(2, null));

    const logs = JSON.parse(exportLiveQueueLogs()).logs;
    expect(logs).toContainEqual(expect.objectContaining({
      label: 'roster:snapshot',
      details: expect.objectContaining({
        phase: 'regeneration',
        fromSlot: 2,
        players: expect.arrayContaining([
          { name: 'P1', gender: 'F', level: 3, availFrom: 2, availTo: 5 },
          { name: 'P2', gender: 'M', level: 2, availFrom: 0, availTo: 5 },
        ]),
      }),
    }));
  });

  it.each(['finish', 'start', 'leaving', 'joining', 'back', 'suspend', 'add court', 'remove court', 'regenerate', 'setup regenerate'])(
    'undo restores the exact runtime before %s', action => {
      const { result } = session(2);
      act(() => result.current.patchState({
        scores: { s3c0: { a: '21', b: '18', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } },
        winLoss: { P1: { wins: 1, losses: 0 } }, sessionChangeNotice: 'Previous notice',
        ...(action === 'start' ? { liveGames: [] } : {}),
      }));
      const before = structuredClone(result.current.state);
      act(() => {
        const q = result.current;
        if (action === 'finish' || action === 'start') q.toggleLiveGame(1, 0);
        if (action === 'leaving') q.setPlayerLeaving(0);
        if (action === 'joining') q.setPlayerJoining(0);
        if (action === 'back') q.setPlayerBack(0);
        if (action === 'suspend') q.togglePlayerSuspended(0);
        if (action === 'add court') q.adjustCourtsAtSlot(2, 1);
        if (action === 'remove court') q.adjustCourtsAtSlot(2, -1);
        if (action === 'regenerate') q.regenerateUpcoming(2, 3);
        if (action === 'setup regenerate') q.actions.runRegenerateFromSlotWithCourts(2, 3);
      });
      expect(result.current.state.undoSnapshot).toBeTruthy();
      expect(result.current.state).not.toEqual(before);
      act(() => result.current.restoreUndo());
      expect(result.current.state).toEqual({ ...before, undoSnapshot: null });
    },
  );

  it('restores a compound future availability/capacity change with pending confirmation and score/live snapshots', () => {
    const { result } = session(2);
    act(() => result.current.patchState({ isConfirmed: true }));
    act(() => result.current.setPlayerLeaving(0));
    act(() => result.current.patchState({
      pendingSessionChange: { ...result.current.pendingSessionChange!, targetCapacity: 3, courtOverrides: { 2: 3 }, archiveOnConfirm: true },
    }));
    const before = structuredClone(result.current.state);
    act(() => result.current.confirmSessionChange());
    expect(result.current.state.players[0]!.leavesAt).toBe(0);
    expect(result.current.state.courtOverrides).toEqual({ 2: 3 });
    act(() => result.current.restoreUndo());
    expect(result.current.state).toEqual({ ...before, undoSnapshot: null });
  });

  it('does not replace the previous undo on a failed regeneration or invalid capacity', () => {
    const { result } = session(3, roster, true);
    act(() => result.current.recordUndo());
    const snapshot = result.current.state.undoSnapshot;
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    act(() => result.current.actions.runRegenerateFromSlotWithCourts(2, 9));
    expect(result.current.state.undoSnapshot).toBe(snapshot);
  });
  it('applies a late arrival to the first mutable slot without changing live games', () => {
    const players = roster.slice(0, 12).map((p, i) => i === 11 ? { ...p, availFrom: 4 } : p);
    const { result } = session(3, players);
    const before = result.current.state;
    act(() => result.current.setPlayerJoining(11));
    expect(result.current.state.liveGames).toBe(before.liveGames);
    expect(result.current.state.result!.schedule[0]).toBe(before.result!.schedule[0]);
    expect(result.current.state.result!.schedule[1]!.courts).toHaveLength(3);
    expect(result.current.state.result!.schedule[1]!.courts.flatMap(c => [...c.teamA, ...c.teamB]).map(p => p.name)).toContain('P12');
    expect(result.current.sessionChangeNotice).toMatch(/P12.*slot 2.*3 courts/i);
  });

  it('applies departure and return only to future games and preserves history, scores and snapshots', () => {
    const { result } = session();
    act(() => result.current.patchState({
      completedGames: [result.current.state.liveGames[0]!], liveGames: result.current.state.liveGames.slice(1),
      scores: { s1c0: { a: '21', b: '19', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } },
    }));
    const before = result.current.state;
    const leaving = before.liveGames[0]!.players![0]!;
    const index = before.players.findIndex(p => p.name === leaving);
    act(() => result.current.setPlayerLeaving(index));
    const after = result.current.state;
    expect(after.liveGames).toBe(before.liveGames);
    expect(after.completedGames).toBe(before.completedGames);
    expect(after.scores).toEqual(before.scores);
    expect(after.result!.schedule[0]).toBe(before.result!.schedule[0]);
    expect(after.result!.schedule.slice(1).flatMap(s => s.courts.flatMap(c => [...c.teamA, ...c.teamB])).some(p => p.name === leaving)).toBe(false);
    act(() => result.current.setPlayerBack(index));
    expect(result.current.state.players[index]!.leavesAt).toBeNull();
    expect(result.current.state.result!.schedule.slice(1).flatMap(s => s.courts.flatMap(c => [...c.teamA, ...c.teamB])).some(p => p.name === leaving)).toBe(true);
  });

  it.each([2, 3, 4])('adds a court to %i courts, updates future capacity and preserves current games', courts => {
    const { result } = session(courts);
    const before = result.current.state;
    act(() => result.current.adjustCourtsAtSlot(1, 1));
    expect(result.current.state.liveGames).toBe(before.liveGames);
    expect(result.current.state.numCourts).toBe(courts);
    expect(result.current.state.courtOverrides).toEqual({ 2: courts + 1 });
    expect(result.current.state.result!.schedule.slice(1).map(s => s.courts.length)).toEqual(Array(5).fill(courts + 1));
  });

  it('drains excess live courts after removal without relabeling the remaining high lane', () => {
    const { result } = session(4);
    act(() => result.current.adjustCourtsAtSlot(2, -1));
    act(() => result.current.adjustCourtsAtSlot(2, -1));
    act(() => result.current.adjustCourtsAtSlot(2, -1));
    expect(result.current.state.liveGames).toHaveLength(4);
    const highLane = result.current.state.liveGames[3]!;
    for (const court of [0, 1, 2]) act(() => result.current.toggleLiveGame(1, court));
    expect(result.current.queuePromotionPrompt).toBeNull();
    expect(result.current.state.liveGames).toEqual([highLane]);
    expect(result.current.state.completedGames).toHaveLength(3);
    expect(result.current.state.result!.schedule[0]!.courts).toHaveLength(4);
    expect(result.current.state.result!.schedule.slice(1).every(s => s.courts.length === 1)).toBe(true);
  });

  it('does not fill multiple new lanes or expand queue lookahead when finishing after adding courts', () => {
    const { result } = session(2);
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    act(() => result.current.toggleLiveGame(1, 0));
    if (result.current.queuePromotionPrompt) act(() => result.current.resolveQueuePromotion('substitute'));
    expect(result.current.state.liveGames).toHaveLength(2);
    expect(result.current.state.completedGames).toHaveLength(1);
    expect(result.current.liveCapacity).toBe(4);
  });

  it('requires confirmation for a confirmed schedule and cancel leaves all state unchanged', () => {
    const { result } = session(2);
    act(() => result.current.patchState({ isConfirmed: true }));
    const before = result.current.state;
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    expect(result.current.state).toEqual({ ...before, pendingSessionChange: result.current.pendingSessionChange });
    expect(result.current.pendingSessionChange).toMatchObject({ boundarySlot: 2, targetCapacity: 3 });
    act(() => result.current.cancelSessionChange());
    expect(result.current.state).toEqual(before);
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    act(() => result.current.confirmSessionChange());
    expect(result.current.state.isConfirmed).toBe(false);
    expect(result.current.state.courtOverrides).toEqual({ 2: 3 });
  });

  it('keeps availability and capacity atomic when regeneration fails', () => {
    const { result } = session(3, roster, true);
    const before = result.current.state;
    act(() => result.current.setPlayerLeaving(0));
    expect(result.current.state).toEqual({ ...before, sessionChangeNotice: result.current.sessionChangeNotice });
    expect(result.current.sessionChangeNotice).toMatch(/unable to update/i);
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    expect(result.current.state).toEqual({ ...before, sessionChangeNotice: result.current.sessionChangeNotice });
    expect(result.current.sessionChangeNotice).toMatch(/no session changes were applied/i);
  });

  it('disallows changes after the last live slot', () => {
    const { result } = session();
    act(() => result.current.patchState({ liveGames: [{ slot: 6, court: 0 }] }));
    const before = result.current.state;
    act(() => result.current.setPlayerLeaving(0));
    expect(result.current.state).toEqual({ ...before, sessionChangeNotice: result.current.sessionChangeNotice });
    expect(result.current.sessionChangeNotice).toMatch(/no upcoming slot/i);
  });

  it('retains the live player snapshot and physical lane when a game finishes after removal', () => {
    const { result } = session(3);
    const snapshot = { slot: 1, court: 0, displayCourt: 2, players: ['P21', 'P22', 'P23', 'P24'] };
    act(() => result.current.patchState({ liveGames: [snapshot] }));
    act(() => result.current.adjustCourtsAtSlot(2, -1));
    expect(result.current.state.liveGames).toEqual([snapshot]);
    act(() => result.current.toggleLiveGame(1, 0));
    if (result.current.queuePromotionPrompt) act(() => result.current.resolveQueuePromotion('substitute'));
    expect(result.current.state.completedGames).toEqual([snapshot]);
  });

  it('rejects invalid Setup capacities without persisting invalid overrides', () => {
    const { result } = session(3);
    const before = result.current.state;
    for (const capacity of [-1, 6, 1.5, NaN]) {
      act(() => result.current.actions.runRegenerateFromSlotWithCourts(2, capacity));
      expect(result.current.state).toBe(before);
    }
  });

  it('keeps court commands within 1-5 without changing base settings', () => {
    const { result } = session(5);
    const before = result.current.state;
    act(() => result.current.adjustCourtsAtSlot(2, 1));
    expect(result.current.state).toBe(before);
    for (let i = 0; i < 4; i++) act(() => result.current.adjustCourtsAtSlot(2, -1));
    const atMinimum = result.current.state;
    act(() => result.current.adjustCourtsAtSlot(2, -1));
    expect(result.current.state).toBe(atMinimum);
    expect(result.current.state.courtOverrides).toEqual({ 2: 1 });
    expect(result.current.state.numCourts).toBe(5);
  });

  it('uses the same safe transition for Setup regeneration and persists capacity', () => {
    const { result } = session();
    const before = result.current.state;
    act(() => result.current.actions.runRegenerateFromSlotWithCourts(1, 5));
    expect(result.current.state.liveGames).toBe(before.liveGames);
    expect(result.current.state.result!.schedule[0]).toBe(before.result!.schedule[0]);
    expect(result.current.state.courtOverrides).toEqual({ 2: 5 });
    expect(result.current.state.result!.schedule[1]!.courts).toHaveLength(5);
  });
});
