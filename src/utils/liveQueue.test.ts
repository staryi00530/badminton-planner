// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { startUntimedLiveGames, stampNewLiveGames, contiguousGamesForSlot, exportLiveQueueLogs, firstIncompleteSlot, initialLiveGamesForSchedule, keepGamesBeforeSlot, isSlotCompleted, liveQueueDebug, normalizeGameRefs } from './liveQueue';

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

  it('identifies the app build in each debug export', () => {
    expect(JSON.parse(exportLiveQueueLogs())).toEqual(expect.objectContaining({
      exportedAt: expect.any(String),
      buildTime: expect.any(String),
      logs: expect.any(Array),
    }));
  });

  it('keeps only status references before a regenerated slot', () => {
    expect(keepGamesBeforeSlot([{ slot: 1, court: 0 }, { slot: 2, court: 0 }], 2))
      .toEqual([{ slot: 1, court: 0 }]);
  });

  it('requires every court before folding a slot into completed history', () => {
    expect(isSlotCompleted(schedule[0]!, [{ slot: 1, court: 0 }])).toBe(false);
    expect(isSlotCompleted(schedule[0]!, [{ slot: 1, court: 0 }, { slot: 1, court: 1 }])).toBe(true);
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

    expect(initialLiveGamesForSchedule(result, 3, 123)).toEqual([
      { slot: 1, court: 0, startedAt: 123, players: ['A', 'B', 'C', 'D'] },
      { slot: 1, court: 1, startedAt: 123, players: ['E', 'F', 'G', 'H'] },
      { slot: 1, court: 2, startedAt: 123, players: ['I', 'J', 'K', 'L'] },
    ]);
  });
});

it('records one start instant for generated courts and preserves it through normalization',()=>{
 const p=(name:string)=>({name});
 const plan={schedule:[{slot:1,courts:[{teamA:[p('A'),p('B')],teamB:[p('C'),p('D')]},{teamA:[p('E'),p('F')],teamB:[p('G'),p('H')]}]}]};
 const games=initialLiveGamesForSchedule(plan,2,123456);
 expect(games.map(g=>g.startedAt)).toEqual([123456,123456]);
 expect(normalizeGameRefs(games,plan.schedule).map(g=>g.startedAt)).toEqual([123456,123456]);
});
it('stamps only newly activated games, preserving old and unknown starts',()=>{
 const previous=[{slot:1,court:0,startedAt:100},{slot:1,court:1}];
 const result=stampNewLiveGames([{slot:1,court:0,startedAt:999},{slot:1,court:1},{slot:2,court:0}],previous,500);
 expect(result[0]!.startedAt).toBe(100);
 expect(result[1]!.startedAt).toBeUndefined();
 expect(result[2]!.startedAt).toBe(500);
 expect(stampNewLiveGames(result,result,900)).toEqual(result);
});
it('keeps prepared initial courts untimed until the organizer starts clocks',()=>{
 const p=(name:string)=>({name});
 const plan={schedule:[{slot:1,courts:[{teamA:[p('A'),p('B')],teamB:[p('C'),p('D')]}]}]};
 const prepared=initialLiveGamesForSchedule(plan,1);
 expect(prepared[0]?.startedAt).toBeUndefined();
 expect(startUntimedLiveGames(prepared,123)[0]?.startedAt).toBe(123);
 expect(startUntimedLiveGames([{slot:1,court:0,startedAt:10},{slot:2,court:0}],123).map(g=>g.startedAt)).toEqual([10,123]);
});
