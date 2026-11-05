import { expect, it } from 'vitest';
import { extractRuntimeScheduleState } from './runtimeScheduleState';
import { recomputeStats } from '../algorithm/scheduler';
import type { Player, SlotResult } from '../algorithm/types';
const players: Player[] = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, gender: 'M', availFrom: 0, availTo: 5 }));
const courts = [0, 1].map(c => ({ court: c + 1, teamA: [players[c * 4]!, players[c * 4 + 1]!] as [Player, Player], teamB: [players[c * 4 + 2]!, players[c * 4 + 3]!] as [Player, Player] }));
const kept: SlotResult[] = recomputeStats([{ slot: 1, courts, sitting: [], playerState: [], repeatedCourts: [] }, { slot: 2, courts, sitting: [], playerState: [], repeatedCourts: [] }], players).schedule;
it('counts only actual games, preserves original kept slots and ignores abandoned planned courts', () => {
  const state = extractRuntimeScheduleState(kept, players, [{ slot: 1, court: 0 }]);
  expect(state.keptSlots).toBe(kept);
  expect(state.gamesPlayed).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  expect(state.consecutiveRested).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  expect(state.partnerCount[0]![1]).toBe(1);
  expect(state.partnerCount[4]![5]).toBe(0);
  expect(state.opponentCount[0]![2]).toBe(1);
  expect(state.courtGroupHistory.size).toBe(1);
});
it('does not assume any play or waiting when no runtime records exist', () => {
  const state = extractRuntimeScheduleState(kept, players, []);
  expect(state.gamesPlayed.every(n => n === 0)).toBe(true);
  expect(state.consecutiveRested.every(n => n === 0)).toBe(true);
  expect(state.courtGroupHistory.size).toBe(0);
});
it('uses actual lineup snapshots and deduplicates runtime refs', () => {
  const game = { slot: 1, court: 0, players: ['P4', 'P5', 'P6', 'P7'] };
  const state = extractRuntimeScheduleState(kept, players, [game, game]);
  expect(state.gamesPlayed).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  expect(state.partnerCount[4]![5]).toBe(1);
});
