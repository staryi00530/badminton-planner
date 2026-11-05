// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAdminAuth } from './useAdminAuth.js';

beforeEach(() => {
  sessionStorage.clear();
  window.ADMIN_PIN = null;
});

afterEach(() => {
  window.ADMIN_PIN = null;
});

describe('useAdminAuth — initial state', () => {
  it('is admin by default when no PIN is configured', () => {
    const { result } = renderHook(() => useAdminAuth({ pinInput: '', patchState: vi.fn() }));
    expect(result.current.isAdmin).toBe(true);
  });

  it('is not admin when a PIN is configured and no matching session exists', () => {
    window.ADMIN_PIN = '1234';
    const { result } = renderHook(() => useAdminAuth({ pinInput: '', patchState: vi.fn() }));
    expect(result.current.isAdmin).toBe(false);
  });

  it('is admin when a PIN is configured and sessionStorage already has the matching unlock', () => {
    window.ADMIN_PIN = '1234';
    sessionStorage.setItem('bp-admin', '1234');
    const { result } = renderHook(() => useAdminAuth({ pinInput: '', patchState: vi.fn() }));
    expect(result.current.isAdmin).toBe(true);
  });
});

describe('useAdminAuth — submitPin', () => {
  it('unlocks admin and persists the session on a correct PIN', () => {
    window.ADMIN_PIN = '1234';
    const patchState = vi.fn();
    const { result, rerender } = renderHook(({ pinInput }) => useAdminAuth({ pinInput, patchState }), { initialProps: { pinInput: '1234' } });

    act(() => result.current.submitPin());

    expect(result.current.isAdmin).toBe(true);
    expect(sessionStorage.getItem('bp-admin')).toBe('1234');
    expect(patchState).toHaveBeenCalledWith({ showPinPrompt: false, pinInput: '', pinError: false });
  });

  it('sets pinError and stays locked out on an incorrect PIN', () => {
    window.ADMIN_PIN = '1234';
    const patchState = vi.fn();
    const { result } = renderHook(() => useAdminAuth({ pinInput: 'wrong', patchState }));

    act(() => result.current.submitPin());

    expect(result.current.isAdmin).toBe(false);
    expect(patchState).toHaveBeenCalledWith({ pinError: true });
  });
});

describe('useAdminAuth — toggleAdminLock', () => {
  it('locks and clears the session when currently admin', () => {
    // No ADMIN_PIN configured -> starts as admin.
    const patchState = vi.fn();
    const { result } = renderHook(() => useAdminAuth({ pinInput: '', patchState }));
    sessionStorage.setItem('bp-admin', 'whatever');

    act(() => result.current.toggleAdminLock());

    expect(result.current.isAdmin).toBe(false);
    expect(sessionStorage.getItem('bp-admin')).toBeNull();
  });

  it('opens the PIN prompt when currently locked', () => {
    window.ADMIN_PIN = '1234';
    const patchState = vi.fn();
    const { result } = renderHook(() => useAdminAuth({ pinInput: '', patchState }));

    act(() => result.current.toggleAdminLock());

    expect(patchState).toHaveBeenCalledWith({ showPinPrompt: true });
  });
});
