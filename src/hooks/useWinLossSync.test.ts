// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const firebaseMock = vi.hoisted(() => ({
  isFirebaseConfigured: vi.fn(),
  loadWinLoss: vi.fn(),
  saveWinLoss: vi.fn(),
}));
vi.mock('../firebase', () => firebaseMock);

const { useWinLossSync } = await import('./useWinLossSync.js');

function setup(overrides: Partial<Parameters<typeof useWinLossSync>[0]> = {}) {
  const patchState = vi.fn();
  const props: Parameters<typeof useWinLossSync>[0] = { winLoss: {}, scores: {}, isAdmin: true, patchState, ...overrides };
  const { result, rerender } = renderHook((p) => useWinLossSync(p ?? props), { initialProps: props });
  return { result, patchState, rerender };
}

beforeEach(() => {
  vi.clearAllMocks();
  firebaseMock.isFirebaseConfigured.mockReturnValue(false);
  firebaseMock.loadWinLoss.mockResolvedValue({});
  firebaseMock.saveWinLoss.mockResolvedValue(undefined);
});

describe('useWinLossSync — load on mount', () => {
  it('does nothing when Firebase is not configured', async () => {
    const { result } = setup();
    expect(result.current.dbSynced).toBeNull();
    expect(firebaseMock.loadWinLoss).not.toHaveBeenCalled();
  });

  it('merges remote records into local winLoss, keeping the higher count per player', async () => {
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    firebaseMock.loadWinLoss.mockResolvedValue({
      Alice: { wins: 5, losses: 1 },
      Bob: { wins: 1, losses: 1 },
    });
    const patchState = vi.fn();
    renderHook(() => useWinLossSync({ winLoss: { Alice: { wins: 2, losses: 3 } }, scores: {}, isAdmin: true, patchState }));

    await waitFor(() => expect(patchState).toHaveBeenCalled());
    const patch = patchState.mock.calls[0]![0];
    expect(patch.winLoss).toEqual({
      Alice: { wins: 5, losses: 3 }, // max(2,5) wins, max(3,1) losses
      Bob: { wins: 1, losses: 1 },
    });
  });

  it('sets dbSynced to error when the load fails', async () => {
    // isAdmin: false keeps the push-on-change effect from also running (it early-returns
    // without isAdmin) so this isolates the load-on-mount effect's outcome.
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    firebaseMock.loadWinLoss.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useWinLossSync({ winLoss: {}, scores: {}, isAdmin: false, patchState: vi.fn() }));
    await waitFor(() => expect(result.current.dbSynced).toBe('error'));
  });
});

describe('useWinLossSync — push on change', () => {
  it('pushes to Firebase only when admin', async () => {
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    renderHook(() => useWinLossSync({ winLoss: { A: { wins: 1, losses: 0 } }, scores: {}, isAdmin: false, patchState: vi.fn() }));
    await Promise.resolve();
    expect(firebaseMock.saveWinLoss).not.toHaveBeenCalled();
  });

  it('pushes to Firebase when winLoss changes and admin', async () => {
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    const { rerender } = renderHook((p: Parameters<typeof useWinLossSync>[0]) => useWinLossSync(p), {
      initialProps: { winLoss: {}, scores: {}, isAdmin: true, patchState: vi.fn() },
    });
    rerender({ winLoss: { A: { wins: 1, losses: 0 } }, scores: {}, isAdmin: true, patchState: vi.fn() });
    await waitFor(() => expect(firebaseMock.saveWinLoss).toHaveBeenCalledWith({ A: { wins: 1, losses: 0 } }));
  });
});

describe('useWinLossSync — computeSkill', () => {
  it('delegates to the skill util', () => {
    const { result } = setup({ winLoss: { A: { wins: 3, losses: 1 } } });
    expect(result.current.computeSkill('A')).toBe(0.75);
    expect(result.current.computeSkill('Nobody')).toBe(0.5);
  });
});

describe('useWinLossSync — updateScore', () => {
  it('does nothing when not admin', () => {
    const { result, patchState } = setup({ isAdmin: false });
    act(() => result.current.updateScore(1, 0, '21', '15', ['A', 'B'], ['C', 'D']));
    expect(patchState).not.toHaveBeenCalled();
  });

  it('applies a valid score: records the entry and updates winLoss', () => {
    const { result, patchState } = setup();
    act(() => result.current.updateScore(1, 0, '21', '15', ['A', 'B'], ['C', 'D']));
    const patch = patchState.mock.calls[0]![0];
    expect(patch.scores.s1c0).toEqual({ a: '21', b: '15', applied: true, teamA: ['A', 'B'], teamB: ['C', 'D'] });
    expect(patch.winLoss).toEqual({
      A: { wins: 1, losses: 0 }, B: { wins: 1, losses: 0 },
      C: { wins: 0, losses: 1 }, D: { wins: 0, losses: 1 },
    });
  });

  it('records an invalid score as unapplied, without touching winLoss', () => {
    const { result, patchState } = setup();
    act(() => result.current.updateScore(1, 0, '21', '20', ['A', 'B'], ['C', 'D']));
    const patch = patchState.mock.calls[0]![0];
    expect(patch.scores.s1c0.applied).toBe(false);
    expect(patch.winLoss).toEqual({});
  });

  it('reverses the previous applied result before applying a correction', () => {
    const scores = { s1c0: { a: '21', b: '15', applied: true, teamA: ['A', 'B'], teamB: ['C', 'D'] } };
    const winLoss = { A: { wins: 1, losses: 0 }, B: { wins: 1, losses: 0 }, C: { wins: 0, losses: 1 }, D: { wins: 0, losses: 1 } };
    const { result, patchState } = setup({ scores, winLoss });
    // Correct the score to the other team winning.
    act(() => result.current.updateScore(1, 0, '15', '21', ['A', 'B'], ['C', 'D']));
    const patch = patchState.mock.calls[0]![0];
    expect(patch.winLoss).toEqual({
      A: { wins: 0, losses: 1 }, B: { wins: 0, losses: 1 },
      C: { wins: 1, losses: 0 }, D: { wins: 1, losses: 0 },
    });
  });
});

describe('useWinLossSync — clearWinLoss', () => {
  it('resets winLoss locally', () => {
    const { result, patchState } = setup();
    act(() => result.current.clearWinLoss());
    expect(patchState).toHaveBeenCalledWith({ winLoss: {} });
  });

  it('also pushes the reset to Firebase when configured and admin', () => {
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    const { result } = setup({ isAdmin: true });
    act(() => result.current.clearWinLoss());
    expect(firebaseMock.saveWinLoss).toHaveBeenCalledWith({});
  });

  it('does not push to Firebase when not admin', () => {
    firebaseMock.isFirebaseConfigured.mockReturnValue(true);
    const { result } = setup({ isAdmin: false });
    act(() => result.current.clearWinLoss());
    expect(firebaseMock.saveWinLoss).not.toHaveBeenCalled();
  });
});

describe('renamed player statistics compatibility',()=>{
 it('uses the permanent statistics key for skill',()=>{
 const {result}=setup({players:[{name:'Alicia',statsKey:'Alice'}],winLoss:{Alice:{wins:3,losses:1}}});
 expect(result.current.computeSkill('Alicia')).toBe(.75);
 });
 it('rolls back and reapplies scores through the statistics key while retaining display lineups',()=>{
 const {result,patchState}=setup({players:[{name:'Alicia',statsKey:'Alice'}],winLoss:{Alice:{wins:1,losses:0},Bob:{wins:0,losses:1}},scores:{s1c0:{a:'21',b:'19',applied:true,teamA:['Alicia'],teamB:['Bob']}}});
 act(()=>result.current.updateScore(1,0,'18','21',['Alicia'],['Bob']));
 expect(patchState.mock.calls[0]![0].winLoss).toEqual({Alice:{wins:0,losses:1},Bob:{wins:1,losses:0}});
 expect(patchState.mock.calls[0]![0].scores.s1c0).toEqual({a:'18',b:'21',applied:true,teamA:['Alicia'],teamB:['Bob']});
 });
});
