// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayerRoster } from './usePlayerRoster.js';
import { DEFAULT_PLAYERS } from '../constants.js';

function setup(overrides = {}) {
  const patchState = vi.fn();
  const props = {
    players: [],
    playerHistory: [],
    nameInput: '',
    genderInput: 'M',
    totalSlots: 12,
    patchState,
    ...overrides,
  };
  const { result } = renderHook(() => usePlayerRoster(props));
  return { result, patchState };
}

describe('usePlayerRoster — loadDefaults', () => {
  it('adds every default player not already in the roster', () => {
    const { result, patchState } = setup();
    act(() => result.current.loadDefaults());
    const patch = patchState.mock.calls[0][0];
    expect(patch.players).toHaveLength(DEFAULT_PLAYERS.length);
    expect(patch.result).toBeNull();
  });

  it('is a no-op (does not call patchState) when every default is already present', () => {
    const { result, patchState } = setup({
      players: DEFAULT_PLAYERS.map(p => ({ ...p, availFrom: 0, availTo: 11 })),
    });
    act(() => result.current.loadDefaults());
    expect(patchState).not.toHaveBeenCalled();
  });

  it('merges: only adds the missing defaults, keeps existing players untouched', () => {
    const existing = { name: 'Custom', gender: 'M', availFrom: 0, availTo: 11 };
    const { result, patchState } = setup({ players: [existing] });
    act(() => result.current.loadDefaults());
    const patch = patchState.mock.calls[0][0];
    expect(patch.players[0]).toBe(existing);
    expect(patch.players).toHaveLength(1 + DEFAULT_PLAYERS.length);
  });
});

describe('usePlayerRoster — resetPlayers / clearPlayers', () => {
  it('resetPlayers replaces the roster entirely with defaults', () => {
    const { result, patchState } = setup({ players: [{ name: 'X', gender: 'M', availFrom: 0, availTo: 11 }] });
    act(() => result.current.resetPlayers());
    expect(patchState).toHaveBeenCalledWith(expect.objectContaining({ result: null }));
    expect(patchState.mock.calls[0][0].players).toHaveLength(DEFAULT_PLAYERS.length);
  });

  it('clearPlayers empties the roster and clears the schedule', () => {
    const { result, patchState } = setup();
    act(() => result.current.clearPlayers());
    expect(patchState).toHaveBeenCalledWith({ players: [], result: null });
  });
});

describe('usePlayerRoster — addPlayer', () => {
  it('adds a trimmed name with the current gender and clears nameInput', () => {
    const { result, patchState } = setup({ nameInput: '  Alice  ', genderInput: 'F' });
    act(() => result.current.addPlayer());
    const patch = patchState.mock.calls[0][0];
    expect(patch.players[0]).toMatchObject({ name: 'Alice', gender: 'F' });
    expect(patch.nameInput).toBe('');
  });

  it('is a no-op on an empty/whitespace-only name', () => {
    const { result, patchState } = setup({ nameInput: '   ' });
    act(() => result.current.addPlayer());
    expect(patchState).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name case-insensitively', () => {
    const { result, patchState } = setup({ nameInput: 'alice', players: [{ name: 'Alice', gender: 'F', availFrom: 0, availTo: 11 }] });
    act(() => result.current.addPlayer());
    expect(patchState).not.toHaveBeenCalled();
  });
});

describe('usePlayerRoster — addSelectedFromBank', () => {
  it('adds only entries not already on the roster', () => {
    const { result, patchState } = setup({ players: [{ name: 'Alice', gender: 'F', availFrom: 0, availTo: 11 }] });
    act(() => result.current.addSelectedFromBank([{ name: 'Alice', gender: 'F' }, { name: 'Bob', gender: 'M' }]));
    const patch = patchState.mock.calls[0][0];
    expect(patch.players).toHaveLength(2);
    expect(patch.players[1]).toMatchObject({ name: 'Bob', gender: 'M' });
  });

  it('is a no-op when every selected entry is already on the roster', () => {
    const { result, patchState } = setup({ players: [{ name: 'Alice', gender: 'F', availFrom: 0, availTo: 11 }] });
    act(() => result.current.addSelectedFromBank([{ name: 'Alice', gender: 'F' }]));
    expect(patchState).not.toHaveBeenCalled();
  });
});

describe('usePlayerRoster — bank management', () => {
  it('addToBank adds a trimmed name+gender, rejecting a case-insensitive duplicate', () => {
    const { result, patchState } = setup({ playerHistory: [{ name: 'Bob', gender: 'M' }] });
    act(() => result.current.addToBank('  Carol  ', 'F'));
    expect(patchState).toHaveBeenCalledWith({ playerHistory: [{ name: 'Bob', gender: 'M' }, { name: 'Carol', gender: 'F', level: 2 }] });

    patchState.mockClear();
    act(() => result.current.addToBank('bob', 'M'));
    expect(patchState).not.toHaveBeenCalled();
  });

  it('removeFromHistory removes by case-insensitive name match', () => {
    const { result, patchState } = setup({ playerHistory: [{ name: 'Bob', gender: 'M' }, { name: 'Carol', gender: 'F' }] });
    act(() => result.current.removeFromHistory('BOB'));
    expect(patchState).toHaveBeenCalledWith({ playerHistory: [{ name: 'Carol', gender: 'F' }] });
  });
});

describe('usePlayerRoster — removePlayer / updatePlayer', () => {
  it('removePlayer removes by index and invalidates the schedule', () => {
    const players = [{ name: 'A', gender: 'M', availFrom: 0, availTo: 11 }, { name: 'B', gender: 'M', availFrom: 0, availTo: 11 }];
    const { result, patchState } = setup({ players });
    act(() => result.current.removePlayer(0));
    expect(patchState).toHaveBeenCalledWith({ players: [players[1]], result: null });
  });

  it('updatePlayer updates the given field on the given index and invalidates the schedule', () => {
    const players = [{ name: 'A', gender: 'M', availFrom: 0, availTo: 11 }];
    const { result, patchState } = setup({ players });
    act(() => result.current.updatePlayer(0, 'name', 'A2'));
    expect(patchState).toHaveBeenCalledWith({ players: [{ ...players[0], name: 'A2' }], result: null });
  });
});
