import { useState } from 'react';
import { C, FONT } from '../constants';
import type { ExtraCourt, Player, PreferredPair, StaggerMode } from '../types';

interface SessionSettingsPanelProps {
  visible?: boolean;
  sessionStart: string;
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  staggerMode: StaggerMode;
  preferMixedTeams: boolean;
  scheduleActive?: boolean;
  players?: Player[];
  preferredPairs?: PreferredPair[];
  patchState: (patch: Partial<SessionSettingsPanelProps> & { preferredPairs?: PreferredPair[]; scheduleDirty?: boolean }) => void;
}

export default function SessionSettingsPanel({
  visible = true,
  sessionStart,
  totalMinutes,
  gameMinutes,
  numCourts,
  extraCourt,
  staggerMode,
  preferMixedTeams,
  scheduleActive = false,
  players = [],
  preferredPairs = [],
  patchState,
}: SessionSettingsPanelProps) {
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const addPreferredPair = (first: string, second: string) => {
    if (!first || !second || first === second) return;
    const pair: PreferredPair = [first, second].sort((a, b) => a.localeCompare(b)) as PreferredPair;
    if (preferredPairs.some(existing => existing[0] === pair[0] && existing[1] === pair[1])) return;
    patchState({ preferredPairs: [...preferredPairs, pair], ...(scheduleActive ? { scheduleDirty: true } : {}) });
  };
  const removePreferredPair = (pair: PreferredPair) => {
    patchState({ preferredPairs: preferredPairs.filter(existing => existing[0] !== pair[0] || existing[1] !== pair[1]), ...(scheduleActive ? { scheduleDirty: true } : {}) });
  };
  const [pairFirst, setPairFirst] = useState('');
  const [pairSecond, setPairSecond] = useState('');
  if (!visible) return null;
  return (
    <details open={!scheduleActive} style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 16, marginBottom: 20 }}>
      <summary style={{ fontSize: 14, color: C.text, fontWeight: 700, cursor: 'pointer' }}>Session settings</summary>
      <div className="settings-row" style={{ marginTop: 14, marginBottom: 0 }}>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Start time</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input type="time" value={sessionStart} onChange={e => patchState({ sessionStart: e.target.value })} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', color: sessionStart ? C.text : C.textMuted, fontSize: 13, fontFamily: FONT }} />
            {sessionStart && <button onClick={() => patchState({ sessionStart: '' })} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 15, padding: 0, lineHeight: 1 }}>×</button>}
          </div>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Session length</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="range" min={60} max={240} step={gameMinutes} value={totalMinutes} onChange={e => patchState({ totalMinutes: +e.target.value })} style={{ flex: 1, accentColor: C.accent }} />
            <span style={{ fontSize: 14, color: C.accent, fontWeight: 600, minWidth: 48, textAlign: 'right' }}>{Math.floor(totalMinutes / 60)}h{totalMinutes % 60 ? `${totalMinutes % 60}m` : ''}</span>
          </div>
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Game length</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="range" min={8} max={20} value={gameMinutes} onChange={e => patchState({ gameMinutes: +e.target.value })} style={{ flex: 1, accentColor: C.accent }} />
            <span style={{ fontSize: 14, color: C.accent, fontWeight: 600, minWidth: 48, textAlign: 'right' }}>{gameMinutes}m</span>
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Courts</label>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map(nc => (
              <button key={nc} onClick={() => patchState({ numCourts: nc })} style={{ background: numCourts === nc ? C.accentDim : C.card, color: numCourts === nc ? '#fff' : C.textDim, border: `1px solid ${numCourts === nc ? C.accentDim : C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 14, fontWeight: 600, fontFamily: FONT }}>
                {nc}
              </button>
            ))}
          </div>
        </div>
        {numCourts < 5 && (
          <div style={{ flex: '0 0 auto' }}>
            <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Extra court</label>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
              <button onClick={() => patchState({ extraCourt: { ...extraCourt, enabled: !extraCourt.enabled } })} style={{ background: extraCourt.enabled ? C.accentDim : C.card, color: extraCourt.enabled ? '#fff' : C.textDim, border: `1px solid ${extraCourt.enabled ? C.accentDim : C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
                {extraCourt.enabled ? 'ON' : 'OFF'}
              </button>
              {extraCourt.enabled && (
                <>
                  <span style={{ fontSize: 11, color: C.textDim }}>@</span>
                  <input type="number" min={0} max={totalMinutes - gameMinutes} step={gameMinutes} value={extraCourt.startMin} onChange={e => patchState({ extraCourt: { ...extraCourt, startMin: +e.target.value } })} style={{ width: 44, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '5px 6px', color: C.text, fontSize: 12, fontFamily: FONT, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: C.textDim }}>m for</span>
                  <input type="number" min={gameMinutes} max={totalMinutes} step={gameMinutes} value={extraCourt.durationMin} onChange={e => patchState({ extraCourt: { ...extraCourt, durationMin: +e.target.value } })} style={{ width: 44, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '5px 6px', color: C.text, fontSize: 12, fontFamily: FONT, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: C.textDim }}>m</span>
                </>
              )}
            </div>
          </div>
        )}
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Availability</label>
          <div className="avail-buttons" style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {([['none', 'All here'], ['group', 'Early / Late'], ['custom', 'Per player']] as const).map(([val, label]) => (
              <button key={val} onClick={() => patchState({ staggerMode: val })} style={{ background: staggerMode === val ? C.accentDim : C.card, color: staggerMode === val ? '#fff' : C.textDim, border: `1px solid ${staggerMode === val ? C.accentDim : C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 12, fontWeight: 600, fontFamily: FONT, flex: 1 }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mixed teams</label>
          <div style={{ marginTop: 4 }}>
            <button onClick={() => patchState({ preferMixedTeams: !preferMixedTeams })}
              title={preferMixedTeams ? 'Each game has 1F+1M per side (2F per court)' : 'Females spread evenly across courts (1F per court when outnumbered)'}
              style={{ background: preferMixedTeams ? C.pinkDim : C.card, color: preferMixedTeams ? '#fff' : C.textDim, border: `1px solid ${preferMixedTeams ? C.pinkDim : C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
              {preferMixedTeams ? '1F+1M / side' : 'Spread F'}
            </button>
          </div>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <label style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Preferred pairings</label>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <select aria-label="Preferred pairing first player" value={pairFirst} onChange={e => setPairFirst(e.target.value)} style={{ flex: '1 1 90px', minWidth: 90, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 5px', color: C.text, fontSize: 12, fontFamily: FONT }}>
              <option value="">Player 1</option>
              {sortedPlayers.map(player => <option key={player.name} value={player.name}>{player.name}</option>)}
            </select>
            <span style={{ color: C.textMuted }}>+</span>
            <select aria-label="Preferred pairing second player" value={pairSecond} onChange={e => setPairSecond(e.target.value)} style={{ flex: '1 1 90px', minWidth: 90, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 5px', color: C.text, fontSize: 12, fontFamily: FONT }}>
              <option value="">Player 2</option>
              {sortedPlayers.map(player => <option key={player.name} value={player.name}>{player.name}</option>)}
            </select>
            <button onClick={() => { addPreferredPair(pairFirst, pairSecond); setPairFirst(''); setPairSecond(''); }} disabled={!pairFirst || !pairSecond || pairFirst === pairSecond} style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 8px', fontSize: 12, fontFamily: FONT }}>Add</button>
          </div>
          {preferredPairs.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>{preferredPairs.map(pair => <span key={pair.join('|')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(125,211,252,0.08)', border: `1px solid ${C.border}`, borderRadius: 4, padding: '3px 6px', color: C.textDim, fontSize: 11 }}>{pair[0]} + {pair[1]}<button onClick={() => removePreferredPair(pair)} aria-label={`Remove preferred pairing ${pair[0]} and ${pair[1]}`} style={{ background: 'none', border: 'none', color: C.textMuted, padding: 0, cursor: 'pointer' }}>×</button></span>)}</div>}
        </div>
      </div>
    </details>
  );
}
