import { describe, expect, it } from 'vitest';
import { getQueuePromotionDecision, reconcileLiveQueue } from './liveQueueTransition';

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
