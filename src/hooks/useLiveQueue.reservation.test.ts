// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlannerState } from './usePlannerState';
import { useScheduleActions } from './useScheduleActions';
import { useLiveQueue } from './useLiveQueue';
import { generateSchedule } from '../algorithm/scheduler';
import { exportLiveQueueLogs, keepGamesBeforeSlot } from '../utils/liveQueue';
import { computeCourtsPerSlot } from '../utils/courtsPerSlot';
import type { Court, Player } from '../algorithm/types';

const players: Player[] = Array.from({ length: 28 }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, gender: 'M', level: 2, availFrom: 0, availTo: 6 }));
const court = (n: number, offset: number): Court => ({ court: n, teamA: [players[offset]!, players[offset + 1]!], teamB: [players[offset + 2]!, players[offset + 3]!] });
const names = (c: Court) => [...c.teamA, ...c.teamB].map(p => p.name);

function session(reservationSlot = 3) {
  const plan = generateSchedule(players, 6, [3, 3, 4, 4, 4, 4], 0, null, null, {}, () => 0.5)!;
  plan.schedule[0]!.courts = [court(1, 0), court(2, 4), court(3, 8)];
  plan.schedule[1]!.courts = [court(1, 12), court(2, 16), court(3, 20)];
  plan.schedule[reservationSlot - 1]!.courts = [court(1, 24), court(2, 0), court(3, 4), court(4, 8)];
  localStorage.setItem('bp-players', JSON.stringify(players));
  localStorage.setItem('bp-result', JSON.stringify(plan));
  localStorage.setItem('bp-numCourts', '4');
  localStorage.setItem('bp-totalMinutes', '90');
  localStorage.setItem('bp-staggerMode', JSON.stringify('custom'));
  const hook = renderHook(() => {
    const planner = usePlannerState();
    const { state, patchState } = planner;
    const getCourtsPerSlot = (overrides = state.courtOverrides) => computeCourtsPerSlot({ totalSlots: 6, gameMinutes: 15, numCourts: state.numCourts, extraCourt: state.extraCourt, courtOverrides: overrides });
    const actions = useScheduleActions({ ...state, totalSlots: 6, computeSkill: () => 0.5, getPlayersWithAvailability: () => state.players, applyAvailability: p => p, getCourtsPerSlot, getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot, recordUndo: planner.recordUndo });
    const queue = useLiveQueue({ ...state, totalSlots: 6, canPlayerJoin: true, getCourtsPerSlot, patchState, recordUndo: planner.recordUndo, regenerate: args => actions.doRegen(args.targetFromSlot, args.overridePlayers ?? null, args.blockedForFirstSlot, args.overrideWinLoss, args.overrideScores, args.baseResult, args.forcedFirstSlot, args.courtOverrides, args.actualGames) });
    return { ...planner, ...queue };
  });
  return { hook, plan };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('queued lineup reservation through regeneration', () => {
  it('keeps the queued slot-3 lineup when finishing slot 1 while all slot-2 games remain live', () => {
    const { hook, plan } = session();
    const retained = plan.schedule[1]!.courts.map((c, court) => ({ id: `live-${court}`, slot: 2, court, displayCourt: [0, 1, 3][court]!, startedAt: 1000 + court, players: names(c) }));
    const finished = { id: 'finishing', slot: 1, court: 2, displayCourt: 2, startedAt: 900, players: names(plan.schedule[0]!.courts[2]!) };
    act(() => hook.result.current.patchState({ result: plan, liveGames: [...retained, finished], completedGames: [{ slot: 1, court: 0 }, { slot: 1, court: 1 }], fromSlot: 1, numCourts: 4 }));
    act(() => hook.result.current.toggleLiveGame(1, 2));
    const state = hook.result.current.state;
    expect(state.liveGames).toHaveLength(4);
    expect(state.completedGames).toContainEqual(finished);

    const promoted = state.liveGames.find(g => g.slot === 3 && g.court === 0)!;
    expect(promoted).toMatchObject({ slot: 3, court: 0, displayCourt: 2, players: names(plan.schedule[2]!.courts[0]!) });
    expect(names(state.result!.schedule[2]!.courts[0]!)).toEqual(names(plan.schedule[2]!.courts[0]!));
    expect(state.result!.schedule[1]!.courts).toEqual(plan.schedule[1]!.courts);
    for (const game of retained) expect(state.liveGames).toContainEqual(game);
    const logs = JSON.parse(exportLiveQueueLogs()).logs;
    expect(logs).toContainEqual(expect.objectContaining({ label: 'queue:promote', details: expect.objectContaining({ reservationPreserved: true, reason: 'reserved-lineup', promotedPhysicalCourt: 3, reservedLineupBefore: expect.objectContaining({ slot: 3, court: 1, players: names(plan.schedule[2]!.courts[0]!) }), reservedLineupAfter: expect.objectContaining({ slot: 3, court: 1, players: names(plan.schedule[2]!.courts[0]!) }) }) }));
    expect(logs).toContainEqual(expect.objectContaining({ label: 'toggle', details: expect.objectContaining({ selectedCurrentGame: expect.objectContaining({ id: 'finishing', slot: 1, court: 3, physicalCourt: 3, startedAt: 900, renderedPlayers: finished.players }) }) }));
  });

  it('keeps recovered five-court capacity until an explicit removal at the preserved floor', () => {
    const { hook, plan } = session();
    const recovered = { ...plan, capacityProgressFloorSlot: 4 };
    const refs = [{ slot: 1, court: 0 }, { slot: 1, court: 1 }, { slot: 2, court: 0 }, { slot: 2, court: 1 }, { slot: 2, court: 2 }].map((g, displayCourt) => ({ ...g, displayCourt, players: names(plan.schedule[g.slot - 1]!.courts[g.court]!) }));
    act(() => hook.result.current.patchState({ result: recovered, liveGames: refs, completedGames: [], numCourts: 4, courtOverrides: { 4: 5 } }));
    expect(hook.result.current.changeSlot).toBe(4);
    expect(hook.result.current.liveCapacity).toBe(5);
    act(() => hook.result.current.toggleLiveGame(1, 0));
    expect(hook.result.current.state.liveGames).toHaveLength(5);
    expect(hook.result.current.state.result).toHaveProperty('capacityProgressFloorSlot', 4);
    act(() => hook.result.current.adjustCourtsAtSlot(4, -1));
    expect(hook.result.current.liveCapacity).toBe(4);
    expect(hook.result.current.state.courtOverrides[4]).toBe(4);
  });

  it('snapshots the actual lineup when manually starting a newly opened physical lane', () => {
    const { hook, plan } = session();
    act(() => hook.result.current.patchState({ result: plan, liveGames: [], completedGames: [], numCourts: 4 }));
    act(() => hook.result.current.toggleLiveGame(3, 0, 3));
    expect(hook.result.current.state.liveGames).toContainEqual(expect.objectContaining({ slot: 3, court: 0, displayCourt: 3, players: names(plan.schedule[2]!.courts[0]!) }));
  });

  it('keeps the reservation when it is already the first regeneration slot', () => {
    const { hook, plan } = session(2);
    act(() => hook.result.current.patchState({ result: plan, liveGames: [{ slot: 1, court: 2, displayCourt: 2, startedAt: 900, players: names(plan.schedule[0]!.courts[2]!) }], completedGames: [{ slot: 1, court: 0 }, { slot: 1, court: 1 }], numCourts: 4 }));
    act(() => hook.result.current.toggleLiveGame(1, 2));
    expect(names(hook.result.current.state.result!.schedule[1]!.courts[0]!)).toEqual(names(plan.schedule[1]!.courts[0]!));
    expect(hook.result.current.state.liveGames).toHaveLength(1);
  });
});
