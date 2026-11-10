import { useEffect, useState } from 'react';
import { C } from '../constants';

interface CourtElapsedTimeProps {
  startedAt?: number;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  const tail = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${tail}` : tail;
}

export default function CourtElapsedTime({ startedAt }: CourtElapsedTimeProps) {
  const [now, setNow] = useState(Date.now);
  const knownStart = startedAt != null && Number.isFinite(startedAt) && Number.isInteger(startedAt) && startedAt >= 0;

  useEffect(() => {
    if (!knownStart) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [startedAt, knownStart]);

  return (
    <span
      title={knownStart ? undefined : 'This game’s start time was not recorded.'}
      style={{ color: C.textDim, fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textTransform: 'none', whiteSpace: 'nowrap' }}
    >
      Elapsed {knownStart ? formatElapsed(now - startedAt) : '—'}
    </span>
  );
}
