// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlannerState } from './usePlannerState.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('usePlannerState — defaults & loading', () => {
  it('creates default state when nothing is persisted', () => {
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.players).toEqual([]);
    expect(result.current.state.numCourts).toBe(1);
    expect(result.current.state.totalMinutes).toBe(180);
    expect(result.current.state.gameMinutes).toBe(15);
    expect(result.current.state.isConfirmed).toBe(false);
    expect(result.current.state.liveGames).toEqual([]);
    expect(result.current.state.completedGames).toEqual([]);
  });

  it('loads persisted values from localStorage on init', () => {
    localStorage.setItem('bp-numCourts', JSON.stringify(3));
    localStorage.setItem('bp-players', JSON.stringify([{ name: 'Alice', gender: 'F' }]));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.numCourts).toBe(3);
    expect(result.current.state.players).toEqual([{ name: 'Alice', gender: 'F' }]);
  });

  it('cleans up legacy bp-share-id/bp-share-token localStorage keys on init', () => {
    // These used to be persisted to localStorage, which let a stale share silently
    // reconnect on a plain app open. Guard against that regression.
    localStorage.setItem('bp-share-id', JSON.stringify('stale-id'));
    localStorage.setItem('bp-share-token', JSON.stringify('stale-token'));
    renderHook(() => usePlannerState());
    expect(localStorage.getItem('bp-share-id')).toBeNull();
    expect(localStorage.getItem('bp-share-token')).toBeNull();
  });
});

describe('usePlannerState — dispatch', () => {
  it('patchState merges partial updates into state', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ numCourts: 2, saved: true }));
    expect(result.current.state.numCourts).toBe(2);
    expect(result.current.state.saved).toBe(true);
  });

  it('setField sets a single field without touching others', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ numCourts: 2 }));
    act(() => result.current.setField('nameInput', 'Bob'));
    expect(result.current.state.nameInput).toBe('Bob');
    expect(result.current.state.numCourts).toBe(2);
  });
});

describe('usePlannerState — persistence to localStorage', () => {
  it('persists settings changes back to localStorage', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ numCourts: 4 }));
    expect(JSON.parse(localStorage.getItem('bp-numCourts')!)).toBe(4);
  });

  it('removes the result key from localStorage when cleared to null', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ result: { schedule: [], gamesPlayed: [] } }));
    expect(localStorage.getItem('bp-result')).not.toBeNull();
    act(() => result.current.patchState({ result: null }));
    expect(localStorage.getItem('bp-result')).toBeNull();
  });

  it('persists shareId to sessionStorage, not localStorage', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ shareId: 'abc123' }));
    expect(JSON.parse(sessionStorage.getItem('bp-share-id')!)).toBe('abc123');
    expect(localStorage.getItem('bp-share-id')).toBeNull();
  });

  it('clears shareId from sessionStorage when set back to null', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ shareId: 'abc123' }));
    act(() => result.current.patchState({ shareId: null }));
    expect(sessionStorage.getItem('bp-share-id')).toBeNull();
  });
});

describe('usePlannerState — cross-tab safety while viewing a shared schedule', () => {
  // isSharedSession=true means this tab is showing someone else's share link, not the
  // device's own schedule — players/result/scores/isConfirmed must not leak into this
  // device's local persistence and silently overwrite it. See CLAUDE.md "Sharing".
  it('does not persist players/result/scores/isConfirmed while isSharedSession is true', () => {
    const { result } = renderHook(() => usePlannerState());
    // Initial mount already persisted the empty default roster — capture it so we can
    // confirm the exempted keys stay frozen at that value rather than picking up the update.
    const playersBefore = localStorage.getItem('bp-players');
    act(() =>
      result.current.patchState({
        isSharedSession: true,
        players: [{ name: 'X', gender: 'M' }],
        isConfirmed: true,
      })
    );
    expect(localStorage.getItem('bp-players')).toBe(playersBefore);
    expect(JSON.parse(localStorage.getItem('bp-is-confirmed')!)).toBe(false);
  });

  it('still persists unrelated settings (numCourts) while isSharedSession is true', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ isSharedSession: true, numCourts: 3 }));
    expect(JSON.parse(localStorage.getItem('bp-numCourts')!)).toBe(3);
  });

  it('resumes persisting players/result once isSharedSession turns back off', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ isSharedSession: true, players: [{ name: 'X', gender: 'M' }] }));
    expect(JSON.parse(localStorage.getItem('bp-players')!)).toEqual([]);
    act(() => result.current.patchState({ isSharedSession: false }));
    expect(JSON.parse(localStorage.getItem('bp-players')!)).toEqual([{ name: 'X', gender: 'M' }]);
  });
});
