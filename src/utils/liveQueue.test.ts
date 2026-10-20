// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { contiguousGamesForSlot, exportLiveQueueLogs, firstIncompleteSlot, initialLiveGamesForSchedule, keepGamesBeforeSlot, isSlotCompleted, liveQueueDebug, normalizeGameRefs } from './liveQueue';

const schedule = [
  { slot: 1, courts: [{}, {}] },
  { slot: 2, courts: [{}, {}] },
];

describe('live queue helpers', () => {
  it('captures debug events by default without an opt-in flag', () => {
    localStorage.removeItem('bp-debug-live-queue');
    const marker = `default-capture-${Date.now()}`;
    liveQueueDebug(marker, { action: 'test' });

    const exported = JSON.parse(exportLiveQueueLogs());
    expect(exported.logs).toContainEqual(expect.objectContaining({ label: marker, details: { action: 'test' } }));
  });

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

  it('only treats contiguous court refs as safely forceable', () => {
    expect(contiguousGamesForSlot([{ slot: 2, court: 0 }, { slot: 2, court: 1 }], 2))
      .toEqual([{ slot: 2, court: 0 }, { slot: 2, court: 1 }]);
    expect(contiguousGamesForSlot([{ slot: 2, court: 1 }], 2)).toBeNull();
  });

  it('starts every configured court in the first generated slot with player snapshots', () => {
    const result = {
      schedule: [{
        slot: 1,
        courts: [
          { teamA: [{ name: 'A' }, { name: 'B' }], teamB: [{ name: 'C' }, { name: 'D' }] },
          { teamA: [{ name: 'E' }, { name: 'F' }], teamB: [{ name: 'G' }, { name: 'H' }] },
          { teamA: [{ name: 'I' }, { name: 'J' }], teamB: [{ name: 'K' }, { name: 'L' }] },
        ],
      }],
    };

    expect(initialLiveGamesForSchedule(result, 3)).toEqual([
      { slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] },
      { slot: 1, court: 1, players: ['E', 'F', 'G', 'H'] },
      { slot: 1, court: 2, players: ['I', 'J', 'K', 'L'] },
    ]);
  });
});
