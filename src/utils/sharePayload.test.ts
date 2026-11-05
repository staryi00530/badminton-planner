import { describe, it, expect } from 'vitest';
import { buildSharePayload, reconstructScheduleFromSharePayload, upsertSavedPlanFromShare } from './sharePayload.js';
import { generateSchedule } from '../algorithm/scheduler.js';
import type { Player } from '../algorithm/types';

function makePlayers(count: number, femaleCount = 0): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `P${i + 1}`,
    gender: i < femaleCount ? 'F' : 'M',
    availFrom: 0,
    availTo: 11,
  }));
}

describe('buildSharePayload', () => {
  it('preserves published quarantine without exposing private levels', () => {
    const players = [{ name: 'A', gender: 'M', level: 5 as const, quarantined: true }];
    const payload = buildSharePayload({ result: { schedule: [] }, playersWithAvailability: players, gameMinutes: 15, numCourts: 1, scores: {}, isConfirmed: false })!;
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(payload.p).toEqual([['A', 'M']]);
    expect(JSON.stringify(payload)).not.toContain('level');
    expect(decoded.players[0]).toMatchObject({ name: 'A', quarantined: true });
    expect(decoded.players[0]).not.toHaveProperty('level');
  });

  it('explicitly clears published quarantine when the last player is returned', () => {
    const prior = { q: [0] };
    const update = buildSharePayload({ result: { schedule: [] }, playersWithAvailability: [{ name: 'A', gender: 'M', quarantined: false }], gameMinutes: 15, numCourts: 1, scores: {}, isConfirmed: false })!;
    // Firebase updates merge fields: omitting q would keep the old published restriction.
    const published = { ...prior, ...update };
    const decoded = reconstructScheduleFromSharePayload(published, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.players[0]).not.toHaveProperty('quarantined', true);
  });
  it('returns null when there is no result', () => {
    expect(buildSharePayload({ result: null, playersWithAvailability: [], gameMinutes: 15, numCourts: 1, scores: {}, isConfirmed: false })).toBeNull();
  });

  it('only includes applied scores', () => {
    const players = makePlayers(4);
    const result = generateSchedule(players, 1, [1], 0, null, null, {});
    const payload = buildSharePayload({
      result, playersWithAvailability: players, gameMinutes: 15, numCourts: 1, isConfirmed: false,
      scores: { s1c0: { a: '21', b: '15', applied: true }, s1c1: { a: '5', b: '3', applied: false } },
    });
    expect(payload!.scores).toEqual({ s1c0: { a: '21', b: '15' } });
  });

  it('encodes players as [name, gender] pairs and courts as index references', () => {
    const players = makePlayers(4, 2);
    const result = generateSchedule(players, 1, [1], 0, null, null, {});
    const payload = buildSharePayload({ result, playersWithAvailability: players, gameMinutes: 15, numCourts: 1, scores: {}, isConfirmed: true });
    expect(payload!.p).toEqual([['P1', 'F'], ['P2', 'F'], ['P3', 'M'], ['P4', 'M']]);
    expect(payload!.confirmed).toBe(true);
    expect(payload!.slots[0]!.c[0]![0]!.every((i: number) => i >= 0 && i < 4)).toBe(true);
  });
});

describe('buildSharePayload -> reconstructScheduleFromSharePayload roundtrip', () => {
  it('keeps protected game participants after replacing the roster without restoring them to the roster', () => {
    const old = makePlayers(4);
    const result = generateSchedule(old, 1, [1], 0, null, null, {})!;
    const replacement = [{ ...old[0]!, id: 'p1' }, { ...old[1]!, name: 'New player', id: 'new' }];
    const payload = buildSharePayload({ result, playersWithAvailability: replacement, gameMinutes: 15, numCourts: 1, scores: {}, isConfirmed: false, runtime: { live: [{ slot: 1, court: 0 }], completed: [] } })!;
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.players.map(p => p.name)).toEqual(['P1', 'New player']);
    expect(decoded.result.schedule[0]!.courts[0]!.teamA.concat(decoded.result.schedule[0]!.courts[0]!.teamB).map(p => p.name).sort()).toEqual(old.map(p => p.name).sort());
    expect(decoded.result.gamesPlayed).toHaveLength(2);
  });
  it('restores shared duration, attendance and live progress independently of local settings', () => {
    const players = makePlayers(8).map((p, i) => ({ ...p, id: `id-${i}`, availFrom: i === 7 ? 2 : 0 }));
    const result = generateSchedule(players, 6, Array(6).fill(1), 0, null, null, {})!;
    const payload = buildSharePayload({ result, playersWithAvailability: players, gameMinutes: 10, numCourts: 1, scores: {}, isConfirmed: true,
      settings: { totalMinutes: 60, sessionStart: '19:30', staggerMode: 'custom', extraCourt: { enabled: false, startMin: 0, durationMin: 30 }, courtOverrides: {} },
      runtime: { live: [{ slot: 2, court: 0 }], completed: [{ slot: 1, court: 0 }], suspended: [] },
    })!;
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 4 });
    expect(decoded.totalMinutes).toBe(60);
    expect(decoded.sessionStart).toBe('19:30');
    expect(decoded.staggerMode).toBe('custom');
    expect(decoded.liveGames).toEqual([{ slot: 2, court: 0 }]);
    expect(decoded.completedGames).toEqual([{ slot: 1, court: 0 }]);
    expect(decoded.players[7]).toMatchObject({ id: 'id-7', availFrom: 2, availTo: 11 });
    expect(JSON.stringify(payload)).not.toContain('level');
  });
  it('roundtrips shared score drafts and grouped attendance without marking a draft applied', () => {
    const players = makePlayers(4).map(p => ({ ...p, group: 'late', leavesAt: 8 }));
    const result = generateSchedule(players, 2, [1, 1], 0, null, null, {})!;
    const payload = buildSharePayload({ result, playersWithAvailability: players, gameMinutes: 15, numCourts: 1, isConfirmed: false,
      scores: { s1c0: { a: '12', b: '9', applied: false } }, includeScoreDrafts: true,
    })!;
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.scores.s1c0).toMatchObject({ a: '12', b: '9', applied: false });
    expect(decoded.players[0]).toMatchObject({ group: 'late', leavesAt: 8 });
  });
  it('loads a Firebase slot whose empty sitting list was omitted', () => {
    const decoded = reconstructScheduleFromSharePayload({
      p: [['A', 'M'], ['B', 'M'], ['C', 'F'], ['D', 'F']],
      slots: [{ s: 1, c: [[[0, 1], [2, 3]]] }],
    }, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.result.schedule[0]!.sitting).toEqual([]);
    expect(decoded.result.schedule[0]!.courts[0]!.teamA.map(player => player.name)).toEqual(['A', 'B']);
  });

  it('loads a Firebase rest slot whose empty court list was omitted', () => {
    const decoded = reconstructScheduleFromSharePayload({
      p: [['A', 'M'], ['B', 'M'], ['C', 'F'], ['D', 'F']],
      slots: [{ s: 1, sit: [0, 1, 2, 3] }],
    }, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.result.schedule[0]!.courts).toEqual([]);
    expect(decoded.result.schedule[0]!.sitting.map(player => player.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('reconstructs the same court assignments and games-played counts', () => {
    const players = makePlayers(12);
    const result = generateSchedule(players, 6, [2, 2, 2, 2, 2, 2], 0, null, null, {});
    expect(result).not.toBeNull();

    const payload = buildSharePayload({ result, playersWithAvailability: players, gameMinutes: 15, numCourts: 2, scores: {}, isConfirmed: false });
    const decoded = reconstructScheduleFromSharePayload(payload!, { currentGameMinutes: 15, currentNumCourts: 2 });

    expect(decoded.result.gamesPlayed).toEqual(result!.gamesPlayed);
    expect(decoded.result.schedule.length).toBe(result!.schedule.length);
    for (let i = 0; i < result!.schedule.length; i++) {
      const orig = result!.schedule[i]!;
      const back = decoded.result.schedule[i]!;
      for (let c = 0; c < orig.courts.length; c++) {
        expect(back.courts[c]!.teamA.map(p => p.name)).toEqual(orig.courts[c]!.teamA.map(p => p.name));
        expect(back.courts[c]!.teamB.map(p => p.name)).toEqual(orig.courts[c]!.teamB.map(p => p.name));
      }
    }
  });

  it('falls back to the current gameMinutes/numCourts when cfg is missing', () => {
    const decoded = reconstructScheduleFromSharePayload(
      { p: [['A', 'M'], ['B', 'M'], ['C', 'M'], ['D', 'M']], slots: [] },
      { currentGameMinutes: 20, currentNumCourts: 3 }
    );
    expect(decoded.gameMinutes).toBe(20);
    expect(decoded.numCourts).toBe(3);
  });

  it('uses cfg values when present, overriding the current fallback', () => {
    const decoded = reconstructScheduleFromSharePayload(
      { p: [['A', 'M'], ['B', 'M'], ['C', 'M'], ['D', 'M']], cfg: { g: 10, c: 1 }, slots: [] },
      { currentGameMinutes: 20, currentNumCourts: 3 }
    );
    expect(decoded.gameMinutes).toBe(10);
    expect(decoded.numCourts).toBe(1);
  });

  it('restores consecutive-played/rested streaks slot by slot', () => {
    // Five players: P1 plays doubles and P2 sits in both slots.
    const payload = {
      p: [['P1', 'M'], ['P2', 'M'], ['P3', 'M'], ['P4', 'M'], ['P5', 'M']] as [string, string][],
      slots: [
        { s: 1, c: [[[0, 2], [3, 4]]], sit: [1] },
        { s: 2, c: [[[0, 2], [3, 4]]], sit: [1] },
      ],
    };
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 1 });
    const lastSlot = decoded.result.schedule[1]!;
    const p1State = lastSlot.playerState.find(ps => ps.name === 'P1');
    const p2State = lastSlot.playerState.find(ps => ps.name === 'P2');
    expect(p1State!.conPlayed).toBe(2);
    expect(p2State!.conRested).toBe(2);
  });

  it('marks restored scores as applied and attaches team names', () => {
    const payload = {
      p: [['A', 'M'], ['B', 'M'], ['C', 'M'], ['D', 'M']] as [string, string][],
      slots: [{ s: 1, c: [[[0, 1], [2, 3]]], sit: [] }],
      scores: { s1c0: { a: '21', b: '10' } },
    };
    const decoded = reconstructScheduleFromSharePayload(payload, { currentGameMinutes: 15, currentNumCourts: 1 });
    expect(decoded.scores.s1c0).toEqual({ a: '21', b: '10', applied: true, teamA: ['A', 'B'], teamB: ['C', 'D'] });
  });
});

describe('upsertSavedPlanFromShare', () => {
  it('leaves savedPlans untouched and returns null loadedPlanId when there is no sourceShareId', () => {
    const savedPlans = [{ id: 1, tag: 'x' }];
    const result = upsertSavedPlanFromShare(savedPlans, null, { some: 'result' }, 1000);
    expect(result).toEqual({ savedPlans, loadedPlanId: null });
  });

  it('prepends a new untagged entry when the share has not been opened before', () => {
    const savedPlans = [{ id: 1, tag: 'existing' }];
    const { savedPlans: next, loadedPlanId } = upsertSavedPlanFromShare(savedPlans, 'share-abc', { some: 'result' }, 5000);
    expect(loadedPlanId).toBe(5000);
    expect(next[0]).toMatchObject({ id: 5000, tag: '', sourceShareId: 'share-abc', result: { some: 'result' } });
    expect(next[1]).toEqual(savedPlans[0]);
  });

  it('updates the existing entry in place (same id, same position) when reopening the same share', () => {
    const savedPlans = [
      { id: 1, tag: 'other' },
      { id: 2, tag: '', sourceShareId: 'share-abc', result: { old: true }, savedAt: '2020-01-01T00:00:00.000Z' },
    ];
    const { savedPlans: next, loadedPlanId } = upsertSavedPlanFromShare(savedPlans, 'share-abc', { new: true }, 9999);
    expect(loadedPlanId).toBe(2);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ id: 2, result: { new: true } });
    expect(next[0]).toEqual(savedPlans[0]);
  });
});

it.each([1, 3])('rejects a malformed shared team with %i players', size => {
  const p: [string, string][] = Array.from({ length: 5 }, (_, i) => [`P${i}`, 'M']);
  const data = { p, slots: [{ s: 1, c: [[Array.from({ length: size }, (_, i) => i), [3, 4]]], sit: [] }] };
  expect(() => reconstructScheduleFromSharePayload(data, { currentGameMinutes: 15, currentNumCourts: 1 })).toThrow('Shared teams must contain exactly two players');
});
