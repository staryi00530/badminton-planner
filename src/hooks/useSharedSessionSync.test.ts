// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharedSessionSync, type SharedTransport } from './useSharedSessionSync';
import type { SharePayload } from '../types';
import { commitSharedSnapshot, applySharedAction } from '../utils/sharedSession';
import { plannerStorageKey } from '../utils/plannerStorage';

const data = (): SharePayload => ({ v: 1, revision: 0, p: [['A', 'M'], ['B', 'M'], ['C', 'M'], ['D', 'M']], cfg: { g: 15, c: 1 }, slots: [{ s: 1, c: [[[0, 1], [2, 3]]], sit: [] }], runtime: { live: [{ slot: 1, court: 0 }], completed: [] } });
function transport(initial = data()) {
  let current = initial;
  const subscribers = new Set<(p: SharePayload | null) => void>();
  const api: SharedTransport = {
    fetch: async () => ({ status: 'ok', data: current }),
    subscribe: (_, callback) => { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
    commit: async (_, rev, payload) => {
      const next = commitSharedSnapshot(current, rev, payload);
      if (!next) throw Object.assign(new Error('conflict'), { code: 'share/conflict' });
      current = next; subscribers.forEach(callback => callback(current)); return current;
    },
    action: async (_, action) => {
      const next = applySharedAction(current, action);
      if (!next) throw new Error('blocked');
      current = next; subscribers.forEach(callback => callback(current)); return current;
    },
  };
  return { api, read: () => current, remote: (next: SharePayload) => { current = next; subscribers.forEach(callback => callback(next)); } };
}

describe('shared autosave and recovery', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('keeps independent tab drafts when one tab saves and the other conflicts', async () => {
    const makeStorage = (): Storage => {
      const values = new Map<string, string>();
      return { get length() { return values.size; }, clear: () => values.clear(), key: i => [...values.keys()][i] ?? null,
        getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
    };
    const storageA = makeStorage(), storageB = makeStorage();
    const cloud = transport();
    const aTransport: SharedTransport = { ...cloud.api, commit: async () => { throw new Error('offline'); } };
    const bTransport: SharedTransport = { ...cloud.api, commit: async () => { throw new Error('offline'); } };
    const a = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: p => p, transport: aTransport, recoveryStorage: storageA }), { initialProps: { payload: data() } });
    const b = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: p => p, transport: bTransport, recoveryStorage: storageB }), { initialProps: { payload: data() } });
    await waitFor(() => expect([a.result.current.status, b.result.current.status]).toEqual(['saved', 'saved']));
    a.rerender({ payload: { ...data(), confirmed: true } });
    b.rerender({ payload: { ...data(), cfg: { g: 15, c: 1, sessionStart: '20:00' } } });
    await waitFor(() => expect([a.result.current.status, b.result.current.status]).toEqual(['offline', 'offline']));
    aTransport.commit = cloud.api.commit;
    await act(async () => { await a.result.current.saveNow(); });
    expect(storageA.getItem(plannerStorageKey('bp-share-draft:one'))).toBeNull();
    expect(storageB.getItem(plannerStorageKey('bp-share-draft:one'))).toContain('20:00');
    expect(b.result.current.status).toBe('conflict');
  });
  it('keeps conflict recovery available when an offline Finish is also pending', async () => {
    const base = data();
    sessionStorage.setItem(plannerStorageKey('bp-share-draft:one'), JSON.stringify({ base, draft: { ...base, confirmed: true } }));
    sessionStorage.setItem(plannerStorageKey('bp-share-action:one'), JSON.stringify({ type: 'finish', id: 'a', gameId: JSON.stringify([1, 0, ['A', 'B', 'C', 'D']]) }));
    const t = transport({ ...base, revision: 1 });
    const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: base, isAdmin: true, applyRemote: p => p, transport: t.api }));
    await waitFor(() => expect(result.current.status).toBe('conflict'));
  });
  it('preserves edits made while a Finish request is in flight', async () => {
    localStorage.clear();
    const t = transport();
    const originalAction = t.api.action;
    let resolve!: () => void;
    t.api.action = async (id, action) => { await new Promise<void>(r => { resolve = r; }); return originalAction(id, action); };
    const apply = vi.fn((p: SharePayload) => p);
    const { result, rerender } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: apply, transport: t.api }), { initialProps: { payload: data() } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    let operation!: Promise<boolean>;
    act(() => { operation = result.current.performAction({ type: 'finish', id: 'a', gameId: JSON.stringify([1, 0, ['A', 'B', 'C', 'D']]) }); });
    rerender({ payload: { ...data(), confirmed: true } });
    await act(async () => { resolve(); await operation; });
    expect(result.current.status).toBe('conflict');
    expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).toContain('confirmed');
    expect(apply).not.toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
  });
  it('retries loading after the initial connection fails', async () => {
    localStorage.clear();
    const t = transport();
    const fetch = t.api.fetch;
    let attempts = 0;
    t.api.fetch = async id => { if (attempts++ === 0) throw new Error('offline'); return fetch(id); };
    const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: p => p, transport: t.api }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(attempts).toBe(2);
  });
  it('restores the retained draft before a cold offline fetch can fail', async () => {
    localStorage.clear(); sessionStorage.clear();
    const t = transport();
    sessionStorage.setItem(plannerStorageKey('bp-share-draft:one'), JSON.stringify({ base: data(), draft: { ...data(), confirmed: true } }));
    t.api.fetch = async () => { throw new Error('offline'); };
    const apply = vi.fn((p: SharePayload) => p);
    const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });
  it('applies a buffered newer lineup when a stale Finish is rejected', async () => {
    localStorage.clear(); sessionStorage.clear();
    const t = transport();
    let reject!: (error: unknown) => void;
    t.api.action = () => new Promise((_resolve, r) => { reject = r; });
    const apply = vi.fn((p: SharePayload) => p);
    const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    let request!: Promise<boolean>;
    act(() => { request = result.current.performAction({ type: 'finish', id: 'a', gameId: JSON.stringify([1, 0, ['A', 'B', 'C', 'D']]) }); });
    act(() => t.remote({ ...data(), revision: 1, confirmed: true }));
    await act(async () => { reject(Object.assign(new Error('changed'), { code: 'share/action-blocked' })); await request; });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1, confirmed: true }));
  });
  it('autosaves edits and reloads the cloud session after refresh', async () => {
    localStorage.clear();
    const t = transport();
    const apply = vi.fn((p: SharePayload) => p);
    const { result, rerender, unmount } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: apply, transport: t.api }), { initialProps: { payload: data() } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    const draft = { ...data(), confirmed: true };
    rerender({ payload: draft });
    expect(result.current.hasPendingChanges).toBe(true);
    await waitFor(() => expect(t.read().confirmed).toBe(true));
    await waitFor(() => expect(result.current.hasPendingChanges).toBe(false));
    expect(t.read().revision).toBe(1);
    unmount();
    renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    await waitFor(() => expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed: true })));
  });
  it('keeps an offline draft through refresh and never attaches it to a different share', async () => {
    localStorage.clear();
    const t = transport();
    t.api.commit = async () => { throw new Error('offline'); };
    const { result, rerender, unmount } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: p => p, transport: t.api }), { initialProps: { payload: data() } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    rerender({ payload: { ...data(), confirmed: true } });
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).toContain('confirmed');
    unmount();
    const apply = vi.fn((p: SharePayload) => p);
    const recovered = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true })));
    recovered.unmount();
    apply.mockClear();
    renderHook(() => useSharedSessionSync({ shareId: 'two', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.not.objectContaining({ confirmed: true })));
  });
  it('retains a dirty draft when another device advances the session', async () => {
    localStorage.clear();
    const t = transport();
    const { result, rerender } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: p => p, transport: t.api }), { initialProps: { payload: data() } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    rerender({ payload: { ...data(), confirmed: true } });
    act(() => t.remote({ ...data(), revision: 1, runtime: { live: [], completed: [{ slot: 1, court: 0 }] } }));
    await waitFor(() => expect(result.current.status).toBe('conflict'));
    expect(t.read().confirmed).not.toBe(true);
    expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).toContain('confirmed');
  });
});

describe('plan generation sync guard',()=>{
 beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
 it('retains a remote Finish as conflict while generation still has unchanged local content',async()=>{
  const t=transport();
  const apply=vi.fn((p:SharePayload)=>p);
  const {result,rerender}=renderHook(({payload,planEditing})=>useSharedSessionSync({
    shareId:'one',payload,planEditing,isAdmin:true,applyRemote:apply,transport:t.api,
  }),{initialProps:{payload:data(),planEditing:false}});
  await waitFor(()=>expect(result.current.status).toBe('saved'));
  apply.mockClear();
  rerender({payload:data(),planEditing:true});
  const remote={...data(),revision:1,runtime:{live:[],completed:[{slot:1,court:0}]}};
  act(()=>t.remote(remote));
  expect(result.current.status).toBe('conflict');
  expect(apply).not.toHaveBeenCalled();
  const generated={...data(),planId:'new-plan',confirmed:true};
  rerender({payload:generated,planEditing:false});
  expect(JSON.parse(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))!).draft.planId).toBe('new-plan');
  await act(async()=>{expect(await result.current.saveNow()).toBe(false);});
  expect(t.read()).toEqual(remote);
 });
 it('suppresses saves and game actions while editing and resumes autosave after successful generation',async()=>{
  const t=transport();
  const commit=vi.spyOn(t.api,'commit');
  const action=vi.spyOn(t.api,'action');
  const {result,rerender}=renderHook(({payload,planEditing})=>useSharedSessionSync({
    shareId:'one',payload,planEditing,isAdmin:true,applyRemote:p=>p,transport:t.api,
  }),{initialProps:{payload:data(),planEditing:false}});
  await waitFor(()=>expect(result.current.status).toBe('saved'));
  const draft={...data(),confirmed:true};
  rerender({payload:draft,planEditing:true});
  await act(async()=>{
    expect(await result.current.saveNow()).toBe(false);
    expect(await result.current.performAction({type:'finish',id:'guarded',gameId:'old'})).toBe(false);
    await new Promise(resolve=>setTimeout(resolve,400));
  });
  expect(commit).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  rerender({payload:draft,planEditing:false});
  await waitFor(()=>expect(commit).toHaveBeenCalledTimes(1));
 });
});

it('retains the newest remote completion when generation starts during an in-flight action',async()=>{
 localStorage.clear();sessionStorage.clear();
 const t=transport();
 let resolve!: (p:SharePayload)=>void;
 t.api.action=()=>new Promise(r=>{resolve=r;});
 const apply=vi.fn((p:SharePayload)=>p);
 const {result,rerender}=renderHook(({planEditing})=>useSharedSessionSync({
   shareId:'one',payload:data(),planEditing,isAdmin:true,applyRemote:apply,transport:t.api,
 }),{initialProps:{planEditing:false}});
 await waitFor(()=>expect(result.current.status).toBe('saved'));
 apply.mockClear();
 let pending!:Promise<boolean>;
 act(()=>{pending=result.current.performAction({type:'finish',id:'old',gameId:'game'});});
 rerender({planEditing:true});
 const newer={...data(),revision:2,confirmed:true};
 act(()=>t.remote(newer));
 await act(async()=>{resolve({...data(),revision:1});await pending;});
 expect(result.current.status).toBe('conflict');
 expect(result.current.latest?.revision).toBe(2);
 expect(apply).not.toHaveBeenCalled();
});

it('keeps a generation draft when the initial cloud fetch resolves after editing begins',async()=>{
 localStorage.clear();sessionStorage.clear();
 const t=transport();
 let resolve!: (p:{status:'ok';data:SharePayload})=>void;
 t.api.fetch=()=>new Promise(r=>{resolve=r;});
 const apply=vi.fn((p:SharePayload)=>p);
 const {result,rerender}=renderHook(({planEditing})=>useSharedSessionSync({
   shareId:'one',payload:data(),planEditing,isAdmin:true,applyRemote:apply,transport:t.api,
 }),{initialProps:{planEditing:false}});
 rerender({planEditing:true});
 await act(async()=>resolve({status:'ok',data:{...data(),revision:1,confirmed:true}}));
 expect(result.current.status).toBe('conflict');
 expect(apply).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).not.toBeNull();
});

 describe('disconnect', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  it('invalidates a late initial fetch without subscribing', async () => {
    let resolve!: (value: any) => void;
    const t = transport(); const subscribe = vi.spyOn(t.api, 'subscribe');
    t.api.fetch = () => new Promise(r => { resolve = r; });
    const apply = vi.fn((p: SharePayload) => p);
    const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, applyRemote: apply, transport: t.api }));
    act(() => expect(result.current.disconnect()).toBe(true));
    await act(async () => { resolve({ status: 'ok', data: data() }); });
    expect(apply).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it('cancels scheduled writes and ignores late subscription and loadLatest callbacks', async () => {
    const t = transport(); let receive!: (p: SharePayload | null) => void;
    const stop = vi.fn(); t.api.subscribe = (_, next) => { receive = next; return stop; };
    const commit = vi.spyOn(t.api, 'commit'); const action = vi.spyOn(t.api, 'action');
    const apply = vi.fn((p: SharePayload) => p);
    const { result, rerender } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: apply, transport: t.api }), { initialProps: { payload: data() } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    let resolve!: (value: any) => void; t.api.fetch = () => new Promise(r => { resolve = r; });
    let loading!: Promise<void>; act(() => { loading = result.current.loadLatest(); });
    rerender({ payload: { ...data(), confirmed: true } });
    const backups = Object.keys(localStorage).filter(k => k.includes(':recovery:'));
    act(() => expect(result.current.disconnect()).toBe(true));
    await act(async () => { receive({ ...data(), revision: 3 }); resolve({ status: 'ok', data: { ...data(), revision: 4 } }); await loading; await new Promise(r => setTimeout(r, 400)); });
    expect(apply).toHaveBeenCalledTimes(1); expect(stop).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.performAction({ type: 'finish', id: 'a', gameId: 'x' })).toBe(false); result.current.retry(); });
    expect(action).not.toHaveBeenCalled(); expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).toBeNull();
    expect(backups.length).toBeGreaterThan(0); expect(backups.every(k => localStorage.getItem(k))).toBe(true);
  });
  it('refuses unresolved Finish and plan generation', async () => {
    const t = transport(); t.api.action = async () => { throw new Error('offline'); };
    const { result, rerender } = renderHook(({ editing }) => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: true, planEditing: editing, applyRemote: p => p, transport: t.api }), { initialProps: { editing: false } });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    rerender({ editing: true }); act(() => expect(result.current.disconnect()).toBe(false));
    rerender({ editing: false });
    await act(async () => { await result.current.performAction({ type: 'finish', id: 'a', gameId: 'x' }); });
    act(() => expect(result.current.disconnect()).toBe(false)); expect(result.current.message).toMatch(/action|Finish/i);
  });
 });

it('refuses disconnect while a cloud commit is active', async () => {
  localStorage.clear(); sessionStorage.clear();
  const t = transport(); let resolve!: (p: SharePayload) => void;
  t.api.commit = () => new Promise(r => { resolve = r; });
  const { result, rerender } = renderHook(({ payload }) => useSharedSessionSync({ shareId: 'one', payload, isAdmin: true, applyRemote: p => p, transport: t.api }), { initialProps: { payload: data() } });
  await waitFor(() => expect(result.current.status).toBe('saved'));
  rerender({ payload: { ...data(), confirmed: true } });
  let saving!: Promise<boolean>; act(() => { saving = result.current.saveNow(); });
  act(() => expect(result.current.disconnect()).toBe(false));
  await act(async () => { resolve({ ...data(), confirmed: true, revision: 1 }); await saving; });
  act(() => expect(result.current.disconnect()).toBe(true));
});
it('does not create recovery journals for detached local edits', async () => {
  localStorage.clear(); sessionStorage.clear();
  const t = transport(); const commit = vi.spyOn(t.api, 'commit');
  const { result, rerender } = renderHook(({ shareId, payload }: { shareId: string | null; payload: SharePayload }) => useSharedSessionSync({ shareId, payload, isAdmin: true, applyRemote: p => p, transport: t.api }), { initialProps: { shareId: 'one' as string | null, payload: data() } });
  await waitFor(() => expect(result.current.status).toBe('saved'));
  act(() => expect(result.current.disconnect()).toBe(true));
  rerender({ shareId: null, payload: { ...data(), confirmed: true } });
  await act(async () => { await new Promise(r => setTimeout(r, 400)); });
  expect(commit).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
});

it('keeps its live connection when recovery journal removal fails', async () => {
  localStorage.clear(); sessionStorage.clear();
  const t = transport(); const apply = vi.fn((p: SharePayload) => p);
  const { result } = renderHook(() => useSharedSessionSync({ shareId: 'one', payload: data(), isAdmin: false, applyRemote: apply, transport: t.api }));
  await waitFor(() => expect(result.current.status).toBe('saved'));
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
  try { act(() => expect(result.current.disconnect()).toBe(false)); expect(result.current.message).toMatch(/storage|recovery/i); }
  finally { remove.mockRestore(); }
  act(() => t.remote({ ...data(), revision: 1 }));
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
});
