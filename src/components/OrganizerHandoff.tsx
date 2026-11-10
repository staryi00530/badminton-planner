import { useEffect, useRef, useState } from 'react';
import { createShare, fetchShare, isFirebaseConfigured } from '../firebase';
import { encryptOrganizerSetup, decryptOrganizerSetup, type OrganizerSetup } from '../utils/organizerTransfer';
import { C, FONT } from '../constants';

export interface TransferTarget { id: string; key: string }
export default function OrganizerHandoff({ target, canExport, createSetup, onImport, onCancel, onCopy }: {
  target: TransferTarget | null;
  canExport: boolean;
  createSetup: () => OrganizerSetup;
  onImport: (setup: OrganizerSetup) => boolean;
  onCancel: () => void;
  onCopy: (url: string) => void;
}) {
  const [incoming, setIncoming] = useState<OrganizerSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [outgoingUrl, setOutgoingUrl] = useState('');
  const request = useRef<{ id: string; key: string; result: Promise<OrganizerSetup> } | null>(null);
  useEffect(() => {
    let stopped = false;
    setIncoming(null); setError('');
    if (!target) { setLoading(false); return; }
    setLoading(true);
    if (request.current?.id !== target.id || request.current.key !== target.key) {
      request.current = { ...target, result: (async () => {
        if (!target.key) throw new Error('Missing transfer key');
        const result = await fetchShare(target.id);
        if (result.status !== 'ok') throw new Error('Unavailable transfer');
        return decryptOrganizerSetup(result.data, target.key);
      })() };
    }
    void request.current.result.then(setup => { if (!stopped) setIncoming(setup); }).catch(() => {
      if (!stopped) setError('This organizer transfer could not be opened. It may have expired or the link may be incomplete. Your current session is unchanged.');
    }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [target?.id, target?.key]);

  const createLink = async () => {
    if (creating) return;
    setCreating(true); setError('');
    try {
      if (!isFirebaseConfigured()) throw new Error('Cloud unavailable');
      const { envelope, key } = await encryptOrganizerSetup(createSetup());
      const id = await createShare(envelope);
      if (!id) throw new Error('Transfer not saved');
      const url = new URL(window.location.pathname, window.location.origin);
      url.searchParams.set('transfer', id);
      url.hash = `key=${encodeURIComponent(key)}`;
      setOutgoingUrl(url.href);
    } catch {
      setError('Could not create the organizer transfer. Your session is unchanged. Check the connection and try again.');
    } finally { setCreating(false); }
  };
  const button = { minHeight: 44, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontFamily: FONT };
  return <>
    {target && <section aria-label="Organizer setup transfer" style={{ background: C.card, border: `1px solid ${C.accent}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <h2 style={{fontSize:17}}>Use this organizer setup on this device?</h2>
      {loading && <p role="status">Opening private organizer transfer…</p>}
      {incoming && <>
        <p>{incoming.players.length} players · {incoming.hasPlan ? 'Schedule and played history included' : 'Setup ready to generate'}.</p>
        <p>Includes private player levels, player bank, preferred pairings and session settings. This replaces the active session here; a private backup of this device’s previous session is kept.</p>
        <p>The imported copy runs on this device independently. It will not receive or send live updates to the original.</p>
        <button style={button} onClick={() => { if (!onImport(incoming)) setError('Could not keep a safe local copy yet. Resolve any pending game action or storage error, then try again.'); }}>Use on this device</button>
      </>}
      <button style={{...button,marginLeft:8}} onClick={onCancel}>Cancel transfer</button>
    </section>}
    {error && <p role="alert" style={{color:C.amber,marginBottom:12}}>{error}</p>}
    {canExport && !target && <div style={{marginBottom:16}}>
      <button style={button} disabled={creating} onClick={() => { void createLink(); }}>{creating ? 'Creating organizer transfer…' : 'Transfer organizer setup'}</button>
      <span style={{display:'block',fontSize:12,color:C.textDim,marginTop:4}}>Move the full setup, including private levels, to your iPad as an independent copy.</span>
    </div>}
    {outgoingUrl && <section role="dialog" aria-label="Private organizer transfer" aria-modal="false" style={{background:C.card,border:`1px solid ${C.accent}`,padding:16,borderRadius:8,marginBottom:16}}>
      <h2 style={{fontSize:17}}>Private organizer transfer</h2>
      <p>Anyone with this link can open your complete organizer setup, including private levels. Keep it for your own devices. Expires after seven days.</p>
      <p>Opening it offers a local copy; it does not join a live shared session.</p>
      <input aria-label="Private transfer link" readOnly value={outgoingUrl} onFocus={event=>event.target.select()} style={{width:'100%',background:C.bg,color:C.text,padding:10,border:`1px solid ${C.border}`,borderRadius:6}}/>
      <div style={{display:'flex',gap:8,marginTop:10}}><button style={button} onClick={()=>onCopy(outgoingUrl)}>Copy transfer link</button><button style={button} onClick={()=>setOutgoingUrl('')}>Close transfer link</button></div>
    </section>}
  </>;
}
