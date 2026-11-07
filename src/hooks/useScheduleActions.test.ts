// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useScheduleActions } from './useScheduleActions';
import type { Player } from '../types';
import * as scheduler from '../algorithm/scheduler';
import { exportLiveQueueLogs } from '../utils/liveQueue';

it('explains why regenerating beyond the last shared slot cannot change a game', () => {
  const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: 'M', availFrom: 0, availTo: 0 }));
  const patchState = vi.fn();
  const { result } = renderHook(() => useScheduleActions({ players, result: { schedule: [], gamesPlayed: [] }, totalSlots: 1, isGenerating: false, isConfirmed: false,
    scores: {}, winLoss: {}, liveGames: [{ slot: 1, court: 0 }], completedGames: [], fromSlot: 1, fromSlotCourts: 0,
    recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players, applyAvailability: p => p,
    getCourtsPerSlot: () => [1], getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot: games => games,
  }));
  act(() => result.current.runRegenerateFromSlotWithCourts(1, 0));
  expect(patchState).toHaveBeenCalledWith(expect.objectContaining({ sessionChangeNotice: expect.stringMatching(/no upcoming/i) }));
});

it('releases generation and restores the previous plan when a later slot throws', () => {
  const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: 'M', availFrom: 0, availTo: 11 }));
  const prior = scheduler.generateSchedule(players, 1, [1])!;
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const generator = vi.spyOn(scheduler, 'generateScheduleGen').mockImplementation(function* () {
    for (let i = 1; i <= 5; i++) yield { schedule: Array.from({ length: i }, (_, index) => ({ ...prior.schedule[0]!, slot: index + 1 })), gamesPlayed: [0, 0, 0, 0] };
    throw new Error('private failure details');
  });
  const patchState = vi.fn();
  try {
    const { result } = renderHook(() => useScheduleActions({ players, result: prior, totalSlots: 12, isGenerating: false, isConfirmed: true,
      scores: {}, winLoss: {}, liveGames: [{ slot: 1, court: 0 }], completedGames: [], fromSlot: 2, fromSlotCourts: 4, courtOverrides: { 2: 4 },
      recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players, applyAvailability: p => p,
      getCourtsPerSlot: () => Array(12).fill(4), getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot: games => games,
    }));
    act(() => { result.current.runGenerate(); while (frames.length) frames.shift()!(0); });
    expect(patchState).toHaveBeenLastCalledWith(expect.objectContaining({ result: prior, isGenerating: false, isConfirmed: true, genSlot: 0,
      liveGames: [{ slot: 1, court: 0 }], courtOverrides: { 2: 4 }, sessionChangeNotice: expect.stringMatching(/slot 6.*previous schedule.*restored/i) }));
    const logs = exportLiveQueueLogs();
    expect(logs).toContain('generate:failed');
    expect(logs).not.toContain('private failure details');
  } finally { generator.mockRestore(); raf.mockRestore(); }
});
