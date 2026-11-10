// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, renderHook, render, screen } from '@testing-library/react';
import { QueuePromotionModal } from '../components/PlannerModals';
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
      regenerate: args => regenerationFails ? null : actions.doRegen(args.targetFromSlot, args.overridePlayers ?? null, args.blockedForFirstSlot, args.overrideWinLoss, args.overrideScores, args.baseResult, args.forcedFirstSlot, args.courtOverrides, args.actualGames),
    });
    return { ...planner, ...queue, actions };
  });
  act(() => hook.result.current.patchState({ liveGames: initialLiveGamesForSchedule(plan, courts, Date.now()).map((game, displayCourt) => ({ ...game, displayCourt })) }));
  return hook;
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('useLiveQueue future session changes with the real scheduler', () => {
  it('proposes substitutions for a shared open court without changing saved progress and prefers actual waiting history', () => {
    const { result } = session(2);
    const plan = structuredClone(result.current.state.result!);
    const p = roster;
    plan.schedule[0]!.courts = [{ court: 1, teamA: [p[0]!, p[1]!], teamB: [p[2]!, p[3]!] }, { court: 2, teamA: [p[4]!, p[5]!], teamB: [p[6]!, p[7]!] }];
    plan.schedule[1]!.courts = [{ court: 1, teamA: [p[4]!, p[8]!], teamB: [p[9]!, p[10]!] }];
    plan.schedule[1]!.sitting = [p[0]!, p[11]!];
    act(() => result.current.patchState({ result: plan, players: p.map((player, i) => i === 11 ? { ...player, gender: 'F' } : i >= 12 ? { ...player, quarantined: true } : player), liveGames: [{ slot: 1, court: 1, displayCourt: 1 }], completedGames: [{ slot: 1, court: 0 }], fromSlot: 1 }));
    const before = result.current.state;
    act(() => result.current.prepareQueuePromotionForOpenCourt(1, 0));
    expect(result.current.state.liveGames).toEqual(before.liveGames);
    expect(result.current.state.completedGames).toEqual(before.completedGames);
    expect(result.current.state.result).toEqual(before.result);
    expect(result.current.queuePromotionPrompt?.prompt.replacements).toContainEqual({ replacee: 'P5', replacer: 'P12', gamesWaited: 1 });
    render(createElement(QueuePromotionModal, { prompt: result.current.queuePromotionPrompt!.prompt, onUseLookahead: () => {}, onSubstitute: () => {}, onCancel: () => {} }));
    expect(screen.getByText(/1 games waited/)).toBeInTheDocument();
  });
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
          { name: 'P1', gender: 'F', level: 5, availFrom: 2, availTo: 5 },
          { name: 'P2', gender: 'M', level: 3, availFrom: 0, availTo: 5 },
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
          { name: 'P1', gender: 'F', level: 5, availFrom: 2, availTo: 5 },
          { name: 'P2', gender: 'M', level: 3, availFrom: 0, availTo: 5 },
        ]),
      }),
    }));
  });

  it('logs a queued substitution only when its replacement lineup is promoted', () => {
    const { result } = session(2);
    const plan = structuredClone(result.current.state.result!);
    const secondLiveCourt = plan.schedule[0]!.courts[1]!;
    const blockedPlayer = secondLiveCourt.teamA[0]!;
    const queuedCourt = plan.schedule[1]!.courts[0]!;
    queuedCourt.teamA[0] = { ...blockedPlayer };

    act(() => result.current.patchState({
      result: plan,
      liveGames: [
        { slot: 1, court: 0, displayCourt: 0 },
        { slot: 1, court: 1, displayCourt: 1 },
      ],
    }));
    act(() => result.current.toggleLiveGame(1, 0));
    expect(result.current.queuePromotionPrompt).not.toBeNull();
    act(() => result.current.resolveQueuePromotion('substitute'));

    const logs = JSON.parse(exportLiveQueueLogs()).logs;
    const applied = [...logs].reverse().find((event: { label: string }) => event.label === 'queue:substitution-applied');
    expect(applied).toBeDefined();
    expect(applied.details.queuedGame.players).toContain(blockedPlayer.name);
    expect(applied.details.replacements).toContainEqual({ replacee: blockedPlayer.name, replacer: expect.any(String), gamesWaited: expect.any(Number) });
    expect(applied.details.promotedGame.players).not.toContain(blockedPlayer.name);
    expect(applied.details.promotedGame.court).toBe(1);
    expect(applied.details.promotedGame.displayCourt).toBe(1);
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
        if (action === 'suspend') q.togglePlayerQuarantined(0);
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
      expect(result.current.state.courtOverrides).toEqual(before.courtOverrides);
      expect(result.current.state.result).toBe(before.result);
      expect(result.current.state.sessionChangeNotice).toMatch(/valid/i);
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

describe('persistent quarantine', () => {
  it('keeps current games intact, excludes from every future regeneration and restores explicitly', () => {
    const { result } = session(2);
    const before = result.current.state;
    const name = before.liveGames[0]!.players![0]!;
    const idx = before.players.findIndex(p => p.name === name);
    act(() => result.current.togglePlayerQuarantined(idx));
    expect(result.current.state.players[idx]!.quarantined).toBe(true);
    expect(result.current.state.liveGames).toEqual(before.liveGames);
    expect(result.current.state.result!.schedule[0]!.courts.map(c => [...c.teamA, ...c.teamB].map(p => p.name))).toEqual(before.result!.schedule[0]!.courts.map(c => [...c.teamA, ...c.teamB].map(p => p.name)));
    const futureNames = () => result.current.state.result!.schedule.slice(1).flatMap(s => s.courts.flatMap(c => [...c.teamA, ...c.teamB])).map(p => p.name);
    expect(futureNames()).not.toContain(name);
    act(() => result.current.regenerateUpcoming(2, 2));
    expect(futureNames()).not.toContain(name);
    act(() => result.current.togglePlayerQuarantined(idx));
    expect(result.current.state.players[idx]!.quarantined).toBe(false);
    expect(futureNames()).toContain(name);
  });

  it('quarantines even when regeneration fails and prevents starting a stale game', () => {
    const { result } = session(2, roster, true);
    const staleResult = result.current.state.result!;
    const game = staleResult.schedule[1]!.courts[0]!;
    const name = game.teamA[0].name;
    const idx = result.current.state.players.findIndex(p => p.name === name);
    act(() => result.current.togglePlayerQuarantined(idx));
    expect(result.current.state.players[idx]!.quarantined).toBe(true);
    const before = result.current.state.liveGames;
    act(() => result.current.patchState({ liveGames: [], result: staleResult }));
    act(() => result.current.toggleLiveGame(2, 0));
    expect(result.current.state.liveGames).toEqual([]);
    expect(before.length).toBe(2);
  });
});

it('retains the live court when quarantine leaves fewer than four eligible players', () => {
  const { result } = session(1, roster.slice(0, 4));
  const before = result.current.state.liveGames;
  act(() => result.current.togglePlayerQuarantined(0));
  expect(result.current.state.liveGames).toEqual(before);
  expect(result.current.state.result!.schedule[0]!.courts).toHaveLength(1);
  expect(result.current.state.result!.schedule.slice(1).every(s => s.courts.length === 0)).toBe(true);
});

it('removes quarantined upcoming courts in sparse live slots while preserving live lineup and scores', () => {
  const { result } = session(2);
  const before = result.current.state;
  const live = before.liveGames[1]!;
  const name = before.result!.schedule[0]!.courts[0]!.teamA[0].name;
  const idx = before.players.findIndex(p => p.name === name);
  act(() => result.current.patchState({ liveGames: [live], scores: { s1c1: { a: '12', b: '10', applied: false, teamA: [], teamB: [] } } }));
  act(() => result.current.togglePlayerQuarantined(idx));
  const state = result.current.state;
  expect(state.liveGames[0]!.players).toEqual(live.players);
  expect(state.liveGames[0]!.displayCourt).toBe(live.displayCourt);
  const liveKey = state.liveGames[0]!;
  expect(state.scores[`s1c${liveKey.court}`]).toMatchObject({ a: '12', b: '10', applied: false, teamA: [], teamB: [] });
  const protectedKeys = new Set([...state.liveGames, ...state.completedGames].map(g => `${g.slot}:${g.court}`));
  expect(state.result!.schedule.flatMap(slot => slot.courts.filter((_, c) => !protectedKeys.has(`${slot.slot}:${c}`)).flatMap(c => [...c.teamA, ...c.teamB])).map(p => p.name)).not.toContain(name);
});

it('preserves ongoing games across different slots during quarantine', () => {
  const { result } = session(2);
  const plan = result.current.state.result!;
  const court = plan.schedule[1]!.courts[1]!;
  const later = { slot: 2, court: 1, displayCourt: 1, players: [...court.teamA, ...court.teamB].map(p => p.name) };
  const name = later.players[0]!;
  const idx = result.current.state.players.findIndex(p => p.name === name);
  act(() => result.current.patchState({ liveGames: [result.current.state.liveGames[0]!, later], scores: { s2c1: { a: '17', b: '15', applied: false, teamA: [], teamB: [] } } }));
  act(() => result.current.togglePlayerQuarantined(idx));
  const live = result.current.state.liveGames.find(g => g.slot === 2)!;
  const afterCourt = result.current.state.result!.schedule[1]!.courts[live.court]!;
  expect(live.players).toEqual(later.players);
  expect([...afterCourt.teamA, ...afterCourt.teamB].map(p => p.name)).toEqual(later.players);
  expect(result.current.state.scores[`s2c${live.court}`]).toMatchObject({ a: '17', b: '15', applied: false, teamA: [], teamB: [] });
});

it('starts replacement timers once, keeps other court timers and restores start times on Undo and refresh',()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 try {
  const hook=session(2);const before=hook.result.current.state.liveGames;
  expect(before.map(g=>g.startedAt)).toEqual([1000,1000]);
  clock.mockReturnValue(5000);
  act(()=>hook.result.current.toggleLiveGame(before[0]!.slot,before[0]!.court));
  if(hook.result.current.state.queuePromotionPrompt) act(()=>hook.result.current.resolveQueuePromotion('lookahead'));
  const after=hook.result.current.state.liveGames;
  expect(after).toHaveLength(2);
  expect(after.find(g=>g.slot===before[1]!.slot&&g.court===before[1]!.court)?.startedAt).toBe(1000);
  expect(after.find(g=>!before.some(old=>old.slot===g.slot&&old.court===g.court))?.startedAt).toBe(5000);
  expect(hook.result.current.state.completedGames[0]?.startedAt).toBe(1000);
  act(()=>hook.result.current.restoreUndo());
  expect(hook.result.current.state.liveGames).toEqual(before);
  hook.unmount();clock.mockReturnValue(9000);
  const restored=renderHook(()=>usePlannerState());
  expect(restored.result.current.state.liveGames.map(g=>g.startedAt)).toEqual([1000,1000]);
  restored.unmount();
 }finally{clock.mockRestore();}
});
it('starts a timer for an explicit local Start without assigning a time to an old live game',()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(2000);
 try{
  const hook=session(2);
  act(()=>hook.result.current.patchState({liveGames:[{slot:1,court:1}]}));
  act(()=>hook.result.current.toggleLiveGame(1,0));
  expect(hook.result.current.state.liveGames.find(g=>g.court===0)?.startedAt).toBe(2000);
  expect(hook.result.current.state.liveGames.find(g=>g.court===1)?.startedAt).toBeUndefined();
  hook.unmount();
 }finally{clock.mockRestore();}
});
