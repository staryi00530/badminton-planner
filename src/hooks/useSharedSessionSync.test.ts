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
    await waitFor(() => expect(t.read().confirmed).toBe(true));
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
