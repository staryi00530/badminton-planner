import { C, FONT } from '../constants';
import type { ExtraCourt, StaggerMode } from '../types';

interface SessionSettingsPanelProps {
  sessionStart: string;
  totalMinutes: number;
  gameMinutes: number;
  numCourts: number;
  extraCourt: ExtraCourt;
  staggerMode: StaggerMode;
  preferMixedTeams: boolean;
  patchState: (patch: Partial<SessionSettingsPanelProps>) => void;
}

export default function SessionSettingsPanel({
  sessionStart,
  totalMinutes,
  gameMinutes,
  numCourts,
  extraCourt,
  staggerMode,
  preferMixedTeams,
  patchState,
}: SessionSettingsPanelProps) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 20, boxShadow: C.shadow }}>
      <h3 style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, margin: '0 0 14px' }}>Session</h3>
      <div className="settings-row" style={{ marginBottom: 0 }}>
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
            {[1, 2, 3, 4].map(nc => (
              <button key={nc} onClick={() => patchState({ numCourts: nc })} style={{ background: numCourts === nc ? C.accentDim : C.card, color: numCourts === nc ? '#fff' : C.textDim, border: `1px solid ${numCourts === nc ? C.accentDim : C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 14, fontWeight: 600, fontFamily: FONT }}>
                {nc}
              </button>
            ))}
          </div>
        </div>
        {numCourts < 4 && (
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
      </div>
    </div>
  );
}
