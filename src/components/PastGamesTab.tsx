import { C, FONT } from '../constants';
import type { PlannerResult, ScoresMap, WinLossMap } from '../types';
import type { Player } from '../algorithm/types';
import type { GameRef } from '../utils/liveQueue';
import { historyScheduleState, mergePlayedGames, migratePlayedGames } from '../utils/playedHistory';
import type { PlayedGame } from '../utils/playedHistory';
import PlayerStatsPanel from './PlayerStatsPanel';

interface PastGamesTabProps {
  result: PlannerResult | null;
  completedGames: GameRef[];
  liveGames: GameRef[];
  scores: ScoresMap;
  players: Player[];
  winLoss: WinLossMap;
  playedGames?: PlayedGame[];
  onDownloadBackup?: (json: string) => void;
}

export default function PastGamesTab({ result, completedGames, liveGames, scores, players, winLoss, playedGames, onDownloadBackup }: PastGamesTabProps) {
  const games = playedGames === undefined ? migratePlayedGames(result,players,completedGames,scores) : mergePlayedGames([],playedGames);
  const state = historyScheduleState(games,players);
  const download = () => {
    const json=JSON.stringify({version:1,exportedAt:new Date().toISOString(),playedGames:games},null,2);
    if(onDownloadBackup){onDownloadBackup(json);return;}
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url;link.download='badminton-played-history.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Past games</h2>
      <p style={{ margin: '0 0 16px', color: C.textDim, fontSize: 12 }}>Completed games in the order they were recorded.</p>
      {games.length > 0 && <button type="button" onClick={download} style={{marginBottom:12,color:C.text,background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'6px 10px'}}>Download history backup</button>}
      {games.length === 0 ? <p style={{ color: C.textMuted, fontSize: 13 }}>No completed games yet.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {games.map((game,index) => (
            <div key={game.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textDim, fontSize: 11, fontFamily: FONT, fontWeight: 700 }}>
                <span>Game {index + 1} · Slot {game.slot} · Court {(game.displayCourt ?? game.court) + 1}</span>
                {game.score && (game.score.a || game.score.b) && <span>{game.score.a}–{game.score.b}</span>}
              </div>
              <div style={{ marginTop: 6, fontSize: 14, color: C.text }}>
                <span>{game.teamA.map(p=>p.name).join(' · ')}</span> <span style={{ color: C.textMuted }}>VS</span> <span>{game.teamB.map(p=>p.name).join(' · ')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {playedGames === undefined ? <PlayerStatsPanel players={players} result={result} completedGames={completedGames} liveGames={liveGames} winLoss={winLoss} /> :
        <div style={{marginTop:20,borderTop:`1px solid ${C.border}`,paddingTop:16}}>
          <h3 style={{margin:'0 0 6px',fontSize:14}}>Player stats</h3>
          <p style={{margin:'0 0 12px',color:C.textDim,fontSize:12}}>Actual recorded games and eligible waiting events. W–L is all-time.</p>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12,fontFamily:FONT}}>
            <thead><tr style={{textAlign:'left',color:C.textDim}}>{['Player','Played','Waited','Live','W–L'].map(label=><th key={label} style={{padding:8}}>{label}</th>)}</tr></thead>
            <tbody>{players.map((player,index)=>{
              const names=[player.name,...(player.aliases ?? [])];
              const waited=games.filter(game=>game.waitingIds.some(id=>id===player.id||names.some(name=>id===`legacy:${name.trim().toLowerCase()}`))).length;
              const live=liveGames.filter(ref=>{
                const court=result?.schedule.find(slot=>slot.slot===ref.slot)?.courts[ref.court];
                return (ref.players ?? (court?[...court.teamA,...court.teamB].map(p=>p.name):[])).some(name=>names.includes(name));
              }).length;
              const wl=winLoss[player.name];
              return <tr key={player.id ?? player.name} style={{borderTop:`1px solid ${C.border}`}}>
                <td style={{padding:8,color:player.gender==='F'?C.pink:C.text,fontWeight:600}}>{player.name}</td>
                <td style={{padding:8}}>{state.gamesPlayed[index]}</td><td style={{padding:8}}>{waited}</td><td style={{padding:8}}>{live}</td><td style={{padding:8}}>{wl?.wins ?? 0}–{wl?.losses ?? 0}</td>
              </tr>;
            })}</tbody>
          </table></div>
        </div>}
    </div>
  );
}
