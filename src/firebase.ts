import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, getToken, type AppCheck } from 'firebase/app-check';
import { cloudOperation } from './utils/cloudDiagnostics';
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  get,
  onValue,
  runTransaction,
  type Database,
} from 'firebase/database';
import type { SharePayload } from './types';
import { applySharedAction, commitSharedSnapshot, type SharedAction } from './utils/sharedSession';

// Shares older than this are deleted the next time anyone opens them, so abandoned/forgotten
// links don't accumulate in the database forever. Saved Plans already prunes its own local
// reference to a share after 2 weeks (ARCHIVE_TTL_MS); this is a longer, server-side backstop —
// long enough that an actively-used link (e.g. reused across a multi-week season) won't expire
// out from under people still relying on it.
const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare global {
  interface Window {
    FIREBASE_CONFIG: Record<string, string> | null;
    RECAPTCHA_SITE_KEY: string | null;
    ADMIN_PIN: string | null;
    SHARE_API_BASE: string | null;
  }
}

let app: FirebaseApp | null = null;
let db: Database | null = null;
let appCheck: AppCheck | null = null;

function getDb(): Database | null {
  if (db) return db;
  if (!window.FIREBASE_CONFIG) return null;
  app = initializeApp(window.FIREBASE_CONFIG);
  if (window.RECAPTCHA_SITE_KEY) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(window.RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
  db = getDatabase(app);
  return db;
}

async function requireDatabase(): Promise<Database> {
  const database = getDb();
  if (!database) throw Object.assign(new Error('Firebase is not configured'), { code: 'cloud/not-configured' });
  // Surface attestation failures directly instead of waiting indefinitely for RTDB reconnects.
  if (appCheck) await getToken(appCheck);
  return database;
}

export function isFirebaseConfigured(): boolean {
  return !!window.FIREBASE_CONFIG;
}

// ─── Win/loss sync (legacy bp-winloss path, unchanged shape) ──────────────────

export function loadWinLoss(): Promise<Record<string, { wins: number; losses: number }>> {
  if (!isFirebaseConfigured()) return Promise.resolve({});
  return cloudOperation('firebase.winLoss.read', async () => {
    const database = await requireDatabase();
    const snapshot = await get(ref(database, 'winLoss'));
    return snapshot.val() || {};
  });
}

export function saveWinLoss(data: Record<string, { wins: number; losses: number }>): Promise<void> {
  if (!isFirebaseConfigured()) return Promise.resolve();
  return cloudOperation('firebase.winLoss.write', async () => {
    const database = await requireDatabase();
    await set(ref(database, 'winLoss'), data);
  });
}

// ─── Shared schedule live sync ─────────────────────────────────────────────

export function createShare(payload: unknown): Promise<string | null> {
  return cloudOperation('firebase.share.create', async () => {
    const database = await requireDatabase();
    const newRef = push(ref(database, 'shares'));
    await set(newRef, { ...(payload as object), revision: 0, createdAt: Date.now() });
    return newRef.key;
  });
}

export function updateShare(shareId: string, payload: unknown): Promise<void> {
  return cloudOperation('firebase.share.update', async () => {
    const database = await requireDatabase();
    // Partial update (not set) so it never clobbers the original createdAt timestamp.
    await update(ref(database, `shares/${shareId}`), payload as object);
  });
}

export function subscribeShare(shareId: string, onData: (data: SharePayload | null) => void, onError: (error: unknown) => void): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  void requireDatabase().then(database => {
    if (stopped) return;
    unsubscribe = onValue(ref(database, `shares/${shareId}`), snapshot => onData(snapshot.val()), onError);
  }).catch(onError);
  return () => { stopped = true; unsubscribe?.(); };
}

/** Reader-only transport state; listening never changes a session or its expiry. */
export function subscribeShareConnection(onConnected: (connected: boolean) => void, onError: (error: unknown) => void): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  void requireDatabase().then(database => {
    if (stopped) return;
    unsubscribe = onValue(ref(database, '.info/connected'), snapshot => onConnected(snapshot.val() === true), onError);
  }).catch(error => { if (!stopped) onError(error); });
  return () => { stopped = true; unsubscribe?.(); };
}

export function commitShare(shareId: string, revision: number, payload: SharePayload): Promise<SharePayload> {
  return cloudOperation('firebase.share.commit', async () => {
    const database = await requireDatabase();
    const result = await runTransaction(ref(database, `shares/${shareId}`), current => {
      // A transaction can first receive null from an empty local cache; returning null
      // asks the server to retry against its authoritative value instead of aborting.
      if (current === null) return null;
      const next = commitSharedSnapshot(current, revision, payload);
      return next ? { ...next, ...(current.createdAt != null ? { createdAt: current.createdAt } : {}) } : undefined;
    }, { applyLocally: false });
    if (!result.committed || !result.snapshot.val()) throw Object.assign(new Error('A newer session is available. Your draft was retained.'), { code: 'share/conflict' });
    return result.snapshot.val();
  });
}

export function performShareAction(shareId: string, action: SharedAction): Promise<SharePayload> {
  return cloudOperation('firebase.share.action', async () => {
    const database = await requireDatabase();
    const result = await runTransaction(ref(database, `shares/${shareId}`), current => {
      if (current === null) return null;
      return applySharedAction(current, action) ?? undefined;
    }, { applyLocally: false });
    if (!result.committed || !result.snapshot.val()) throw Object.assign(new Error('This game changed, or another started game depends on this action. Refresh the session before trying again.'), { code: 'share/action-blocked' });
    return result.snapshot.val();
  });
}

export type FetchShareResult =
  | { status: 'ok'; data: any }
  | { status: 'expired' }
  | { status: 'not_found' };

export async function fetchShare(shareId: string): Promise<FetchShareResult> {
  return cloudOperation<FetchShareResult>('firebase.share.read', async () => {
    const database = await requireDatabase();
    const shareRef = ref(database, `shares/${shareId}`);
    const snapshot = await get(shareRef);
    const data = snapshot.val();
    if (!data) return { status: 'not_found' };
    if (data.createdAt && Date.now() - data.createdAt > SHARE_TTL_MS) {
      remove(shareRef).catch(() => {});
      return { status: 'expired' };
    }
    return { status: 'ok', data };
  });
}
