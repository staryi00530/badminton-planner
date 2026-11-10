import type { PlannerState } from '../types';
import type { QualityWeights } from './gameQuality';
import { plannerStorageKey } from './plannerStorage';

// Deliberately explicit: credentials, share recovery journals and all-time win/loss
// must never enter a downloadable private device snapshot.
const BACKUP_KEYS = [
  'bp-players', 'bp-player-history', 'bp-player-level-scale', 'bp-bank-level-scale',
  'bp-totalMinutes', 'bp-gameMinutes', 'bp-numCourts', 'bp-extraCourt',
  'bp-courtOverrides', 'bp-staggerMode', 'bp-sessionStart', 'bp-result',
  'bp-live-games', 'bp-completed-games', 'bp-suspended-player-names', 'bp-scores',
  'bp-waiting-clock', 'bp-played-games', 'bp-history-epoch', 'bp-prefer-mixed-teams', 'bp-preferred-pairs',
  'bp-is-confirmed', 'bp-loaded-plan-id', 'bp-quality-weights', 'bp-active-tab',
  'bp-saved-plans',
] as const;
const pointerKey = () => plannerStorageKey('bp-last-device-backup');
const backupPrefix = () => plannerStorageKey('bp-device-backup:');

/** Synchronous and durable: callers must not replace the session if this throws. */
export function createDeviceSessionBackup(): string {
  const values: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    const value = localStorage.getItem(plannerStorageKey(key));
    if (value !== null) values[key] = value;
  }
  const key = `${backupPrefix()}${crypto.randomUUID()}`;
  const snapshot = JSON.stringify({ v: 1, createdAt: new Date().toISOString(), values });
  localStorage.setItem(key, snapshot);
  if (localStorage.getItem(key) !== snapshot) throw new Error('Could not preserve the device session backup.');
  // Publish only after the immutable snapshot is safely stored; prior snapshots stay.
  localStorage.setItem(pointerKey(), key);
  if (localStorage.getItem(pointerKey()) !== key) throw new Error('Could not preserve the device session backup.');
  return key;
}

function latestBackup(): string | null {
  try {
    const key = localStorage.getItem(pointerKey());
    if (!key?.startsWith(backupPrefix())) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.v !== 1 || !value.values || typeof value.values !== 'object') return null;
    // Only export our whitelist, even if browser storage was modified externally.
    const values = Object.fromEntries(BACKUP_KEYS.flatMap(key => typeof value.values[key] === 'string' ? [[key, value.values[key]]] : []));
    return JSON.stringify({ v: 1, createdAt: value.createdAt, values }, null, 2);
  } catch { return null; }
}

export function hasDeviceSessionBackup(): boolean { return latestBackup() !== null; }

export function downloadDeviceSessionBackup(): void {
  const text = latestBackup();
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url; link.download = 'badminton-device-backup.json'; link.click();
  } finally { URL.revokeObjectURL(url); }
}

/** Persist an incoming local branch before changing the URL or visible React state.
 * The returned rollback restores the exact prior device session if detach refuses.
 */
export function persistDeviceSessionCopy(state: PlannerState, qualityWeights: QualityWeights, shareIds: string[] = []): () => void {
  const fields = {
    players: 'bp-players', playerHistory: 'bp-player-history',
    totalMinutes: 'bp-totalMinutes', gameMinutes: 'bp-gameMinutes', numCourts: 'bp-numCourts',
    extraCourt: 'bp-extraCourt', courtOverrides: 'bp-courtOverrides', staggerMode: 'bp-staggerMode',
    sessionStart: 'bp-sessionStart', result: 'bp-result', liveGames: 'bp-live-games',
    completedGames: 'bp-completed-games', suspendedPlayerNames: 'bp-suspended-player-names',
    waitingClock: 'bp-waiting-clock', scores: 'bp-scores', playedGames: 'bp-played-games', historyEpoch: 'bp-history-epoch',
    preferMixedTeams: 'bp-prefer-mixed-teams', preferredPairs: 'bp-preferred-pairs',
    isConfirmed: 'bp-is-confirmed', loadedPlanId: 'bp-loaded-plan-id', activeTab: 'bp-active-tab',
  } satisfies Partial<Record<keyof PlannerState, string>>;
  // Archive, all-time results and authentication are deliberately outside this transaction.
  const incoming = Object.entries(fields).flatMap(([field, key]) => {
    const value = JSON.stringify(state[field as keyof PlannerState]);
    return value === undefined ? [] : [[plannerStorageKey(key), value] as const];
  });
  incoming.push([plannerStorageKey('bp-player-level-scale'), '5'],
    [plannerStorageKey('bp-bank-level-scale'), '5'],
    [plannerStorageKey('bp-quality-weights'), JSON.stringify(qualityWeights)]);
  const changed = incoming.map(([key, value]) => ({ key, value, prior: localStorage.getItem(key) }))
    .filter(entry => entry.value !== entry.prior);
  // Credentials are retained only in memory for rollback, never in a backup/export.
  const sessionIncoming: Array<readonly [string, string | null]> = [
    [plannerStorageKey('bp-share-id'), null], [plannerStorageKey('bp-share-token'), null],
    [plannerStorageKey('bp-is-shared-session'), 'false'],
    ...[...new Set(shareIds.filter(Boolean))].flatMap(id => [
      [plannerStorageKey(`bp-share-draft:${id}`), null] as const,
      [plannerStorageKey(`bp-share-action:${id}`), null] as const,
    ]),
  ];
  const sessionChanged = sessionIncoming.map(([key, value]) => ({ key, value, prior: sessionStorage.getItem(key) }))
    .filter(entry => entry.value !== entry.prior);
  let restored = false;
  const rollback = () => {
    if (restored) return;
    // Free all incoming space first so restoring the smaller original fits under quota.
    for (const { key } of changed) localStorage.removeItem(key);
    for (const { key, prior } of changed) if (prior !== null) localStorage.setItem(key, prior);
    for (const { key, prior } of changed) {
      if (localStorage.getItem(key) !== prior) throw new Error('Could not restore the previous device session.');
    }
    for (const { key, prior } of sessionChanged) {
      if (sessionStorage.getItem(key) === prior) continue;
      if (prior === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, prior);
      if (sessionStorage.getItem(key) !== prior) throw new Error('Could not restore the previous shared session.');
    }
    restored = true;
  };
  try {
    for (const { key, value } of changed) {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw new Error('Could not save this session on the device.');
    }
    for (const { key, value } of sessionChanged) {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
      if (sessionStorage.getItem(key) !== value) throw new Error('Could not clear the previous shared session.');
    }
  } catch (error) { rollback(); throw error; }
  return rollback;
}
