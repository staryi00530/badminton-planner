// @ts-nocheck
import { C, FONT, ICONS } from '../constants';

function ModalShell({ children, maxWidth = 400 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, width: '100%', maxWidth, boxShadow: C.shadow }}>
        {children}
      </div>
    </div>
  );
}

export function LucideIcon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function PinPromptModal({ pinInput, pinError, setPinInput, submitPin, close }) {
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

export function ConfirmOverwriteModal({ onConfirm, onCancel }) {
  return (
    <ModalShell maxWidth={360}>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>Overwrite confirmed schedule?</p>
      <p style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>
        This schedule is marked Confirmed. Continuing will save it to Saved Plans and replace it with a new one.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onConfirm} style={{ flex: 1, background: C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontWeight: 700, fontFamily: FONT }}>Overwrite</button>
        <button onClick={onCancel} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 16px', fontFamily: FONT }}>Cancel</button>
      </div>
    </ModalShell>
  );
}

export function SavePlanModal({ needsPin, pinInput, pinError, setPinInput, submitPin, saveTag, setSaveTag, savePlan, canUpdate, savedPlans, isSharedSession, close }) {
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

export function ShareLinkModal({ copiedShareUrl, sharedUrl, shareIsUpdate, hasExisting, copyShareUrl, newShareLink, close }) {
  const statusText = shareIsUpdate ? '✓ Schedule updated — same link reflects your latest changes.'
    : 'Link copied to clipboard. Anyone who opens it sees this schedule. Hit Save after editing to push your changes to the same link.';
  return (
    <ModalShell maxWidth={480}>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{shareIsUpdate ? 'Schedule updated' : 'Share link'}</p>
      <p style={{ fontSize: 12, color: copiedShareUrl ? C.green : C.textDim, marginBottom: 12 }}>
        {copiedShareUrl ? (shareIsUpdate ? '✓ Updated! Link copied.' : '✓ Copied!') : statusText}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input readOnly value={sharedUrl} onFocus={e => e.target.select()} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', color: C.textDim, fontSize: 11, fontFamily: 'monospace', minWidth: 0 }} />
        <button onClick={copyShareUrl} style={{ background: copiedShareUrl ? C.green : C.accentDim, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap' }}>
          {copiedShareUrl ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {hasExisting && (
        <button onClick={() => { close(); newShareLink(); }} style={{ marginTop: 8, width: '100%', background: 'transparent', color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '7px', fontFamily: FONT, fontSize: 12 }}>
          Generate a fresh link instead
        </button>
      )}
      <button onClick={close} style={{ marginTop: 8, width: '100%', background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px', fontFamily: FONT }}>Close</button>
    </ModalShell>
  );
}

export function ShareLoadModal({ pendingShare, loadSharedSchedule, dismiss }) {
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

export function ImportModal({ importText, importError, setImportText, importSchedule, close }) {
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

export function ArchiveTab({ savedPlans, loadPlan, deletePlan }) {
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
