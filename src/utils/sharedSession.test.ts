import { describe, expect, it } from 'vitest';
import { applySharedAction, commitSharedSnapshot, sharedGameId } from './sharedSession';
import type { SharePayload } from '../types';

function session(): SharePayload {
  return {
    v: 1, p: Array.from({ length: 12 }, (_, i) => [`P${i}`, 'M']),
    cfg: { g: 15, c: 2 },
    slots: [
      { s: 1, c: [[[0, 1], [2, 3]], [[4, 5], [6, 7]]], sit: [8, 9, 10, 11] },
      { s: 2, c: [[[8, 9], [10, 11]], [[0, 1], [4, 5]]], sit: [2, 3, 6, 7] },
    ],
    runtime: { live: [{ slot: 1, court: 0, displayCourt: 0 }, { slot: 1, court: 1, displayCourt: 1 }], completed: [] },
    revision: 0,
  };
}

describe('shared session transactions', () => {
  it('rejects a stale organizer snapshot instead of overwriting another finish', () => {
    const base = session();
    const latest = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    expect(commitSharedSnapshot(latest, 0, base)).toBeNull();
    expect(commitSharedSnapshot(latest, 1, latest)?.revision).toBe(2);
  });
  it('finishes once, promotes a playable group and retains concurrent finishes', () => {
    const base = session();
    const first = { type: 'finish' as const, id: 'a', gameId: sharedGameId(base, 1, 0) };
    const a = applySharedAction(base, first)!;
    expect(a.runtime?.completed).toHaveLength(1);
    expect(a.runtime?.live?.map(g => [g.slot, g.court])).toEqual([[1, 1], [2, 0]]);
    expect(applySharedAction(a, first)).toEqual(a);
    const b = applySharedAction(a, { type: 'finish', id: 'b', gameId: sharedGameId(base, 1, 1) })!;
    expect(b.runtime?.completed).toHaveLength(2);
    expect(b.runtime?.live).toHaveLength(2);
    const names = b.runtime!.live!.flatMap(g => b.slots.find(s => s.s === g.slot)!.c[g.court]!.flat());
    expect(new Set(names).size).toBe(names.length);
  });
  it('undoes an accidental finish while retaining unrelated metadata', () => {
    const base = session();
    const finished = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    finished.confirmed = true;
    expect(applySharedAction(finished, { type: 'undo', id: 'u', target: 'a' })).toBeNull();
    const undone = applySharedAction(finished, { type: 'undo', id: 'u', target: 'a', confirmDependents: true })!;
    expect(undone.runtime?.live).toEqual(base.runtime?.live);
    expect(undone.runtime?.completed ?? []).toEqual([]);
    expect(undone.confirmed).toBe(true);
  });
  it('refuses undo once a promoted replacement has finished', () => {
    const base = session();
    const a = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    const b = applySharedAction(a, { type: 'finish', id: 'b', gameId: sharedGameId(a, 2, 0) })!;
    expect(applySharedAction(b, { type: 'undo', id: 'u', target: 'a' })).toBeNull();
  });
  it('refuses a stale game identity after its lineup changed', () => {
    const base = session();
    const id = sharedGameId(base, 1, 0);
    base.slots[0]!.c[0] = [[0, 1], [2, 8]];
    expect(applySharedAction(base, { type: 'finish', id: 'a', gameId: id })).toBeNull();
  });
  it('does not replay a Finish request that another device has undone', () => {
    const base = session();
    const action = { type: 'finish' as const, id: 'a', gameId: sharedGameId(base, 1, 0) };
    const finished = applySharedAction(base, action)!;
    const undone = applySharedAction(finished, { type: 'undo', id: 'u', target: 'a', confirmDependents: true })!;
    expect(applySharedAction(undone, action)).toEqual(undone);
  });
  it('remembers a second device duplicate Finish request even after Undo', () => {
    const base = session();
    const a = { type: 'finish' as const, id: 'a', gameId: sharedGameId(base, 1, 0) };
    const b = { ...a, id: 'b' };
    const finished = applySharedAction(applySharedAction(base, a)!, b)!;
    const undone = applySharedAction(finished, { type: 'undo', id: 'u', target: 'a', confirmDependents: true })!;
    expect(applySharedAction(undone, b)).toEqual(undone);
  });
  it('promotes into an open lane after the finishing lane was closed by a reduction', () => {
    const base = session();
    base.cfg = { g: 15, c: 4, courtOverrides: { 2: 2 } };
    base.runtime!.live = [{ slot: 1, court: 0, displayCourt: 2 }, { slot: 1, court: 1, displayCourt: 3 }];
    const finished = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 1) })!;
    expect(finished.runtime?.live?.find(g => g.slot === 2)?.displayCourt).toBe(0);
  });
  it('refuses undo if a promoted game was edited after the Finish', () => {
    const base = session();
    const finished = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    finished.slots[1]!.c[0] = [[8, 9], [10, 0]];
    expect(applySharedAction(finished, { type: 'undo', id: 'u', target: 'a', confirmDependents: true })).toBeNull();
  });
  it('respects a future court reduction when deciding whether to promote', () => {
    const base = session();
    base.cfg!.courtOverrides = { 2: 1 };
    const finished = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    expect(finished.runtime?.live).toHaveLength(1);
  });
});
