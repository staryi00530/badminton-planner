import { describe, expect, it } from 'vitest';
import { firstIncompleteSlot, keepGamesBeforeSlot, isSlotCompleted, normalizeGameRefs } from './liveQueue';

const schedule = [
  { slot: 1, courts: [{}, {}] },
  { slot: 2, courts: [{}, {}] },
];

describe('live queue helpers', () => {
  it('keeps only status references before a regenerated slot', () => {
    expect(keepGamesBeforeSlot([{ slot: 1, court: 0 }, { slot: 2, court: 0 }], 2))
      .toEqual([{ slot: 1, court: 0 }]);
  });

  it('requires every court before folding a slot into completed history', () => {
    expect(isSlotCompleted(schedule[0], [{ slot: 1, court: 0 }])).toBe(false);
    expect(isSlotCompleted(schedule[0], [{ slot: 1, court: 0 }, { slot: 1, court: 1 }])).toBe(true);
  });

  it('returns a finished sentinel after the final slot', () => {
    const completed = schedule.flatMap(slot => slot.courts.map((_, court) => ({ slot: slot.slot, court })));
    expect(firstIncompleteSlot(schedule, completed, 2)).toBe(3);
  });

  it('drops duplicate and stale live refs while respecting capacity', () => {
    expect(normalizeGameRefs([
      { slot: 1, court: 0 },
      { slot: 1, court: 0 },
      { slot: 9, court: 0 },
      { slot: 1, court: 1 },
    ], schedule, 2)).toEqual([
      { slot: 1, court: 0 },
      { slot: 1, court: 1 },
    ]);
  });
});
