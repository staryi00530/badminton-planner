// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useScheduleActions } from './useScheduleActions';
import type { Player } from '../types';

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
