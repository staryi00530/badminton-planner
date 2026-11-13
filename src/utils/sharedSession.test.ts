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
  it('tracks waiting through session start, promotion, unrelated Finish and guarded Undo', () => {
    const base = session();
    base.slots.push({ ...base.slots[0]!, s: 3 });
    base.ids = base.p.map((_, index) => `p${index}`);
    const started = applySharedAction(base, { type: 'start_timers', id: 'timers', at: 1000,
      gameIds: base.runtime!.live!.map(game => sharedGameId(base, game.slot, game.court)) })!;
    expect(started.runtime!.waitingClock).toEqual({ trackingStartedAt: 1000, since: { p8: 1000, p9: 1000, p10: 1000, p11: 1000 } });
    const finished = applySharedAction(started, { type: 'finish', id: 'one', at: 2000, gameId: sharedGameId(started, 1, 0) })!;
    expect(finished.runtime!.waitingClock!.since).toEqual({ p0: 2000, p1: 2000, p2: 2000, p3: 2000 });
    const other = applySharedAction(finished, { type: 'finish', id: 'two', at: 3000, gameId: sharedGameId(finished, 1, 1) })!;
    expect(other.runtime!.waitingClock!.since.p2).toBe(2000);
    const undone = applySharedAction(other, { type: 'undo', id: 'undo-two', target: 'two', at: 4000, confirmDependents: true })!;
    expect(undone.runtime!.waitingClock!.since.p0).toBe(2000);
    expect(undone.runtime!.waitingClock!.since.p2).toBe(2000);
    const undoneFirst = applySharedAction(undone, { type: 'undo', id: 'undo-one', target: 'one', at: 5000, confirmDependents: true })!;
    expect(undoneFirst.runtime!.waitingClock!.since).toEqual({ p8: 1000, p9: 1000, p10: 1000, p11: 1000 });
  });
  it('keeps clocks across legacy organizer commits and clears them on history reset', () => {
    const base = { ...session(), planId: 'first', history: [], historyEpoch: 0 };
    base.ids = base.p.map((_, index) => `p${index}`);
    const started = applySharedAction(base, { type: 'start_timers', id: 'timers', at: 1000,
      gameIds: base.runtime!.live!.map(game => sharedGameId(base, game.slot, game.court)) })!;
    const next = structuredClone(started);
    delete next.runtime!.waitingClock;
    const committed = commitSharedSnapshot(started, started.revision!, next)!;
    expect(committed.runtime!.waitingClock).toEqual(started.runtime!.waitingClock);
    const reset = commitSharedSnapshot(committed, committed.revision!, { ...committed, planId: 'second', history: [], historyEpoch: 1 })!;
    expect(reset.runtime!.waitingClock).toEqual({ since: {} });
  });
  it('captures a Finish once in independent history and preserves it across a new plan', () => {
    const base = { ...session(), planId: 'first', history: [], historyEpoch: 0 };
    const action = { type: 'finish' as const, id: 'finish-1', gameId: sharedGameId(base, 1, 0) };
    const done = applySharedAction(base, action)!;
    expect(done.history).toHaveLength(1);
    expect(applySharedAction(done, action)?.history).toHaveLength(1);
    const replacement = { ...base, planId: 'second', history: done.history, runtime: { live: [{ slot: 1, court: 0 }], completed: [] } };
    const rerolled = commitSharedSnapshot(done, done.revision!, replacement)!;
    expect(rerolled.history).toHaveLength(1);
    expect(applySharedAction(rerolled, { ...action, id: 'stale-finish' })).toBeNull();
  });
  it('allows deliberate history reset only with a new plan and prevents stale reset from dropping a Finish', () => {
    const base = { ...session(), planId: 'first', history: [], historyEpoch: 0 };
    const done = applySharedAction(base, { type: 'finish', id: 'a', gameId: sharedGameId(base, 1, 0) })!;
    expect(commitSharedSnapshot(done, done.revision!, { ...done, history: [], historyEpoch: 1 })).toBeNull();
    const reset = { ...base, planId: 'second', history: [], historyEpoch: 1 };
    expect(commitSharedSnapshot(done, 0, reset)).toBeNull();
    expect(commitSharedSnapshot(done, done.revision!, reset)?.history).toEqual([]);
  });
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


describe('shared court activation timestamps', () => {
  it('stamps Finish promotion, preserves other courts and restores Undo time', () => {
    const base = session();
    base.runtime!.live![0]!.startedAt = 100;
    base.runtime!.live![1]!.startedAt = 200;
    const action = { type: 'finish' as const, id: 'timed', gameId: sharedGameId(base, 1, 0), at: 1000 };
    const done = applySharedAction(base, action)!;
    expect(done.runtime?.live?.map(g => g.startedAt)).toEqual([200, 1000]);
    expect(applySharedAction(done, action)).toEqual(done);
    expect(applySharedAction(done, { ...action, id: 'duplicate', at: 2000 })?.runtime).toEqual(done.runtime);
    const undone = applySharedAction(done, { type: 'undo', id: 'undo-time', target: 'timed', confirmDependents: true })!;
    expect(undone.runtime?.live?.find(g => g.court === 0)?.startedAt).toBe(100);
  });
  it.each([0, 1234, undefined, -1, 1.5, NaN, Infinity])('uses only valid explicit activation time %s', at => {
    const base = session();
    base.runtime!.live = [{ slot: 1, court: 1 }];
    const action = { type: 'start' as const, id: 'start-time', gameId: sharedGameId(base, 1, 0), at };
    const started = applySharedAction(base, action)!;
    const active = started.runtime!.live!.find(g => g.court === 0)!;
    expect(active.startedAt).toBe(at !== undefined && Number.isInteger(at) && at >= 0 ? at : undefined);
    expect(applySharedAction(started, { ...action, id: 'retry', at: 9000 })?.runtime).toEqual(started.runtime);
  });
  it('keeps authoritative active time across ordinary commits including legacy unknown time', () => {
    const base = session();
    base.runtime!.live![0]!.startedAt = 100;
    const next = structuredClone(base);
    delete next.runtime!.live![0]!.startedAt;
    next.runtime!.live![1]!.startedAt = 9000;
    expect(commitSharedSnapshot(base, 0, next)?.runtime?.live?.map(g => g.startedAt)).toEqual([100, undefined]);
    next.runtime!.live![0]!.startedAt = 5000;
    expect(commitSharedSnapshot(base, 0, next)?.runtime?.live?.[0]?.startedAt).toBe(100);
    next.planId = 'new';
    expect(commitSharedSnapshot(base, 0, next)?.runtime?.live?.[0]?.startedAt).toBe(5000);
  });
});


it('accepts fresh timestamps for new live games or changed lineups in snapshot commits', () => {
  const base = session();
  base.runtime!.live![0]!.startedAt = 100;
  const next = structuredClone(base);
  next.slots[0]!.c[0] = [[0, 1], [2, 8]];
  next.runtime!.live![0]!.startedAt = 5000;
  next.runtime!.live!.push({ slot: 2, court: 0, startedAt: 6000 });
  const committed = commitSharedSnapshot(base, 0, next)!;
  expect(committed.runtime?.live?.map(g => g.startedAt)).toEqual([5000, undefined, 6000]);
});
it.each([undefined, -1, 0.5, NaN, Infinity])('omits invalid or missing Finish replacement time %s', at => {
  const base = session();
  const done = applySharedAction(base, { type: 'finish', id: 'legacy', gameId: sharedGameId(base, 1, 0), at })!;
  expect(done.runtime?.live?.find(g => g.slot === 2)).not.toHaveProperty('startedAt');
});


describe('shared session timer start', () => {
  it('does not start waiting clocks from a stale timer request', () => {
    const base = { ...session(), planId: 'new' };
    const old = { ...base, planId: 'old' };
    const saved = applySharedAction(base, { type: 'start_timers', id: 'stale', at: 1000, gameIds: [sharedGameId(old, 1, 0)] })!;
    expect(saved.runtime?.waitingClock?.trackingStartedAt).toBeUndefined();
  });
  it('starts requested unknown live clocks while preserving timed courts and history', () => {
    const base = session();
    base.runtime!.live![1]!.startedAt = 100;
    const action = { type: 'start_timers' as const, id: 'timers', at: 1000, gameIds: base.runtime!.live!.map(g => sharedGameId(base, g.slot, g.court)) };
    const started = applySharedAction(base, action)!;
    expect(started.runtime?.live?.map(g => g.startedAt)).toEqual([1000, 100]);
    expect(started.actions).toEqual(base.actions);
    expect(applySharedAction(started, { ...action, at: 2000 })).toEqual(started);
    expect(applySharedAction(started, { ...action, id: 'timers-2', at: 3000 })?.runtime).toEqual(started.runtime);
  });
  it('only starts selected currently live identities and rejects old plan identities', () => {
    const base = { ...session(), planId: 'new' };
    const old = { ...base, planId: 'old' };
    const started = applySharedAction(base, { type: 'start_timers', id: 'select', at: 1000, gameIds: [sharedGameId(base, 1, 0), sharedGameId(old, 1, 1), sharedGameId(base, 2, 0)] })!;
    expect(started.runtime?.live?.map(g => g.startedAt)).toEqual([1000, undefined]);
  });
  it.each([-1, 0.5, NaN, Infinity, undefined, '123', null])('rejects invalid bulk start time %s', at => {
    const base = session();
    expect(applySharedAction(base, { type: 'start_timers', id: 'bad', at, gameIds: [sharedGameId(base, 1, 0)] } as any)).toBeNull();
    expect(base.runtime?.live?.[0]).not.toHaveProperty('startedAt');
  });
  it.each([undefined, null, 'not-array', [12], [{}]])('rejects malformed game identities %s', gameIds => {
    expect(applySharedAction(session(), { type: 'start_timers', id: 'bad', at: 1000, gameIds } as any)).toBeNull();
  });
});

describe('shared recovered capacity progress floor', () => {
  function recovered(): SharePayload {
    const all = Array.from({ length: 28 }, (_, i) => [`P${i}`, 'M'] as [string, 'M']);
    return { v: 1, p: all, cfg: { g: 15, c: 4, courtOverrides: { 4: 5 }, capacityProgressFloorSlot: 4 }, planId: 'recovered', historyEpoch: 0, revision: 0,
      slots: [
        { s: 1, c: [[[0,1],[2,3]], [[4,5],[6,7]]], sit: [] },
        { s: 2, c: [[[8,9],[10,11]], [[12,13],[14,15]], [[16,17],[18,19]]], sit: [] },
        { s: 3, c: [[[20,21],[22,23]]], sit: [] },
        { s: 4, c: [[[24,25],[26,27]]], sit: [] },
      ], runtime: { live: [{slot:1,court:0,displayCourt:0}, {slot:1,court:1,displayCourt:1}, {slot:2,court:0,displayCourt:2}, {slot:2,court:1,displayCourt:3}, {slot:2,court:2,displayCourt:4}], completed: [] } };
  }
  it('replaces a Finish at five courts while recovered runtime is still in older slots', () => {
    const base = recovered();
    const next = applySharedAction(base, { type: 'finish', id: 'finish-floor', gameId: sharedGameId(base, 1, 0), at: 1000 })!;
    expect(next.runtime!.live).toHaveLength(5);
    expect(next.runtime!.live).toContainEqual(expect.objectContaining({slot:3,court:0,displayCourt:0}));
    expect(next.cfg!.capacityProgressFloorSlot).toBe(4);
  });
  it('honors an explicit four-court override at the floor instead of deriving capacity from live count', () => {
    const base = recovered();
    base.cfg!.courtOverrides = {4:4};
    const next = applySharedAction(base, { type: 'finish', id: 'finish-reduced', gameId: sharedGameId(base, 1, 0), at: 1000 })!;
    expect(next.runtime!.live).toHaveLength(4);
  });
  it('keeps the floor across legacy same-epoch commits but clears it on an explicit history reset', () => {
    const base = recovered();
    const legacy = structuredClone(base);
    delete legacy.cfg!.capacityProgressFloorSlot;
    expect(commitSharedSnapshot(base, 0, legacy)!.cfg!.capacityProgressFloorSlot).toBe(4);
    const reset = { ...legacy, planId: 'reset', history: [], historyEpoch: 1 };
    expect(commitSharedSnapshot(base, 0, reset)!.cfg!.capacityProgressFloorSlot).toBeUndefined();
  });
});
