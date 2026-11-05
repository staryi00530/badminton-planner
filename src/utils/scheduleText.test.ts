import { describe, it, expect } from 'vitest';
import { parseScheduleText, buildCopyText } from './scheduleText.js';
import { generateSchedule } from '../algorithm/scheduler.js';
import type { Player } from '../algorithm/types';

const OFF = { enabled: false, startMin: 0, durationMin: 0 };

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: 0, availTo: 11 }));
}

describe('buildCopyText', () => {
  it('returns an empty string with no result', () => {
    expect(buildCopyText(null, { mode: 'full', extraCourt: OFF, numCourts: 1, gameMinutes: 15, sessionStart: '', totalSlots: 12, players: [], scores: {} })).toBe('');
  });

  it("includes the sit list and games-played tally in 'full' mode but not 'games' mode", () => {
    const players = makePlayers(6);
    const result = generateSchedule(players, 2, [1, 1], 0, null, null, {});
    const full = buildCopyText(result, { mode: 'full', extraCourt: OFF, numCourts: 1, gameMinutes: 15, sessionStart: '', totalSlots: 2, players, scores: {} });
    const games = buildCopyText(result, { mode: 'games', extraCourt: OFF, numCourts: 1, gameMinutes: 15, sessionStart: '', totalSlots: 2, players, scores: {} });
    expect(full).toContain('Games per player:');
    expect(full).toContain('Sit:');
    expect(games).not.toContain('Games per player:');
    expect(games).not.toContain('Sit:');
  });

  it('includes an applied score inline when present', () => {
    const players = makePlayers(4);
    const result = generateSchedule(players, 1, [1], 0, null, null, {});
    const text = buildCopyText(result, {
      mode: 'full', extraCourt: OFF, numCourts: 1, gameMinutes: 15, sessionStart: '', totalSlots: 1, players,
      scores: { s1c0: { a: '21', b: '15', applied: true } },
    });
    expect(text).toContain('[21–15]');
  });
});

describe('parseScheduleText / buildCopyText roundtrip', () => {
  it('reconstructs the same court assignments after copy then paste', () => {
    const players = makePlayers(12);
    const result = generateSchedule(players, 4, [2, 2, 2, 2], 0, null, null, {});
    expect(result).not.toBeNull();

    const text = buildCopyText(result, { mode: 'full', extraCourt: OFF, numCourts: 2, gameMinutes: 15, sessionStart: '', totalSlots: 4, players, scores: {} });
    const parsed = parseScheduleText(text, players);

    expect(parsed).not.toBeNull();
    expect(parsed!.schedule.length).toBe(result!.schedule.length);
    for (let i = 0; i < result!.schedule.length; i++) {
      const orig = result!.schedule[i]!;
      const back = parsed!.schedule[i];
      expect(back.slot).toBe(orig.slot);
      expect(back.courts.length).toBe(orig.courts.length);
      for (let c = 0; c < orig.courts.length; c++) {
        expect(back.courts[c].teamA.map((p: any) => p.name)).toEqual(orig.courts[c]!.teamA.map(p => p.name));
        expect(back.courts[c].teamB.map((p: any) => p.name)).toEqual(orig.courts[c]!.teamB.map(p => p.name));
      }
      expect(back.sitting.map((p: any) => p.name)).toEqual(orig.sitting.map(p => p.name));
    }
  });

  it('resolves round-tripped names back to their correct gender from the roster', () => {
    const players: Player[] = [
      { name: 'Amy', gender: 'F', availFrom: 0, availTo: 0 },
      { name: 'Bob', gender: 'M', availFrom: 0, availTo: 0 },
      { name: 'Cara', gender: 'F', availFrom: 0, availTo: 0 },
      { name: 'Dan', gender: 'M', availFrom: 0, availTo: 0 },
    ];
    const result = generateSchedule(players, 1, [1], 0, null, null, {});
    const text = buildCopyText(result, { mode: 'full', extraCourt: OFF, numCourts: 1, gameMinutes: 15, sessionStart: '', totalSlots: 1, players, scores: {} });
    const parsed = parseScheduleText(text, players);
    const allParsed = [...parsed!.schedule[0].courts[0].teamA, ...parsed!.schedule[0].courts[0].teamB];
    for (const p of allParsed) {
      const original = players.find(pl => pl.name === p.name)!;
      expect(p.gender).toBe(original.gender);
    }
  });

  it('returns null for text with no recognizable slots', () => {
    expect(parseScheduleText('just some random text', [])).toBeNull();
  });

  it('falls back to a placeholder gender for an unrecognized name', () => {
    const text = '--- Slot 1 (~0-15m) ---\n  Stranger & Other  vs  Third & Fourth';
    const parsed = parseScheduleText(text, []);
    expect(parsed!.schedule[0].courts[0].teamA[0]).toEqual({ name: 'Stranger', gender: '?' });
  });
});
