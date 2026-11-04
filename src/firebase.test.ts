// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), update: vi.fn(), remove: vi.fn(), token: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/app-check', () => ({ initializeAppCheck: () => ({}), ReCaptchaV3Provider: class {}, getToken: sdk.token }));
vi.mock('firebase/database', () => ({
  ...sdk, getDatabase: () => ({}), ref: (_db: unknown, path: string) => ({ path }), push: () => ({ key: 'new-share' }),
}));
import { createShare, fetchShare, loadWinLoss, updateShare } from './firebase';
import { exportLiveQueueLogs } from './utils/liveQueue';

describe('Firebase acknowledgement and error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.FIREBASE_CONFIG = { projectId: 'test' };
    window.RECAPTCHA_SITE_KEY = null;
    sdk.set.mockReset(); sdk.update.mockReset(); sdk.get.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does not return a share link before the database acknowledges the write', async () => {
    let acknowledge!: () => void;
    sdk.set.mockReturnValue(new Promise<void>(resolve => { acknowledge = resolve; }));
    let settled = false;
    const pending = Promise.resolve(createShare({ v: 1 })).then(id => { settled = true; return id; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    acknowledge();
    expect(await pending).toBe('new-share');
  });

  it('rejects denied writes so the UI cannot advertise a successful share', async () => {
    sdk.update.mockRejectedValue(Object.assign(new Error('private details'), { code: 'PERMISSION_DENIED' }));
    await expect(updateShare('private-id', {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const logs = exportLiveQueueLogs();
    expect(logs).toContain('PERMISSION_DENIED');
    expect(logs).not.toMatch(/private-id|private details/);
  });

  it('rejects a denied win-loss read instead of leaving sync pending forever', async () => {
    sdk.get.mockRejectedValue(Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' }));
    await expect(loadWinLoss()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('times out a share read that never receives a response', async () => {
    sdk.get.mockReturnValue(new Promise(() => {}));
    const pending = expect(fetchShare('private-id')).rejects.toMatchObject({ code: 'cloud/timeout' });
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(exportLiveQueueLogs()).toContain('cloud/timeout');
  });

  it('surfaces App Check failure before attempting a database read', async () => {
    vi.resetModules();
    window.RECAPTCHA_SITE_KEY = 'test-site-key';
    sdk.token.mockRejectedValue(Object.assign(new Error('attestation failed'), { code: 'appCheck/recaptcha-error' }));
    const checkedFirebase = await import('./firebase');
    await expect(checkedFirebase.fetchShare('private-id')).rejects.toMatchObject({ code: 'appCheck/recaptcha-error' });
    expect(sdk.get).not.toHaveBeenCalled();
  });
});
