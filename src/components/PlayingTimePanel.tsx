import { useEffect, useState } from 'react';
import { C } from '../constants';
import type { Player } from '../algorithm/types';
import type { PlannerResult } from '../types';
import type { GameRef } from '../utils/liveQueue';
import { mergePlayedGames, type PlayedGame } from '../utils/playedHistory';
import { formatPlayingDuration, playerPlayingTimes, recordedPlayingDuration } from '../utils/playingTime';

export default function PlayingTimePanel({ players, games, liveGames, result }: {
  players: Player[]; games: PlayedGame[]; liveGames: GameRef[]; result: PlannerResult | null;
}) {
  const [now,setNow] = useState(Date.now);
  const ticking = liveGames.some(game=>Number.isSafeInteger(game.startedAt) && game.startedAt! >= 0);
  useEffect(()=>{
    if (!ticking) return;
    const update=()=>setNow(Date.now()); update();
    const timer=window.setInterval(update,1000);
    document.addEventListener('visibilitychange',update);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',update);};
  },[ticking]);
  const rows=playerPlayingTimes(games,players,liveGames,result,now).sort((a,b)=>a.player.name.localeCompare(b.player.name));
  const completed=mergePlayedGames([],games);
  const timed=completed.filter(game=>recordedPlayingDuration(game)!=null).length;
  return <section aria-label="Playing time statistics" style={{margin:'16px 0',padding:12,border:`1px solid ${C.border}`,borderRadius:8}}>
    <h3 style={{margin:'0 0 8px',fontSize:14}}>Playing time</h3>
    <p style={{color:C.textDim,fontSize:12}}>Timing recorded for {timed} of {completed.length} completed games. Totals and averages exclude unknown durations. Live time is provisional and separate. Times are minutes:seconds or hours:minutes:seconds.</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12,textAlign:'left'}}>
      <thead><tr>{['Player','Completed time','Average game','Timed / completed','Live time'].map(label=><th key={label} scope="col" style={{padding:8,color:C.textDim}}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={row.player.id ?? row.player.name} style={{borderTop:`1px solid ${C.border}`}}>
        <th scope="row" style={{padding:8,fontWeight:600}}>{row.player.name}</th>
        <td style={{padding:8,fontVariantNumeric:'tabular-nums'}}>{row.timedGames ? formatPlayingDuration(row.completedMs) : '—'}</td>
        <td style={{padding:8,fontVariantNumeric:'tabular-nums'}}>{row.averageMs == null ? '—' : formatPlayingDuration(row.averageMs)}</td>
        <td style={{padding:8}}>{row.timedGames} / {row.timedGames+row.unknownGames}{row.unknownGames ? ` · ${row.unknownGames} unknown` : ''}</td>
        <td style={{padding:8,fontVariantNumeric:'tabular-nums'}}>{!row.liveGames ? '—' : row.untimedLiveGames === row.liveGames ? 'Unknown' : `${formatPlayingDuration(row.liveMs)}${row.untimedLiveGames ? ` + ${row.untimedLiveGames} unknown` : ''}`}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
