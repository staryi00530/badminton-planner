import { useState, type ReactNode } from 'react';
import { C, FONT, ICONS } from '../constants';
import type { SavedPlan, SharePayload } from '../types';

function ModalShell({ children, maxWidth = 400 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, width: '100%', maxWidth, boxShadow: C.shadow }}>
        {children}
      </div>
    </div>
  );
}

export function LucideIcon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      {(ICONS[name] ?? []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function PinPromptModal({ pinInput, pinError, setPinInput, submitPin, close }: { pinInput: string; pinError: boolean; setPinInput: (value: string) => void; submitPin: () => void; close: () => void }) {
  return (
    <ModalShell maxWidth={280}>
      <p style={{ fontWeight: 700, marginBottom: 12 }}>Enter admin PIN</p>
      <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitPin()} autoFocus placeholder="PIN" style={{ width: '100%', background: C.bg, border: `1px solid ${pinError ? '#ef4444' : C.border}`, borderRadius: 6, padding: '8px 10px', color: C.text, fontSize: 14, fontFamily: FONT, marginBottom: 8 }} />
      {pinError && <p style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>Incorrect PIN</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submitPin} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '8px', fontWeight: 700, fontFamily: FONT }}>Unlock</button>
        <button onClick={close} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: FONT }}>Cancel</button>
      </div>
    </ModalShell>
  );
}

export interface QueuePromotionPrompt {
  completedCourt: number;
  firstGame: { slot: number; court: number; players: string[] };
  blockedPlayers: string[];
  lookaheadGame: { slot: number; court: number; players: string[] } | null;
  replacements: Array<{ replacee: string; replacer: string; gamesWaited?: number }>;
}

export function QueuePromotionModal({ prompt, onUseLookahead, onSubstitute, onCancel }: {
  prompt: QueuePromotionPrompt;
  onUseLookahead: () => void;
  onSubstitute: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell maxWidth={440}>
      <p role="heading" aria-level={2} style={{ fontWeight: 700, marginBottom: 4 }}>Court {prompt.completedCourt} is ready</p>
      <p style={{ fontSize: 13, color: C.textDim, margin: '0 0 12px' }}>
        The next queued game cannot start as-is because {prompt.blockedPlayers.map((name, index) => (
          <span key={name}>{index > 0 && ', '}<strong>{name}</strong></span>
        ))} {prompt.blockedPlayers.length === 1 ? 'is' : 'are'} still playing.
      </p>
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>First queued game</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{prompt.firstGame.players.join(' · ')}</div>
        {prompt.replacements.length > 0 && (
          <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>
            Suggested: {prompt.replacements.map(({ replacee, replacer, gamesWaited }, index) => (
              <span key={`${replacee}-${replacer}`}>{index > 0 && ', '}<strong>{replacer}</strong>{gamesWaited != null && ` (${gamesWaited} games waited)`} for <strong>{replacee}</strong></span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompt.lookaheadGame && (
          <button onClick={onUseLookahead} aria-label="Use next playable game" style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>
            Use next playable game
            <span style={{ display: 'block', fontSize: 11, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>{prompt.lookaheadGame.players.join(' · ')}</span>
          </button>
        )}
        <button onClick={onSubstitute} style={{ background: prompt.lookaheadGame ? C.card : C.accentDim, color: prompt.lookaheadGame ? C.text : '#fff', border: `1px solid ${prompt.lookaheadGame ? C.border : 'transparent'}`, borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>
          Substitute unavailable players
        </button>
        <button onClick={onCancel} style={{ background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px', fontFamily: FONT }}>Cancel</button>
      </div>
    </ModalShell>
  );
}

export function ConfirmOverwriteModal({ onConfirm, onCancel, historyCount = 0, liveCount = 0, isReroll = false }: {
  onConfirm: (resetHistory?: boolean) => void;
  onCancel: () => void;
  historyCount?: number;
  liveCount?: number;
  isReroll?: boolean;
}) {
  const [resetHistory, setResetHistory] = useState(false);
  const historyChoice = isReroll && historyCount > 0;
  return (
    <ModalShell maxWidth={360}>
      <div role="dialog" aria-modal="true" aria-labelledby="overwrite-title" onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
      <p id="overwrite-title" style={{ fontWeight: 700, marginBottom: 4 }}>{isReroll ? 'Reroll the schedule?' : 'Overwrite confirmed schedule?'}</p>
      <p style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>
        {isReroll ? 'Replace the unplayed plan with a new schedule. Confirmed plans are kept in Saved Plans.' : 'This schedule is marked Confirmed. Continuing will save it to Saved Plans and replace it with a new one.'}
      </p>
      {historyChoice && <>
        <p style={{ fontSize: 13 }}>{historyCount} completed game{historyCount === 1 ? '' : 's'} and their scores will {resetHistory ? 'be removed from session history. Reroll starts a fresh configured session.' : 'stay in session history and continue rotation and repeat tracking. Reroll fills the remaining session.'}</p>
        <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 12 }}><input type="checkbox" checked={resetHistory} onChange={event => setResetHistory(event.target.checked)} />Reset session history before reroll</label>
        {resetHistory && <p style={{ fontSize: 12, color: C.amber }}>Remove all {historyCount} completed game{historyCount === 1 ? '' : 's'} from this session only. Player bank and all-time win/loss records stay unchanged.</p>}
      </>}
      {isReroll && liveCount > 0 && <p style={{ fontSize: 13, color: C.amber }}>{liveCount} unfinished live game{liveCount === 1 ? '' : 's'} will be replaced and will not be recorded as completed.</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => historyChoice ? onConfirm(resetHistory) : onConfirm()} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>{historyChoice ? resetHistory ? 'Reset history & reroll' : 'Keep history & reroll' : isReroll ? 'Reroll' : 'Overwrite'}</button>
        <button onClick={onCancel} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
      </div>
      </div>
    </ModalShell>
  );
}

export function SessionChangeModal({ description, boundarySlot, targetCapacity, onConfirm, onCancel }: {
  description: string;
  boundarySlot: number;
  targetCapacity: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <ModalShell>
    <div role="dialog" aria-modal="true" aria-labelledby="session-change-title" onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
      <h2 id="session-change-title" style={{ fontSize: 16, margin: '0 0 12px' }}>Update upcoming games?</h2>
      <p style={{ fontSize: 13, color: C.textDim }}>{description} from slot {boundarySlot}: {targetCapacity} court{targetCapacity === 1 ? '' : 's'} planned.</p>
      <p style={{ fontSize: 13, color: C.textDim }}>Current and completed games, their lineups and scores will not change. The updated future schedule will be unconfirmed.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button autoFocus onClick={onCancel} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
        <button onClick={onConfirm} style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 16px', fontWeight: 700, fontFamily: FONT }}>Update upcoming games</button>
      </div>
    </div>
  </ModalShell>;
}

export function SavePlanModal({ needsPin, pinInput, pinError, setPinInput, submitPin, saveTag, setSaveTag, savePlan, canUpdate, savedPlans, isSharedSession, close }: {
  needsPin: boolean;
  pinInput: string;
  pinError: boolean;
  setPinInput: (value: string) => void;
  submitPin: () => void;
  saveTag: string;
  setSaveTag: (value: string) => void;
  savePlan: (mode?: 'update' | 'new') => void;
  canUpdate: boolean;
  savedPlans: SavedPlan[];
  isSharedSession: boolean;
  close: () => void;
}) {
  const trimmedTag = saveTag.trim().toLowerCase();
  const duplicateTag = !canUpdate && trimmedTag && (savedPlans || []).some(p => p.tag.trim().toLowerCase() === trimmedTag);
  return (
    <ModalShell>
      {needsPin ? (
        <>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>PIN required to save</p>
          <p style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>Enter your admin PIN to save this plan.</p>
          <input type="password" autoFocus value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitPin(); if (e.key === 'Escape') close(); }} placeholder="PIN" style={{ width: '100%', background: C.bg, border: `1px solid ${pinError ? '#ef4444' : C.border}`, borderRadius: 6, padding: '10px', color: C.text, fontSize: 14, fontFamily: FONT, marginBottom: 8 }} />
          {pinError && <p style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>Incorrect PIN</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitPin} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>Unlock</button>
            <button onClick={close} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{canUpdate ? 'Update saved plan' : 'Save this plan'}</p>
          {canUpdate && <p style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>This will overwrite the saved plan you loaded, or save as a new copy below.</p>}
          <input autoFocus value={saveTag} onChange={e => setSaveTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') savePlan(canUpdate ? 'update' : undefined); if (e.key === 'Escape') close(); }} placeholder="e.g. Wed 30/4 · 8 players" style={{ width: '100%', background: C.bg, border: `1px solid ${duplicateTag ? C.amber : C.border}`, borderRadius: 6, padding: '10px', color: C.text, fontSize: 14, fontFamily: FONT, boxSizing: 'border-box', marginTop: canUpdate ? 0 : 12 }} />
          {duplicateTag && (
            <p style={{ fontSize: 11, color: C.amber, marginTop: 6 }}>
              A saved plan named "{saveTag.trim()}" already exists — saving will update it instead of creating a duplicate.
            </p>
          )}
          {isSharedSession && (
            <p style={{ fontSize: 11, color: C.accent, marginTop: 6 }}>
              You opened this from a shared link — saving will also push your current changes to everyone with that link.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => savePlan(canUpdate ? 'update' : undefined)} disabled={!saveTag.trim()} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT, opacity: saveTag.trim() ? 1 : 0.4 }}>{canUpdate ? 'Update' : 'Save'}</button>
            <button onClick={close} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
          </div>
          {canUpdate && (
            <button onClick={() => savePlan('new')} disabled={!saveTag.trim()} style={{ marginTop: 8, width: '100%', background: 'transparent', color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '7px', fontFamily: FONT, fontSize: 12, opacity: saveTag.trim() ? 1 : 0.4 }}>
            Save as a new copy instead
            </button>
          )}
        </>
      )}
    </ModalShell>
  );
}

export function ShareLinkModal({ copiedShareUrl, sharedUrl, shareIsUpdate, hasExisting, copyShareUrl, copyOrganizerUrl, publicationStatus = 'live', newShareLink, close }: { copiedShareUrl: boolean; sharedUrl: string; shareIsUpdate: boolean; hasExisting: boolean; copyShareUrl: () => void; copyOrganizerUrl?: (url: string) => void; publicationStatus?: 'live' | 'pending' | 'connecting' | 'paused'; newShareLink: () => void; close: () => void }) {
  const url = new URL(sharedUrl);
  const isPlayerLink = url.searchParams.get('view') === 'players';
  const organizerUrl = new URL(url);
  organizerUrl.searchParams.delete('view');
  const statusText = isPlayerLink ? 'Players can browse All games or choose My games. Game progress and organizer edits publish automatically while this device stays in the shared session.'
    : 'This is a published snapshot. It does not receive live game updates. Publish again after changes.';
  return (
    <ModalShell maxWidth={480}>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{isPlayerLink ? 'Player link' : 'Published snapshot'}</p>
      <p style={{ fontSize: 12, color: copiedShareUrl ? C.green : C.textDim, marginBottom: 12 }}>
        {copiedShareUrl ? (shareIsUpdate ? '✓ Updated! Link copied.' : '✓ Copied!') : statusText}
      </p>
      {isPlayerLink && publicationStatus !== 'live' && <p role={publicationStatus === 'paused' ? 'alert' : 'status'} style={{color:C.amber,fontSize:12}}>
        {publicationStatus === 'paused' ? 'Latest changes are not published. This link shows the last saved session; retry the organizer connection.'
          : publicationStatus === 'connecting' ? 'The player link is created. Connecting this device to publish further updates…'
          : 'Publishing latest changes. Players see the last saved session until saving completes.'}
      </p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input aria-label={isPlayerLink ? 'Player link' : 'Snapshot link'} readOnly value={sharedUrl} onFocus={e => e.target.select()} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', color: C.textDim, fontSize: 11, fontFamily: 'monospace', minWidth: 0 }} />
        <button onClick={copyShareUrl} style={{ background: copiedShareUrl ? C.green : C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap' }}>
          {copiedShareUrl ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {isPlayerLink && <div style={{ marginTop: 16 }}>
        <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 6px' }}>Organizer session link</p>
        <p style={{ color: C.textDim, fontSize: 12 }}>Use this on your organizing iPad to keep publishing live updates. For private levels and preferences, use Transfer organizer setup separately.</p>
        <input aria-label="Organizer session link" readOnly value={organizerUrl.toString()} onFocus={event => event.target.select()} style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, background: C.bg, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace' }} />
        {copyOrganizerUrl && <button onClick={() => copyOrganizerUrl(organizerUrl.toString())} style={{ minHeight: 44, width: '100%', marginTop: 6, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: FONT }}>Copy organizer link</button>}
      </div>}
      {hasExisting && (
        <button onClick={() => { close(); newShareLink(); }} style={{ marginTop: 8, width: '100%', background: 'transparent', color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '7px', fontFamily: FONT, fontSize: 12 }}>
          Generate a fresh link instead
        </button>
      )}
      <button onClick={close} style={{ marginTop: 8, width: '100%', background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px', fontFamily: FONT }}>Close</button>
    </ModalShell>
  );
}

export function ShareLoadModal({ pendingShare, loadSharedSchedule, dismiss }: { pendingShare: SharePayload; loadSharedSchedule: () => void; dismiss: () => void }) {
  return (
    <ModalShell>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>Load shared schedule?</p>
      <p style={{ fontSize: 12, color: C.textDim, marginBottom: 16 }}>
        {pendingShare.p.length} players · {pendingShare.slots.length} slots
        <br />This will replace your current schedule and player list.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={loadSharedSchedule} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>Load</button>
        <button onClick={dismiss} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Dismiss</button>
      </div>
    </ModalShell>
  );
}

export function ImportModal({ importText, importError, setImportText, importSchedule, close }: { importText: string; importError: string; setImportText: (value: string) => void; importSchedule: () => void; close: () => void }) {
  return (
    <ModalShell maxWidth={520}>
      <p style={{ fontWeight: 700, marginBottom: 8 }}>Import schedule from text</p>
      <p style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>Paste the copied schedule text (the same text you send to the group chat).</p>
      <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="🏸 Badminton Schedule — ..." style={{ width: '100%', height: 200, background: C.bg, border: `1px solid ${importError ? '#ef4444' : C.border}`, borderRadius: 6, padding: '8px 10px', color: C.text, fontSize: 12, fontFamily: FONT, resize: 'vertical' }} />
      {importError && <p style={{ color: '#ef4444', fontSize: 11, margin: '4px 0 8px' }}>{importError}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={importSchedule} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>Import</button>
        <button onClick={close} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
      </div>
    </ModalShell>
  );
}

export function ArchiveTab({ savedPlans, loadPlan, deletePlan }: { savedPlans: SavedPlan[]; loadPlan: (plan: SavedPlan) => void; deletePlan: (id: number) => void }) {
  if (savedPlans.length === 0) {
    return (
      <p style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
        No saved plans yet — past schedules are kept here for ~2 weeks whenever you generate a new one, clear the current one, or hit Save.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {savedPlans.map(plan => (
        <div key={plan.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <LucideIcon name="bookmark" size={13} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{plan.tag || (plan.sourceShareId ? 'Shared schedule' : 'Schedule')}</span>
          <span style={{ fontSize: 11, color: C.textDim }}>
            {new Date(plan.savedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}
            {new Date(plan.savedAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button onClick={() => loadPlan(plan)} style={{ background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'pointer' }}>Load</button>
          <button onClick={() => deletePlan(plan.id)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
            <LucideIcon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
