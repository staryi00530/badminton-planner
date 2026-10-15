// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlannerState } from '../hooks/usePlannerState';
import { captureUndoSnapshot } from './undoSnapshot';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

it('isolates nested schedule, score, live snapshot, notice and archive data from later mutations', () => {
  const { result } = renderHook(() => usePlannerState());
  act(() => result.current.patchState({
    result: { schedule: [], gamesPlayed: [1] },
    scores: { s1c0: { a: '21', b: '19', applied: true, teamA: ['A', 'B'], teamB: ['C', 'D'] } },
    liveGames: [{ slot: 1, court: 0, displayCourt: 2, players: ['A', 'B', 'C', 'D'] }],
    savedPlans: [{ id: 1, tag: 'original', result: { schedule: [], gamesPlayed: [1] }, savedAt: 'today' }],
    sessionChangeNotice: 'Previous notice',
  }));
  const snapshot = captureUndoSnapshot(result.current.state);
  result.current.state.result!.gamesPlayed[0] = 9;
  result.current.state.scores.s1c0!.teamA[0] = 'Changed';
  result.current.state.liveGames[0]!.players![0] = 'Changed';
  result.current.state.savedPlans[0]!.tag = 'Changed';
  expect(snapshot.result!.gamesPlayed).toEqual([1]);
  expect(snapshot.scores.s1c0!.teamA).toEqual(['A', 'B']);
  expect(snapshot.liveGames).toEqual([{ slot: 1, court: 0, displayCourt: 2, players: ['A', 'B', 'C', 'D'] }]);
  expect(snapshot.savedPlans[0]!.tag).toBe('original');
  expect(snapshot.sessionChangeNotice).toBe('Previous notice');
  for (const key of ['undoSnapshot', 'nameInput', 'pinInput', 'activeTab', 'importText']) expect(snapshot).not.toHaveProperty(key);
});
