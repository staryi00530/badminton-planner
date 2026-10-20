import { describe, expect, it } from 'vitest';
import { getFutureChangeBoundary, getQueuePromotionDecision, reconcileFutureSessionChange, reconcileLiveQueue } from './liveQueueTransition';
import { extractState, generateSchedule } from '../algorithm/scheduler';
import { computeCourtsPerSlot } from './courtsPerSlot';
import type { Player } from '../algorithm/types';
import type { PlannerResult } from '../types';

function scheduleFor(games: Array<[number, number, string[]]>) {
  const bySlot = new Map<number, Array<string[]>>();
  for (const [slot, court, players] of games) {
    const courts = bySlot.get(slot) ?? [];
    courts[court] = players;
    bySlot.set(slot, courts);
  }
  return [...bySlot.entries()].map(([slot, courts]) => ({
    slot,
    courts: courts.map(players => ({
      teamA: players.slice(0, 2).map(name => ({ name, gender: 'M' as const })),
      teamB: players.slice(2, 4).map(name => ({ name, gender: 'M' as const })),
    })),
  }));
}

describe('reconcileLiveQueue', () => {
  it('offers the following playable game when the first queued game is blocked', () => {
    const decision = getQueuePromotionDecision({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['E', 'F', 'G', 'H']],
        [2, 1, ['I', 'J', 'K', 'L']],
      ]),
      liveGames: [{ slot: 1, court: 1, players: ['E', 'A', 'B', 'C'] }],
      completedGames: [{ slot: 1, court: 0 }],
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(decision.first).toEqual({ slot: 2, court: 0 });
    expect(decision.firstBlockedPlayers).toEqual(['E']);
    expect(decision.lookahead).toEqual({ slot: 2, court: 1 });
    expect(decision.mode).toBe('choose');
  });

  it('does not cascade past a second blocked queued game', () => {
    const decision = getQueuePromotionDecision({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['E', 'F', 'G', 'H']],
        [2, 1, ['I', 'J', 'K', 'L']],
        [3, 0, ['M', 'N', 'O', 'P']],
      ]),
      liveGames: [
        { slot: 1, court: 1, players: ['E', 'I', 'A', 'B'] },
      ],
      completedGames: [{ slot: 1, court: 0 }],
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(decision.first).toEqual({ slot: 2, court: 0 });
    expect(decision.firstBlockedPlayers).toEqual(['E']);
    expect(decision.lookahead).toBeNull();
    expect(decision.mode).toBe('substitute-first');
  });

  it('promotes the first queued game directly when it is playable', () => {
    const decision = getQueuePromotionDecision({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['E', 'F', 'G', 'H']],
        [2, 1, ['I', 'J', 'K', 'L']],
      ]),
      liveGames: [{ slot: 1, court: 1, players: ['A', 'B', 'C', 'D'] }],
      completedGames: [{ slot: 1, court: 0 }],
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(decision.mode).toBe('promote-first');
    expect(decision.firstBlockedPlayers).toEqual([]);
    expect(decision.lookahead).toBeNull();
  });

  it('preserves active court identity when the edited roster changes', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([[1, 0, ['A', 'B', 'C', 'D']], [2, 0, ['E', 'F', 'G', 'H']]]),
      liveGames: [{ slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] }],
      completedGames: [],
      capacity: 1,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(result.liveGames).toEqual([{ slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] }]);
    expect(result.promotedGames).toEqual([]);
  });

  it('promotes the earliest playable future game without exceeding capacity', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['A', 'E', 'F', 'G']],
        [2, 1, ['H', 'I', 'J', 'K']],
      ]),
      liveGames: [{ slot: 1, court: 0 }],
      completedGames: [],
      capacity: 2,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(result.liveGames).toEqual([{ slot: 1, court: 0 }, { slot: 2, court: 1 }]);
    expect(result.promotedGames).toEqual([{ slot: 2, court: 1 }]);
  });

  it('keeps all three courts live and skips only a queued game whose players are still active', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [1, 1, ['E', 'F', 'G', 'H']],
        [1, 2, ['I', 'J', 'K', 'L']],
        [2, 0, ['E', 'M', 'N', 'O']],
        [2, 1, ['P', 'Q', 'R', 'S']],
      ]),
      liveGames: [{ slot: 1, court: 1 }, { slot: 1, court: 2 }],
      completedGames: [{ slot: 1, court: 0 }],
      capacity: 3,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(result.liveGames).toEqual([
      { slot: 1, court: 1 },
      { slot: 1, court: 2 },
      { slot: 2, court: 1 },
    ]);
    expect(result.promotedGames).toEqual([{ slot: 2, court: 1 }]);
  });

  it('promotes the first queued game when it is playable, even if a later group is different', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [1, 1, ['E', 'F', 'G', 'H']],
        [1, 2, ['I', 'J', 'K', 'L']],
        [2, 0, ['M', 'N', 'O', 'P']],
        [2, 1, ['Q', 'R', 'S', 'T']],
      ]),
      liveGames: [{ slot: 1, court: 1 }, { slot: 1, court: 2 }],
      completedGames: [{ slot: 1, court: 0 }],
      capacity: 3,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(result.promotedGames).toEqual([{ slot: 2, court: 0 }]);
    expect(result.liveGames).toHaveLength(3);
  });

  it('uses a substituted player snapshot when checking queue conflicts', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['A', 'M', 'N', 'O']],
      ]),
      liveGames: [{ slot: 1, court: 0, players: ['X', 'B', 'C', 'D'] }],
      completedGames: [],
      capacity: 2,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });
    expect(result.promotedGames).toEqual([{ slot: 2, court: 0 }]);
  });

  it('excludes completed and suspended games from promotion', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([
        [1, 0, ['A', 'B', 'C', 'D']],
        [2, 0, ['E', 'F', 'G', 'H']],
        [3, 0, ['I', 'J', 'K', 'L']],
      ]),
      liveGames: [],
      completedGames: [{ slot: 2, court: 0, players: ['E', 'F', 'G', 'H'] }],
      capacity: 1,
      changedSlot: 1,
      suspendedPlayerNames: ['I'],
    });

    expect(result.liveGames).toEqual([]);
    expect(result.promotedGames).toEqual([]);
  });

  it('drops stale status references without creating invalid courts', () => {
    const result = reconcileLiveQueue({
      schedule: scheduleFor([[1, 0, ['A', 'B', 'C', 'D']]]),
      liveGames: [{ slot: 9, court: 4 }, { slot: 1, court: 0 }],
      completedGames: [{ slot: 9, court: 0 }],
      capacity: 2,
      changedSlot: 1,
      suspendedPlayerNames: [],
    });

    expect(result.liveGames).toEqual([{ slot: 1, court: 0 }]);
    expect(result.completedGames).toEqual([]);
  });
});

describe('future-only session transitions', () => {
  const players: Player[] = Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: 0, availTo: 4 }));
  const baseResult = () => generateSchedule(players, 5, [3, 3, 3, 3, 3], 0, null, null, {}, () => 0.5)!;
  function change(overrides: Partial<Parameters<typeof reconcileFutureSessionChange>[0]> = {}) {
    const result = baseResult();
    return reconcileFutureSessionChange({
      result, totalSlots: 5, boundarySlot: 2, targetCapacity: 3, courtOverrides: {},
      liveGames: [{ slot: 1, court: 2, displayCourt: 4, players: ['P9', 'P10', 'P11', 'P12'] }],
      completedGames: [{ slot: 1, court: 0, players: ['P1', 'P2', 'P3', 'P4'] }],
      scores: { s1c0: { a: '21', b: '15', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } },
      regenerate: ({ targetFromSlot, overridePlayers, baseResult, courtOverrides }) => {
        const roster = overridePlayers ?? players;
        const courts = computeCourtsPerSlot({ totalSlots: 5, gameMinutes: 15, numCourts: 3, extraCourt: { enabled: false, startMin: 0, durationMin: 0 }, courtOverrides });
        const snapshot = extractState(baseResult.schedule.slice(0, targetFromSlot - 1), roster);
        return { newResult: generateSchedule(roster, 5, courts, targetFromSlot - 1, snapshot, null, {}, () => 0.5)!, nextScores: {} };
      },
      ...overrides,
    });
  }

  it('finds a safe upcoming boundary across asynchronous and sparse live/completed slots', () => {
    expect(getFutureChangeBoundary([{ slot: 1, court: 2 }, { slot: 3, court: 0 }], [{ slot: 2, court: 1 }])).toBe(4);
    expect(getFutureChangeBoundary([], [])).toBe(1);
  });

  it('removes an early departure only from future games, preserving snapshots and scores', () => {
    const before = baseResult();
    const patch = change({ result: before, overridePlayers: players.map(p => p.name === 'P9' ? { ...p, availTo: 0, leavesAt: 0 } : p) })!;
    expect(patch.result!.schedule[0]).toBe(before.schedule[0]);
    expect(patch.result!.schedule.slice(1).flatMap(s => s.courts.flatMap(c => [...c.teamA, ...c.teamB])).some(p => p.name === 'P9')).toBe(false);
    expect(patch.liveGames).toEqual([{ slot: 1, court: 2, displayCourt: 4, players: ['P9', 'P10', 'P11', 'P12'] }]);
    expect(patch.completedGames).toEqual([{ slot: 1, court: 0, players: ['P1', 'P2', 'P3', 'P4'] }]);
    expect(patch.scores?.s1c0).toEqual({ a: '21', b: '15', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] });
  });

  it('includes a late arrival from the boundary without rewriting the initial slot', () => {
    const roster = players.slice(0, 12).map((p, i) => i === 11 ? { ...p, availFrom: 3 } : p);
    const before = generateSchedule(roster, 5, [3, 3, 3, 3, 3], 0, null, null, {}, () => 0.5)!;
    const patch = change({ result: before, overridePlayers: roster.map(p => p.name === 'P12' ? { ...p, availFrom: 1 } : p) })!;
    expect(patch.result!.schedule[0]).toBe(before.schedule[0]);
    expect(patch.result!.schedule[1]!.courts).toHaveLength(3);
    expect(patch.result!.schedule[1]!.courts.flatMap(c => [...c.teamA, ...c.teamB]).map(p => p.name)).toContain('P12');
  });

  it.each([1, 2, 3, 4, 5])('changes future capacity to %i without trimming or relabeling current games', capacity => {
    const before = baseResult();
    const liveGames = [0, 1, 2].map(court => ({ slot: 1, court, displayCourt: court }));
    const patch = change({ result: before, liveGames, completedGames: [], targetCapacity: capacity, courtOverrides: { 2: capacity } })!;
    expect(patch.liveGames).toBe(liveGames);
    expect(patch.result!.schedule[0]).toBe(before.schedule[0]);
    expect(patch.result!.schedule.slice(1).map(s => s.courts.length)).toEqual([capacity, capacity, capacity, capacity]);
    expect(patch.fromSlot).toBe(2);
    expect(patch.fromSlotCourts).toBe(capacity);
    expect(patch.courtOverrides).toEqual({ 2: capacity });
  });

  it('protects a pulled-up live game and later completed game even when the requested boundary is earlier', () => {
    const before = baseResult();
    const patch = change({ result: before, liveGames: [{ slot: 2, court: 2, displayCourt: 0 }], completedGames: [{ slot: 3, court: 1 }] })!;
    expect(patch.fromSlot).toBe(4);
    expect(patch.result!.schedule.slice(0, 3)).toEqual(before.schedule.slice(0, 3));
    expect(patch.completedGames).toEqual([{ slot: 3, court: 1 }]);
    expect(patch.liveGames).toEqual([{ slot: 2, court: 2, displayCourt: 0 }]);
  });

  it('does not mutate anything when regeneration fails or no mutable slot remains', () => {
    expect(change({ regenerate: () => null })).toBeNull();
    expect(change({ liveGames: [{ slot: 5, court: 0 }] })).toBeNull();
  });
});
