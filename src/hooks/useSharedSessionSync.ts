import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commitShare, fetchShare, performShareAction, subscribeShare, type FetchShareResult } from '../firebase';
import type { SharePayload } from '../types';
import type { SharedAction } from '../utils/sharedSession';
import { cloudDiagnostic } from '../utils/cloudDiagnostics';
import { plannerStorageKey } from '../utils/plannerStorage';

export interface SharedTransport {
  fetch: (id: string) => Promise<FetchShareResult>;
  subscribe: (id: string, next: (data: SharePayload | null) => void, error: (error: unknown) => void) => () => void;
  commit: (id: string, revision: number, data: SharePayload) => Promise<SharePayload>;
  action: (id: string, action: SharedAction) => Promise<SharePayload>;
}
const firebaseTransport: SharedTransport = { fetch: fetchShare, subscribe: subscribeShare, commit: commitShare, action: performShareAction };
type Status = 'loading' | 'saved' | 'saving' | 'offline' | 'conflict' | 'not_found' | 'expired' | 'error';
interface Journal { base: SharePayload; draft: SharePayload; backupKey?: string }

/** Compare content, ignoring transport revision/history and Firebase's omitted empty children. */
export function sharedContentKey(payload: SharePayload | null): string {
  if (!payload) return '';
  const { revision: _revision, actions: _actions, receipts: _receipts, ...content } = payload;
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
    return value;
  };
  return JSON.stringify(ordered({ ...content, q: content.q ?? [], scores: content.scores ?? {}, runtime: { live: content.runtime?.live ?? [], completed: content.runtime?.completed ?? [], suspended: content.runtime?.suspended ?? [] } }));
}

export function useSharedSessionSync({ shareId, payload, isAdmin, planEditing = false, applyRemote, transport = firebaseTransport, recoveryStorage = window.sessionStorage }: {
  shareId: string | null;
  payload: SharePayload | null;
  isAdmin: boolean;
  /** Hold cloud writes and incoming replacement while a new plan is being generated. */
  planEditing?: boolean;
  /** Apply to React and return the canonical payload produced by that reconstructed state. */
  applyRemote: (data: SharePayload) => SharePayload;
  transport?: SharedTransport;
  recoveryStorage?: Storage;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [reconnect, setReconnect] = useState(0);
  const latest = useRef({ payload, isAdmin, planEditing, applyRemote });
  latest.current = { payload, isAdmin, planEditing, applyRemote };
  const activeShare = useRef(shareId);
  activeShare.current = shareId;
  const base = useRef<SharePayload | null>(null);
  const remote = useRef<SharePayload | null>(null);
  const canonicalKey = useRef('');
  const ready = useRef(false);
  const blocked = useRef(false);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const pendingAction = useRef<SharedAction | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detached = useRef(false);
  const disconnectedShare = useRef<string | null>(null);
  const stopActiveSubscription = useRef<(() => void) | undefined>(undefined);
  const ownedBackup = useRef<string | null>(null);
  const journalKey = shareId ? plannerStorageKey(`bp-share-draft:${shareId}`) : '';
  const actionKey = shareId ? plannerStorageKey(`bp-share-action:${shareId}`) : '';
  const localKey = sharedContentKey(payload);

  const writeJournal = useCallback((draft: SharePayload) => {
    if (activeShare.current !== shareId || detached.current || !journalKey || !base.current) return true;
    try {
      const prior: Journal | null = JSON.parse(recoveryStorage.getItem(journalKey) ?? 'null');
      if (prior && prior.base.revision === base.current.revision && sharedContentKey(prior.draft) === sharedContentKey(draft)) return true;
      const backupKey = `${journalKey}:recovery:${crypto.randomUUID()}`;
      const journal = JSON.stringify({ base: base.current, draft, backupKey } satisfies Journal);
      // sessionStorage isolates active drafts/actions per tab, including duplicated tabs.
      // Immutable local backups survive tab closure without another tab deleting them.
      recoveryStorage.setItem(journalKey, journal);
      localStorage.setItem(backupKey, journal);
      if (ownedBackup.current) localStorage.removeItem(ownedBackup.current);
      ownedBackup.current = backupKey;
      return true;
    }
    catch { setMessage('Device storage is full. Keep this tab open until cloud saving succeeds.'); return false; }
  }, [shareId, journalKey, recoveryStorage]);
  const clearJournal = useCallback(() => {
    recoveryStorage.removeItem(journalKey);
    if (ownedBackup.current) { localStorage.removeItem(ownedBackup.current); ownedBackup.current = null; }
  }, [journalKey, recoveryStorage]);
  const apply = useCallback((data: SharePayload) => {
    const canonical = latest.current.applyRemote(data);
    base.current = { ...canonical, revision: data.revision ?? 0, actions: data.actions ?? [] };
    canonicalKey.current = sharedContentKey(canonical);
    remote.current = data;
    setVersion(v => v + 1);
  }, []);

  useEffect(() => {
    if (detached.current && shareId === disconnectedShare.current) return;
    if (shareId) detached.current = false;
    const currentEpoch = ++epoch.current;
    ready.current = false; blocked.current = false; base.current = null; remote.current = null; canonicalKey.current = ''; inFlight.current = false; pendingAction.current = null;
    ownedBackup.current = null;
    if (!shareId) return;
    setStatus('loading'); setMessage('');
    cloudDiagnostic('share.load', 'started');
    let stopped = false;
    let stopSubscription: (() => void) | undefined;
    let journal: Journal | null = null;
    try { journal = JSON.parse(recoveryStorage.getItem(journalKey) ?? 'null'); } catch {}
    if (journal?.draft && journal?.base && latest.current.isAdmin) {
      // A cold offline reload must display the retained draft before any network read.
      try {
        latest.current.applyRemote(journal.draft);
        base.current = journal.base;
        canonicalKey.current = sharedContentKey(journal.base);
        setMessage('Recovered this tab’s unsaved organizer edits. Connecting to the shared session…');
      } catch { journal = null; setMessage('Could not read the recovery draft. Connecting to the saved cloud session.'); }
    }
    const fail = (error: unknown) => { if (!stopped && epoch.current === currentEpoch) { cloudDiagnostic('share.sync', 'failed', error); setStatus('offline'); } };
    const receive = (data: SharePayload | null) => {
      if (stopped || epoch.current !== currentEpoch) return;
      if (!data) { blocked.current = true; setStatus('not_found'); return; }
      remote.current = data;
      if (!ready.current) return;
      if ((data.revision ?? 0) <= (base.current?.revision ?? 0)) return;
      const draft = latest.current.payload;
      if (latest.current.planEditing) {
        if (draft) writeJournal(draft);
        blocked.current = true; setStatus('conflict'); return;
      }
      if (inFlight.current) return;
      if (blocked.current || (latest.current.isAdmin && draft && sharedContentKey(draft) !== canonicalKey.current)) {
        if (draft) writeJournal(draft);
        blocked.current = true; setStatus('conflict'); return;
      }
      try { apply(data); setStatus('saved'); }
      catch (error) { blocked.current = true; cloudDiagnostic('share.sync.decode', 'failed', error); setStatus('error'); }
    };
    void transport.fetch(shareId).then(response => {
      if (stopped || epoch.current !== currentEpoch) return;
      if (response.status !== 'ok') { blocked.current = true; cloudDiagnostic('share.load', response.status); setStatus(response.status); return; }
      const data = response.data as SharePayload;
      if (data.v !== 1 || !Array.isArray(data.p) || !Array.isArray(data.slots)) throw new Error('Invalid shared session');
      if (latest.current.planEditing) {
        // The fetch may finish after generation begins; retain the local base and
        // never reconstruct cloud state over the organizer's in-progress plan.
        base.current = journal?.base ?? latest.current.payload ?? data;
        canonicalKey.current = sharedContentKey(base.current);
        remote.current = data;
        if (latest.current.payload) writeJournal(latest.current.payload);
        blocked.current = true; setStatus('conflict');
      } else {
      apply(data);
      if (journal?.draft && latest.current.isAdmin) {
        if (sharedContentKey(journal.draft) === canonicalKey.current) clearJournal();
        else {
          latest.current.applyRemote(journal.draft);
          if ((journal.base.revision ?? 0) !== (data.revision ?? 0)) { blocked.current = true; setStatus('conflict'); }
          else setStatus('saving');
        }
      } else setStatus('saved');
      }
      try { pendingAction.current = JSON.parse(recoveryStorage.getItem(actionKey) ?? 'null'); } catch {}
      if (pendingAction.current && !blocked.current) { setStatus('offline'); setMessage('A game action is retained on this device. Retry to confirm it with the shared session.'); }
      ready.current = true;
      stopSubscription = transport.subscribe(shareId, receive, fail);
      stopActiveSubscription.current = stopSubscription;
      setVersion(v => v + 1);
      cloudDiagnostic('share.sync', 'connected');
    }).catch(error => { if (!stopped && epoch.current === currentEpoch) { blocked.current = true; cloudDiagnostic('share.load', 'failed', error); setStatus(journal?.draft ? 'offline' : 'error'); } });
    return () => { stopped = true; stopSubscription?.(); stopActiveSubscription.current = undefined; };
  }, [shareId, transport, journalKey, actionKey, apply, writeJournal, reconnect, recoveryStorage, clearJournal]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (activeShare.current !== shareId || detached.current || !shareId || !ready.current || blocked.current || inFlight.current || latest.current.planEditing) return false;
    const draft = latest.current.payload;
    if (!draft || !base.current) return false;
    if (sharedContentKey(draft) === canonicalKey.current) return true;
    if (!latest.current.isAdmin) return false;
    writeJournal(draft);
    const startedEpoch = epoch.current;
    const sentKey = sharedContentKey(draft);
    inFlight.current = true; setStatus('saving');
    try {
      const saved = await transport.commit(shareId, base.current.revision ?? 0, draft);
      if (epoch.current !== startedEpoch) return false;
      base.current = { ...draft, revision: saved.revision ?? 0, actions: saved.actions ?? [] };
      canonicalKey.current = sentKey;
      if (!blocked.current && sharedContentKey(latest.current.payload) === sentKey) clearJournal();
      else if (latest.current.payload) writeJournal(latest.current.payload);
      if (blocked.current) {
        if (latest.current.payload) writeJournal(latest.current.payload);
        setStatus('conflict'); return false;
      }
      if ((remote.current?.revision ?? 0) > (saved.revision ?? 0)) {
        // A later remote action must be seen before accepting more organizer edits.
        if (!latest.current.planEditing && sharedContentKey(latest.current.payload) === sentKey) apply(remote.current!);
        else { blocked.current = true; setStatus('conflict'); return false; }
      } else remote.current = saved;
      setStatus('saved'); cloudDiagnostic('share.autosave', 'ok'); return true;
    } catch (error) {
      if (epoch.current !== startedEpoch) return false;
      cloudDiagnostic('share.autosave', 'failed', error);
      if ((error as { code?: string }).code === 'share/conflict') { blocked.current = true; setStatus('conflict'); }
      else setStatus('offline');
      return false;
    } finally { if (epoch.current === startedEpoch) { inFlight.current = false; setVersion(v => v + 1); } }
  }, [shareId, transport, journalKey, writeJournal, apply, clearJournal]);

  const performAction = useCallback(async (action: SharedAction): Promise<boolean> => {
    if (activeShare.current !== shareId || detached.current || !shareId || !ready.current || blocked.current || inFlight.current || latest.current.planEditing) return false;
    if (latest.current.isAdmin && sharedContentKey(latest.current.payload) !== canonicalKey.current && !await saveNow()) return false;
    if (!ready.current || detached.current || latest.current.planEditing || blocked.current) return false;
    if (latest.current.isAdmin && sharedContentKey(latest.current.payload) !== canonicalKey.current) {
      setMessage('Your latest edits are still saving. Try the game action again once saved.'); return false;
    }
    const startedEpoch = epoch.current;
    const startingContent = sharedContentKey(latest.current.payload);
    pendingAction.current = action;
    try { recoveryStorage.setItem(actionKey, JSON.stringify(action)); } catch {}
    inFlight.current = true; setStatus('saving'); setMessage('');
    try {
      const saved = await transport.action(shareId, action);
      if (epoch.current !== startedEpoch) return false;
      pendingAction.current = null; recoveryStorage.removeItem(actionKey);
      if (blocked.current || latest.current.planEditing || (latest.current.isAdmin && sharedContentKey(latest.current.payload) !== startingContent)) {
        if (latest.current.payload) writeJournal(latest.current.payload);
        if ((remote.current?.revision ?? 0) < (saved.revision ?? 0)) remote.current = saved;
        blocked.current = true; setStatus('conflict');
        setMessage('The game action saved, and your newer organizer edits were retained for review.'); return true;
      }
      apply((remote.current?.revision ?? 0) > (saved.revision ?? 0) ? remote.current! : saved);
      setStatus('saved'); return true;
    } catch (error) {
      if (epoch.current !== startedEpoch) return false;
      cloudDiagnostic('share.progress', 'failed', error);
      if ((error as { code?: string }).code === 'share/action-blocked') {
        pendingAction.current = null; recoveryStorage.removeItem(actionKey);
        setMessage((error as Error).message);
        if (blocked.current || latest.current.planEditing || (latest.current.isAdmin && sharedContentKey(latest.current.payload) !== startingContent)) {
          if (latest.current.payload) writeJournal(latest.current.payload);
          blocked.current = true; setStatus('conflict');
        } else {
          if (remote.current && (remote.current.revision ?? 0) > (base.current?.revision ?? 0)) apply(remote.current);
          setStatus('saved');
        }
      } else setStatus('offline');
      return false;
    } finally { if (epoch.current === startedEpoch) inFlight.current = false; }
  }, [shareId, saveNow, transport, actionKey, apply, writeJournal, recoveryStorage]);

  useLayoutEffect(() => {
    if (shareId && !detached.current && base.current && isAdmin && payload && localKey !== canonicalKey.current) writeJournal(payload);
  }, [shareId, localKey, isAdmin, payload, writeJournal, version]);
  useEffect(() => {
    if (!shareId || detached.current || !ready.current || blocked.current || inFlight.current || planEditing || !isAdmin || !payload || localKey === canonicalKey.current || status === 'offline') return;
    setStatus('saving');
    const timer = setTimeout(() => { void saveNow(); }, 350);
    autosaveTimer.current = timer;
    return () => { clearTimeout(timer); if (autosaveTimer.current === timer) autosaveTimer.current = undefined; };
  }, [localKey, isAdmin, planEditing, shareId, saveNow, version]);

  const retry = useCallback(() => {
    if (detached.current) return;
    if (!ready.current) { setReconnect(v => v + 1); return; }
    if (pendingAction.current) void performAction(pendingAction.current);
    else void saveNow();
  }, [performAction, saveNow]);
  useEffect(() => { window.addEventListener('online', retry); return () => window.removeEventListener('online', retry); }, [retry]);
  const loadLatest = useCallback(async () => {
    if (activeShare.current !== shareId || !shareId || detached.current || latest.current.planEditing) return;
    const startedEpoch = epoch.current;
    const latestCloud = await transport.fetch(shareId).catch(() => null);
    if (epoch.current !== startedEpoch || detached.current || latest.current.planEditing) return;
    if (latestCloud?.status !== 'ok') { setMessage('Could not load the latest session. Your draft is still retained.'); return; }
    const journal = recoveryStorage.getItem(journalKey);
    if (journal) recoveryStorage.setItem(`${journalKey}:recovery`, journal);
    recoveryStorage.removeItem(journalKey);
    recoveryStorage.removeItem(actionKey); pendingAction.current = null;
    blocked.current = false;
    apply(latestCloud.data); setStatus('saved'); setMessage('Your previous draft is retained on this device for recovery.');
  }, [journalKey, apply, shareId, transport, recoveryStorage, actionKey]);
  const disconnect = useCallback((): boolean => {
    let retainedAction: string | null = null;
    try { retainedAction = actionKey ? recoveryStorage.getItem(actionKey) : null; }
    catch { setMessage('Device recovery storage is unavailable. Keep this session connected and try again.'); return false; }
    if (inFlight.current || pendingAction.current || retainedAction) {
      setMessage('Confirm the pending game action or wait for cloud saving before using this session locally.'); return false;
    }
    if (latest.current.planEditing) { setMessage('Wait for plan generation to finish before using this session locally.'); return false; }
    // Do all fallible storage cleanup before cutting the live connection.
    try {
      if (journalKey) recoveryStorage.removeItem(journalKey);
      if (actionKey) recoveryStorage.removeItem(actionKey);
    } catch { setMessage('Could not clear device recovery storage. Keep this session connected and try again.'); return false; }
    // Invalidate callbacks and timer closures synchronously, before React rerenders.
    detached.current = true; disconnectedShare.current = shareId; ++epoch.current; ready.current = false; blocked.current = true;
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = undefined;
    stopActiveSubscription.current?.(); stopActiveSubscription.current = undefined;
    // Immutable local recovery copies belong to the device and remain available.
    ownedBackup.current = null;
    return true;
  }, [shareId, journalKey, actionKey, recoveryStorage]);
  const downloadDraft = useCallback(() => {
    const retained = Object.keys(localStorage).filter(key => key.startsWith(`${journalKey}:recovery:`)).flatMap(key => {
      try { return [JSON.parse(localStorage.getItem(key)!)]; } catch { return []; }
    });
    const text = recoveryStorage.getItem(journalKey) ?? recoveryStorage.getItem(`${journalKey}:recovery`) ?? (retained.length ? JSON.stringify({ drafts: retained }) : null);
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'shared-session-draft.json'; link.click(); URL.revokeObjectURL(url);
  }, [journalKey, recoveryStorage]);
  const hasRecovery = Boolean(journalKey && (recoveryStorage.getItem(journalKey) || recoveryStorage.getItem(`${journalKey}:recovery`) || Object.keys(localStorage).some(key => key.startsWith(`${journalKey}:recovery:`))));
  return { status, message, disconnect, saveNow, performAction, retry, loadLatest, downloadDraft, hasRecovery, latest: remote.current };
}
