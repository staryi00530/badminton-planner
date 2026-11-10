import { useEffect, useState } from 'react';
import { C } from '../constants';

export interface WaitingPlayerRow {
  key: string;
  name: string;
  status: 'playing' | 'waiting' | 'unavailable';
  since?: number;
  slotsWaited: number;
  gamesPlayed: number;
}

function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The interval updates only this display; persisted clocks change on session actions. */
export default function PlayerWaitingPanel({ rows, trackingStartedAt }: {
  rows: WaitingPlayerRow[];
  trackingStartedAt?: number;
}) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const tracking = trackingStartedAt != null;
  const hasRecordedWait = tracking && rows.some(row => row.status === 'waiting' && row.since != null);
  useEffect(() => {
    if (!hasRecordedWait) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [hasRecordedWait]);
  const statusOrder = { waiting: 0, playing: 1, unavailable: 2 };
  const sorted = [...rows].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
    || (a.status === 'waiting' && tracking ? (a.since ?? Infinity) - (b.since ?? Infinity) : 0)
    || b.slotsWaited - a.slotsWaited || a.gamesPlayed - b.gamesPlayed || a.name.localeCompare(b.name));
  const waiting = rows.filter(row => row.status === 'waiting');
  const earliest = Math.min(...waiting.flatMap(row => tracking && row.since != null ? [row.since] : []));
  return <details aria-label="Player waiting times" onToggle={event => setExpanded(event.currentTarget.open)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16 }}>
    <summary style={{ padding: '14px 16px', minHeight: 48, boxSizing: 'border-box', cursor: 'pointer', fontWeight: 700 }}>
      Player waiting times <span style={{ fontSize: 12, fontWeight: 400, color: C.textDim }}>· {waiting.length} waiting{Number.isFinite(earliest) ? ` · longest ${elapsed(earliest, now)}` : ''}</span>
    </summary>
    {expanded && <div style={{ padding: '0 16px 16px' }}>
      <p style={{ color: C.textDim, fontSize: 12, margin: '0 0 12px' }}>
        {tracking ? 'Waiting time runs only while available and off court. Slots waited counts each eligible slot once since last playing, regardless of how many courts finish.'
          : 'Press Start session timers when play begins to track waiting time.'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead><tr>{['Player', 'Status', 'Wait time', 'Slots waited', 'Games played'].map(label => <th key={label} scope="col" style={{ color: C.textDim, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead>
          <tbody>{sorted.map(row => <tr key={row.key}>
            <th scope="row" style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, overflowWrap: 'anywhere' }}>{row.name}</th>
            <td style={{ padding: 10, color: row.status === 'waiting' ? C.amber : C.textDim }}>{row.status === 'playing' ? 'Playing' : row.status === 'unavailable' ? 'Unavailable' : 'Waiting'}</td>
            <td style={{ padding: 10, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{row.status !== 'waiting' ? '—' : !tracking ? 'Not started' : row.since == null ? <span title="Waiting start time was not recorded for this player">Time not recorded</span> : elapsed(row.since, now)}</td>
            <td style={{ padding: 10 }}>{row.status === 'waiting' ? row.slotsWaited : '—'}</td>
            <td style={{ padding: 10 }}>{row.gamesPlayed}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
  </details>;
}
