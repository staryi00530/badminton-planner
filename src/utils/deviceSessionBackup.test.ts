// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createDeviceSessionBackup, downloadDeviceSessionBackup, hasDeviceSessionBackup, persistDeviceSessionCopy } from './deviceSessionBackup';
import { plannerStorageKey } from './plannerStorage';
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
it('backs up only private planner data and preserves immutable prior snapshots', () => {
  for (const key of ['bp-players', 'bp-player-history', 'bp-result', 'bp-quality-weights', 'bp-scores']) localStorage.setItem(plannerStorageKey(key), JSON.stringify({ data: key }));
  for (const key of ['bp-admin-pin', 'bp-share-token', 'bp-auth', 'bp-winloss', 'bp-share-draft:x', 'bp-share-action:x']) localStorage.setItem(plannerStorageKey(key), 'secret');
  const first = createDeviceSessionBackup(); const saved = localStorage.getItem(first)!;
  expect(saved).toContain('bp-players'); expect(saved).toContain('bp-player-history'); expect(saved).not.toContain('secret');
  localStorage.setItem(plannerStorageKey('bp-players'), '[]');
  const second = createDeviceSessionBackup(); expect(second).not.toBe(first); expect(localStorage.getItem(first)).toBe(saved);
  expect(localStorage.getItem(plannerStorageKey('bp-last-device-backup'))).toBe(second); expect(hasDeviceSessionBackup()).toBe(true);
});
it('throws on storage failure and retains the prior backup pointer', () => {
  const prior = createDeviceSessionBackup();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === plannerStorageKey('bp-last-device-backup')) throw new Error('full');
    original.call(this, key, value);
  });
  expect(() => createDeviceSessionBackup()).toThrow();
  expect(localStorage.getItem(plannerStorageKey('bp-last-device-backup'))).toBe(prior); expect(localStorage.getItem(prior)).not.toBeNull();
});
it('downloads only an existing backup pointer belonging to this planner', () => {
  expect(hasDeviceSessionBackup()).toBe(false); expect(() => downloadDeviceSessionBackup()).not.toThrow();
  localStorage.setItem(plannerStorageKey('bp-last-device-backup'), 'bp-share-token'); localStorage.setItem('bp-share-token', 'secret');
  expect(hasDeviceSessionBackup()).toBe(false); expect(() => downloadDeviceSessionBackup()).not.toThrow();
});

it('throws when the snapshot itself cannot be written', () => {
  const prior = createDeviceSessionBackup();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(() => createDeviceSessionBackup()).toThrow('quota');
  expect(localStorage.getItem(plannerStorageKey('bp-last-device-backup'))).toBe(prior);
  expect(localStorage.getItem(prior)).not.toBeNull();
});
it('downloads and revokes a valid backup URL', () => {
  createDeviceSessionBackup();
  const create = vi.fn(() => 'blob:backup'); const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try { downloadDeviceSessionBackup(); expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith('blob:backup'); }
  finally { vi.unstubAllGlobals(); }
});

it('rolls back a larger incoming session when quota fails midway through persistence', () => {
  localStorage.setItem(plannerStorageKey('bp-players'), '["original"]');
  localStorage.setItem(plannerStorageKey('bp-result'), '{"old":true}');
  const backup = createDeviceSessionBackup();
  const before = { ...localStorage };
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === plannerStorageKey('bp-result') && value.includes('huge')) throw new Error('quota');
    set.call(this, key, value);
  });
  expect(() => persistDeviceSessionCopy({ players: [], result: { huge: 'x'.repeat(1000) } } as any, {} as any)).toThrow('quota');
  expect({ ...localStorage }).toEqual(before); expect(localStorage.getItem(backup)).not.toBeNull();
});
it('persists known fields and level markers, with an explicit rollback and no credentials or global stats', () => {
  localStorage.setItem(plannerStorageKey('bp-winloss'), 'old stats');
  localStorage.setItem(plannerStorageKey('bp-saved-plans'), 'old archive');
  const before = { ...localStorage };
  const rollback = persistDeviceSessionCopy({ players: [], playerHistory: [], result: null, savedPlans: ['incoming archive'], winLoss: 'incoming stats', shareToken: 'secret' } as any, { waiting: 5 } as any);
  expect(localStorage.getItem(plannerStorageKey('bp-players'))).toBe('[]');
  expect(localStorage.getItem(plannerStorageKey('bp-player-level-scale'))).toBe('5');
  expect(localStorage.getItem(plannerStorageKey('bp-quality-weights'))).toBe('{"waiting":5}');
  expect(localStorage.getItem(plannerStorageKey('bp-winloss'))).toBe('old stats');
  expect(localStorage.getItem(plannerStorageKey('bp-saved-plans'))).toBe('old archive');
  expect(JSON.stringify(localStorage)).not.toContain('secret');
  rollback(); expect({ ...localStorage }).toEqual(before);
});

it('atomically clears remembered share flags and active journals and can roll them back', () => {
  const original = { 'bp-share-id': '"one"', 'bp-share-token': '"private token"', 'bp-is-shared-session': 'true', 'bp-share-draft:one': 'draft', 'bp-share-action:one': 'action' };
  for (const [key, value] of Object.entries(original)) sessionStorage.setItem(plannerStorageKey(key), value);
  const rollback = persistDeviceSessionCopy({ players: [] } as any, {} as any, ['one']);
  expect(sessionStorage.getItem(plannerStorageKey('bp-share-id'))).toBeNull();
  expect(sessionStorage.getItem(plannerStorageKey('bp-share-token'))).toBeNull();
  expect(sessionStorage.getItem(plannerStorageKey('bp-is-shared-session'))).toBe('false');
  expect(sessionStorage.getItem(plannerStorageKey('bp-share-draft:one'))).toBeNull();
  expect(sessionStorage.getItem(plannerStorageKey('bp-share-action:one'))).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain('private token');
  rollback();
  for (const [key, value] of Object.entries(original)) expect(sessionStorage.getItem(plannerStorageKey(key))).toBe(value);
});
it('restores both storage areas when clearing remembered share state fails', () => {
  localStorage.setItem(plannerStorageKey('bp-players'), '["original"]');
  sessionStorage.setItem(plannerStorageKey('bp-share-id'), '"one"');
  sessionStorage.setItem(plannerStorageKey('bp-share-token'), '"token"');
  sessionStorage.setItem(plannerStorageKey('bp-is-shared-session'), 'true');
  sessionStorage.setItem(plannerStorageKey('bp-share-draft:one'), 'draft');
  const localBefore = { ...localStorage }, sessionBefore = { ...sessionStorage };
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === sessionStorage && key === plannerStorageKey('bp-is-shared-session') && value === 'false') throw new Error('session blocked');
    set.call(this, key, value);
  });
  expect(() => persistDeviceSessionCopy({ players: [] } as any, {} as any, ['one'])).toThrow('session blocked');
  expect({ ...localStorage }).toEqual(localBefore); expect({ ...sessionStorage }).toEqual(sessionBefore);
});

it('restores local state and earlier cleared flags when journal removal fails', () => {
  localStorage.setItem(plannerStorageKey('bp-players'), '["old"]');
  sessionStorage.setItem(plannerStorageKey('bp-share-id'), '"one"');
  sessionStorage.setItem(plannerStorageKey('bp-share-draft:one'), 'draft');
  const localBefore = { ...localStorage }, sessionBefore = { ...sessionStorage };
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (this === sessionStorage && key === plannerStorageKey('bp-share-draft:one')) throw new Error('journal blocked');
    remove.call(this, key);
  });
  expect(() => persistDeviceSessionCopy({ players: [] } as any, {} as any, ['one'])).toThrow('journal blocked');
  expect({ ...localStorage }).toEqual(localBefore); expect({ ...sessionStorage }).toEqual(sessionBefore);
});
