// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlannerState } from './usePlannerState.js';
import { generateSchedule } from '../algorithm/scheduler';
import type { Player } from '../types';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('independent played history', () => {
  function seedCompleted() {
    const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ id: `id-${i}`, name: `P${i}`, gender: 'M', availFrom: 0, availTo: 11 }));
    const plan = { ...generateSchedule(players, 1, [1])!, planId: 'old-plan' };
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-result', JSON.stringify(plan));
    localStorage.setItem('bp-completed-games', JSON.stringify([{ slot: 1, court: 0 }]));
    localStorage.setItem('bp-scores', JSON.stringify({ s1c0: { a: '21', b: '18', applied: true, teamA: plan.schedule[0]!.courts[0]!.teamA.map(p => p.name), teamB: plan.schedule[0]!.courts[0]!.teamB.map(p => p.name) } }));
    return { players, plan };
  }
  it('migrates completed games once and retains their lineup/score after clear and refresh', () => {
    seedCompleted();
    const first = renderHook(() => usePlannerState());
    expect(first.result.current.state.playedGames).toHaveLength(1);
    expect(first.result.current.state.playedGames[0]?.score).toMatchObject({ a: '21', b: '18' });
    act(() => first.result.current.patchState({ result: null, scores: {}, completedGames: [], liveGames: [] }));
    expect(first.result.current.state.playedGames).toHaveLength(1);
    first.unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.result).toBeNull();
    expect(reloaded.result.current.state.playedGames).toHaveLength(1);
    expect(reloaded.result.current.state.playedGames[0]?.planId).toBe('old-plan');
  });
  it('captures a new Finish and local Undo reverses only that completion', () => {
    const { players, plan } = seedCompleted();
    localStorage.removeItem('bp-completed-games');
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ liveGames: [{ slot: 1, court: 0, players: players.map(p => p.name) }] }));
    act(() => {
      result.current.recordUndo();
      result.current.patchState({ completedGames: [{ slot: 1, court: 0 }], liveGames: [] });
    });
    expect(result.current.state.playedGames).toHaveLength(1);
    expect(result.current.state.playedGames[0]?.teamA.map(p => p.name)).toEqual(plan.schedule[0]!.courts[0]!.teamA.map(p => p.name));
    act(() => result.current.restoreUndo());
    expect(result.current.state.playedGames).toHaveLength(0);
    expect(result.current.state.liveGames).toHaveLength(1);
  });
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
    expect(result.current.state.activeTab).toBe('setup');
    expect(result.current.state.courtOverrides).toEqual({});
  });

  it('defaults an existing schedule to Live session', () => {
    localStorage.setItem('bp-result', JSON.stringify({ schedule: [], gamesPlayed: [] }));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.activeTab).toBe('live');
  });

  it.each(['live', 'setup', 'past', 'pairings', 'archive', 'about'] as const)('retains the selected %s view on refresh with a schedule', activeTab => {
    const { result, unmount } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ result: { schedule: [], gamesPlayed: [] }, activeTab }));
    unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.activeTab).toBe(activeTab);
  });

  it.each(['schedule', 'unknown', null])('falls back to Live session for an invalid persisted view (%s)', activeTab => {
    localStorage.setItem('bp-result', JSON.stringify({ schedule: [], gamesPlayed: [] }));
    localStorage.setItem('bp-active-tab', JSON.stringify(activeTab));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.activeTab).toBe('live');
  });

  it('falls back to Setup when a persisted Live session has no result', () => {
    localStorage.setItem('bp-active-tab', JSON.stringify('live'));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.activeTab).toBe('setup');
  });

  it('loads persisted values from localStorage on init', () => {
    localStorage.setItem('bp-numCourts', JSON.stringify(3));
    localStorage.setItem('bp-players', JSON.stringify([{ name: 'Alice', gender: 'F' }]));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.numCourts).toBe(3);
    expect(result.current.state.players).toMatchObject([{ name: 'Alice', gender: 'F', level: 3, id: expect.any(String), statsKey: 'Alice' }]);
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
  it('captures reducer-current state, restores once atomically, and leaves drafts/navigation alone', () => {
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.undoSnapshot).toBeNull();
    act(() => {
      result.current.patchState({ fromSlot: 3, courtOverrides: { 3: 2 }, suspendedPlayerNames: ['Alice'] });
      result.current.recordUndo();
      result.current.patchState({ fromSlot: 4, courtOverrides: { 4: 5 }, suspendedPlayerNames: [], pinInput: '1234', nameInput: 'Draft', activeTab: 'past' });
    });
    act(() => result.current.restoreUndo());
    expect(result.current.state).toMatchObject({ fromSlot: 3, courtOverrides: { 3: 2 }, suspendedPlayerNames: ['Alice'], pinInput: '1234', nameInput: 'Draft', activeTab: 'past', undoSnapshot: null });
    const restored = result.current.state;
    act(() => result.current.restoreUndo());
    expect(result.current.state).toBe(restored);
  });

  it('replaces the single snapshot and never persists it across reload or schedule replacement', () => {
    const { result, unmount } = renderHook(() => usePlannerState());
    act(() => { result.current.recordUndo(); result.current.patchState({ fromSlot: 2 }); });
    act(() => { result.current.recordUndo(); result.current.patchState({ fromSlot: 3 }); });
    act(() => result.current.restoreUndo());
    expect(result.current.state.fromSlot).toBe(2);
    act(() => result.current.recordUndo());
    act(() => result.current.patchState({ result: null }));
    expect(result.current.state.undoSnapshot).toBeNull();
    act(() => result.current.recordUndo());
    unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.undoSnapshot).toBeNull();
  });

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
  it('hydrates live/completed game snapshots and suspended players only when a result exists', () => {
    const liveGames = [{ slot: 2, court: 1, displayCourt: 3, players: ['Alice', 'Bea', 'Cleo', 'Dee'] }];
    const completedGames = [{ slot: 1, court: 0, players: ['Eli', 'Fran', 'Gia', 'Hal'] }];
    localStorage.setItem('bp-result', JSON.stringify({ schedule: [], gamesPlayed: [] }));
    localStorage.setItem('bp-live-games', JSON.stringify(liveGames));
    localStorage.setItem('bp-completed-games', JSON.stringify(completedGames));
    localStorage.setItem('bp-suspended-player-names', JSON.stringify(['Alice']));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.liveGames).toEqual(liveGames);
    expect(result.current.state.completedGames).toEqual(completedGames);
    expect(result.current.state.suspendedPlayerNames).toEqual(['Alice']);
  });

  it('persists queue updates and player snapshots after a result exists', () => {
    const { result, unmount } = renderHook(() => usePlannerState());
    const liveGames = [{ slot: 2, court: 0, players: ['Alice', 'Bea', 'Cleo', 'Dee'] }];
    const completedGames = [{ slot: 1, court: 0, players: ['Eli', 'Fran', 'Gia', 'Hal'] }];
    act(() => result.current.patchState({ result: { schedule: [], gamesPlayed: [] }, liveGames, completedGames, suspendedPlayerNames: ['Alice'] }));
    expect(JSON.parse(localStorage.getItem('bp-live-games')!)).toEqual(liveGames);
    expect(JSON.parse(localStorage.getItem('bp-completed-games')!)).toEqual(completedGames);
    expect(JSON.parse(localStorage.getItem('bp-suspended-player-names')!)).toEqual(['Alice']);
    unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.liveGames).toEqual(liveGames);
    expect(reloaded.result.current.state.completedGames).toEqual(completedGames);
    expect(reloaded.result.current.state.suspendedPlayerNames).toEqual(['Alice']);
  });

  it('does not hydrate stale queue data without a persisted result', () => {
    localStorage.setItem('bp-live-games', JSON.stringify([{ slot: 9, court: 0, players: ['Old'] }]));
    localStorage.setItem('bp-completed-games', JSON.stringify([{ slot: 8, court: 0, players: ['Older'] }]));
    localStorage.setItem('bp-suspended-player-names', JSON.stringify(['Old']));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.liveGames).toEqual([]);
    expect(result.current.state.completedGames).toEqual([]);
    expect(result.current.state.suspendedPlayerNames).toEqual([]);
  });

  it('restores slot-keyed court overrides on reload without changing base settings', () => {
    const { result, unmount } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ courtOverrides: { 2: 5, 4: 1 } }));
    unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.courtOverrides).toEqual({ 2: 5, 4: 1 });
    expect(reloaded.result.current.state.numCourts).toBe(1);
  });

  it('does not leak shared-session court overrides into the personal session', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ courtOverrides: { 2: 3 } }));
    act(() => result.current.patchState({ isSharedSession: true, courtOverrides: { 1: 5 } }));
    expect(JSON.parse(localStorage.getItem('bp-courtOverrides')!)).toEqual({ 2: 3 });
  });

  it('persists settings changes back to localStorage', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ numCourts: 4 }));
    expect(JSON.parse(localStorage.getItem('bp-numCourts')!)).toBe(4);
  });

  it('persists private player levels across reloads', () => {
    const { result, unmount } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ players: [{ name: 'Alice', gender: 'F', level: 3, availFrom: 0, availTo: 11 }] }));
    expect(JSON.parse(localStorage.getItem('bp-players')!)[0].level).toBe(3);
    unmount();
    const reloaded = renderHook(() => usePlannerState());
    expect(reloaded.result.current.state.players[0]?.level).toBe(3);
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
  it('does not overwrite the local selected view while viewing a shared schedule', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ activeTab: 'about' }));
    act(() => result.current.patchState({ isSharedSession: true, activeTab: 'past' }));
    expect(JSON.parse(localStorage.getItem('bp-active-tab')!)).toBe('about');
  });

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
        players: [{ name: 'X', gender: 'M', availFrom: 0, availTo: 11 }],
        isConfirmed: true,
      })
    );
    expect(localStorage.getItem('bp-players')).toBe(playersBefore);
    expect(JSON.parse(localStorage.getItem('bp-is-confirmed')!)).toBe(false);
  });

  it('does not overwrite personal queue state while viewing a shared session', () => {
    const ownLive = [{ slot: 3, court: 0, players: ['Own A', 'Own B', 'Own C', 'Own D'] }];
    const ownCompleted = [{ slot: 2, court: 1, players: ['Own E', 'Own F', 'Own G', 'Own H'] }];
    localStorage.setItem('bp-result', JSON.stringify({ schedule: [], gamesPlayed: [] }));
    localStorage.setItem('bp-live-games', JSON.stringify(ownLive));
    localStorage.setItem('bp-completed-games', JSON.stringify(ownCompleted));
    localStorage.setItem('bp-suspended-player-names', JSON.stringify(['Own A']));
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({
      isSharedSession: true,
      result: { schedule: [], gamesPlayed: [] },
      liveGames: [{ slot: 1, court: 0, players: ['Shared A', 'Shared B', 'Shared C', 'Shared D'] }],
      completedGames: [],
      suspendedPlayerNames: ['Shared A'],
    }));
    expect(JSON.parse(localStorage.getItem('bp-live-games')!)).toEqual(ownLive);
    expect(JSON.parse(localStorage.getItem('bp-completed-games')!)).toEqual(ownCompleted);
    expect(JSON.parse(localStorage.getItem('bp-suspended-player-names')!)).toEqual(['Own A']);
  });

  it('does not hydrate the personal queue into a shared session after refresh', () => {
    const ownLive = [{ slot: 3, court: 0, players: ['Own A', 'Own B', 'Own C', 'Own D'] }];
    localStorage.setItem('bp-result', JSON.stringify({ schedule: [], gamesPlayed: [] }));
    localStorage.setItem('bp-live-games', JSON.stringify(ownLive));
    sessionStorage.setItem('bp-is-shared-session', JSON.stringify(true));
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.isSharedSession).toBe(true);
    expect(result.current.state.liveGames).toEqual([]);
    expect(JSON.parse(localStorage.getItem('bp-live-games')!)).toEqual(ownLive);
  });

  it('keeps personal court settings separate while isSharedSession is true', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ isSharedSession: true, numCourts: 3 }));
    expect(JSON.parse(localStorage.getItem('bp-numCourts')!)).toBe(1);
  });

  it('resumes persisting players/result once isSharedSession turns back off', () => {
    const { result } = renderHook(() => usePlannerState());
    act(() => result.current.patchState({ isSharedSession: true, players: [{ name: 'X', gender: 'M', availFrom: 0, availTo: 11 }] }));
    expect(JSON.parse(localStorage.getItem('bp-players')!)).toEqual([]);
    act(() => result.current.patchState({ isSharedSession: false }));
    expect(JSON.parse(localStorage.getItem('bp-players')!)).toEqual([{ name: 'X', gender: 'M', availFrom: 0, availTo: 11 }]);
  });
});

describe('five-level migration', () => {
  it('migrates legacy roster and bank once and retains quarantine across reloads', () => {
    const players = [1, 2, 3].map((level, i) => ({ name: `L${i}`, gender: 'M', level, quarantined: i === 0 }));
    localStorage.setItem('bp-players', JSON.stringify(players));
    localStorage.setItem('bp-player-history', JSON.stringify(players));
    const first = renderHook(() => usePlannerState());
    expect(first.result.current.state.players.map(p => p.level)).toEqual([1, 3, 5]);
    expect(first.result.current.state.playerHistory.map(p => p.level)).toEqual([1, 3, 5]);
    act(() => first.result.current.patchState({ players: first.result.current.state.players.map(p => ({ ...p, level: 4 })) }));
    first.unmount();
    const second = renderHook(() => usePlannerState());
    expect(second.result.current.state.players.map(p => p.level)).toEqual([4, 4, 4]);
    expect(second.result.current.state.players[0]!.quarantined).toBe(true);
    expect(second.result.current.state.playerHistory.map(p => p.level)).toEqual([1, 3, 5]);
  });
});

describe('beta storage isolation', () => {
  it('copies the main roster once and migrates only the beta copy', () => {
    vi.stubEnv('VITE_BETA', 'true');
    const original = JSON.stringify([{ name: 'Personal', gender: 'M', level: 3, availFrom: 0, availTo: 11 }]);
    localStorage.setItem('bp-players', original);
    const first = renderHook(() => usePlannerState());
    expect(first.result.current.state.players[0]!.level).toBe(5);
    act(() => first.result.current.patchState({ players: [{ name: 'Beta only', gender: 'F', level: 4, quarantined: true, availFrom: 0, availTo: 11 }] }));
    expect(localStorage.getItem('bp-players')).toBe(original);
    first.unmount();
    localStorage.setItem('bp-players', JSON.stringify([{ name: 'Changed main', gender: 'M', level: 1 }]));
    const second = renderHook(() => usePlannerState());
    expect(second.result.current.state.players[0]).toMatchObject({ name: 'Beta only', level: 4, quarantined: true });
  });

  it('does not restore a cleared beta roster from main on reload', () => {
    vi.stubEnv('VITE_BETA', 'true');
    localStorage.setItem('bp-players', JSON.stringify([{ name: 'Personal', gender: 'M', level: 2 }]));
    const first = renderHook(() => usePlannerState());
    act(() => first.result.current.patchState({ players: [] }));
    first.unmount();
    const second = renderHook(() => usePlannerState());
    expect(second.result.current.state.players).toEqual([]);
    expect(JSON.parse(localStorage.getItem('bp-players')!)).toHaveLength(1);
  });

  it('keeps main and beta share bindings separate', () => {
    vi.stubEnv('VITE_BETA', 'true');
    sessionStorage.setItem('bp-share-id', JSON.stringify('main-share'));
    sessionStorage.setItem('bp-is-shared-session', 'true');
    const { result } = renderHook(() => usePlannerState());
    expect(result.current.state.isSharedSession).toBe(false);
    act(() => result.current.patchState({ shareId: 'beta-share', isSharedSession: true }));
    expect(JSON.parse(sessionStorage.getItem('bp-share-id')!)).toBe('main-share');
    expect(JSON.parse(sessionStorage.getItem('beta:bp-share-id')!)).toBe('beta-share');
  });
});

it('does not mark the personal roster migrated while a shared session prevents saving it', () => {
  localStorage.setItem('bp-players', JSON.stringify([{ name: 'Personal', gender: 'M', level: 3 }]));
  localStorage.setItem('bp-player-history', JSON.stringify([{ name: 'Bank', gender: 'F', level: 2 }]));
  sessionStorage.setItem('bp-is-shared-session', 'true');
  const shared = renderHook(() => usePlannerState());
  shared.unmount();
  sessionStorage.clear();
  const personal = renderHook(() => usePlannerState());
  expect(personal.result.current.state.players[0]!.level).toBe(5);
  expect(personal.result.current.state.playerHistory[0]!.level).toBe(3);
});
