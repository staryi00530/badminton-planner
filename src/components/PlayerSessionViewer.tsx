import { useEffect, useMemo, useState } from 'react';
import { C, FONT } from '../constants';
import { usePlayerSession, type PlayerSessionStatus } from '../hooks/usePlayerSession';
import { playerViewModel, type PlayerViewGame } from '../utils/playerView';
import { plannerStorageKey } from '../utils/plannerStorage';
import CourtElapsedTime from './CourtElapsedTime';
import { formatPlayingDuration } from '../utils/playingTime';

const preferenceKey = (shareId: string | null) => plannerStorageKey(`bp-player-view:${shareId ?? 'invalid'}:selection`);
function readSelection(shareId: string | null) {
  if (!shareId) return '';
  try { return localStorage.getItem(preferenceKey(shareId)) ?? ''; } catch { return ''; }
}
const statusText: Record<PlayerSessionStatus,string> = {
  loading:'Opening player view…', live:'Receiving live updates', reconnecting:'Reconnecting — showing last received games',
  offline:'Offline — showing last received games', error:'Updates paused — retry the connection',
  not_found:'This player link was not found', expired:'This player link has expired', invalid:'This player link could not be read',
};
const buttonStyle = {background:C.card,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 16px',minHeight:44,fontFamily:FONT,cursor:'pointer'};

function PlayerGameCard({game,selectedId}:{game:PlayerViewGame;selectedId:string}) {
  const person = (player:PlayerViewGame['teamA'][number]) => <span key={player.id} style={{fontWeight:player.id===selectedId?800:600,color:player.id===selectedId?C.accent:C.text,overflowWrap:'anywhere'}}>{player.name}{player.id===selectedId?' (you)':''}</span>;
  const team = (players:PlayerViewGame['teamA']) => <div style={{display:'flex',justifyContent:'center',flexWrap:'wrap',gap:'4px 8px'}}>{person(players[0])}<span aria-hidden="true" style={{color:C.textMuted}}>·</span>{person(players[1])}</div>;
  return <article aria-label={`${game.status==='current'?'Current':game.status==='planned'?'Planned':'Played'} game · Slot ${game.slot} · Court ${game.court}`} style={{background:C.card,border:`1px solid ${game.status==='current'?C.accentDim:C.border}`,borderRadius:10,padding:16,minWidth:0}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12,fontSize:12,color:C.textDim}}>
      <strong style={{color:game.status==='current'?C.green:C.textDim}}>{game.status==='current'?'Current court lineup':game.status==='planned'?'Planned':'Played'} · Court {game.court}</strong>
      <span>Slot {game.slot}</span>
    </div>
    {team(game.teamA)}<div style={{textAlign:'center',color:C.textMuted,fontSize:11,margin:'6px 0'}}>VS</div>{team(game.teamB)}
    <div style={{marginTop:12,fontSize:12,color:C.textDim,display:'flex',flexWrap:'wrap',gap:12}}>
      {game.status==='current'&&<CourtElapsedTime startedAt={game.startedAt} />}
      {game.status==='planned'&&game.timeLabel&&<span>{game.timeLabel}</span>}
      {game.status==='played'&&game.durationMs!=null&&<span>Played {formatPlayingDuration(game.durationMs)}</span>}
      {game.status==='played'&&game.score&&<strong style={{color:C.text}}>Score {game.score.a}–{game.score.b}</strong>}
    </div>
  </article>;
}

export default function PlayerSessionViewer({shareId}:{shareId:string|null}) {
  const session=usePlayerSession(shareId);
  const [selectedId,setSelectedId]=useState(()=>readSelection(shareId));
  const [tab,setTab]=useState<'all'|'mine'>(()=>readSelection(shareId)?'mine':'all');
  const [search,setSearch]=useState('');
  useEffect(()=>{const selected=readSelection(shareId);setSelectedId(selected);setTab(selected?'mine':'all');setSearch('');},[shareId]);
  const model=useMemo(()=>{
    if(!session.data)return null;
    try{return playerViewModel(session.data);}catch{return null;}
  },[session.data]);
  const selected=model?.players.find(player=>player.id===selectedId&&player.selectable);
  const choose=(id:string)=>{
    const player=model?.players.find(candidate=>candidate.id===id&&candidate.selectable);
    setSelectedId(player?.id??'');setTab(player?'mine':'all');
    try {if(player?.persistent)localStorage.setItem(preferenceKey(shareId),player.id);else localStorage.removeItem(preferenceKey(shareId));}catch{/* Viewing still works when browser storage is blocked. */}
  };
  const visible=(games:PlayerViewGame[])=>tab==='all'?games:!selected?[]:games.filter(game=>[...game.teamA,...game.teamB].some(player=>player.id===selected.id));
  const current=visible(model?.current??[]),upcoming=visible(model?.upcoming??[]),played=visible(model?.played??[]);
  const hasSelection=tab==='all'||!!selected;
  const terminal=['not_found','expired','invalid'].includes(session.status)||!!(session.data&&!model);
  const displayStatus=session.data&&!model?'This player link could not be read':!shareId?'This player link could not be read'
    :!model&&session.status==='offline'?'Offline — connect to load this session'
    :!model&&session.status==='error'?'Could not load this session':statusText[session.status];
  const cards=(games:PlayerViewGame[])=><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:12}}>{games.map(game=><PlayerGameCard key={game.key} game={game} selectedId={selected?.id??''} />)}</div>;
  return <main aria-label="Player session viewer" style={{background:C.bg,minHeight:'100vh',color:C.text,fontFamily:FONT,padding:'24px 16px',boxSizing:'border-box'}}>
    <div style={{maxWidth:1000,margin:'0 auto'}}>
      <header style={{marginBottom:20}}><h1 style={{fontSize:24,margin:'0 0 6px'}}>Match Planner</h1><strong style={{color:C.accent,fontSize:14}}>Player view · live session</strong><p style={{color:C.textDim,fontSize:13,margin:'6px 0'}}>See the session and find your games. Game changes are managed by the organizer.</p></header>
      <section aria-label="Player connection" role={terminal||session.status==='error'?'alert':'status'} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:16}}>
        <strong style={{color:session.status==='live'&&!terminal?C.green:C.amber,fontSize:13}}>{displayStatus}</strong>
        {session.message&&<p style={{fontSize:12,color:C.textDim,margin:'6px 0'}}>{session.message}</p>}
        {session.receivedAt!=null&&model&&<p style={{fontSize:11,color:C.textDim,margin:'6px 0'}}>Last received {new Date(session.receivedAt).toLocaleTimeString()}{session.data?.revision!=null?` · revision ${session.data.revision}`:''}</p>}
        {session.status!=='live'&&session.status!=='loading'&&shareId&&<button onClick={session.retry} style={{...buttonStyle,marginTop:8}}>Retry connection</button>}
        {terminal&&<p style={{fontSize:13,color:C.textDim}}>Ask the organizer for a current player link.</p>}
      </section>
      {model&&!terminal&&<>
        <section aria-label="Find your games" style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:16,marginBottom:16}}>
          <h2 style={{fontSize:16,margin:'0 0 12px'}}>Find your games</h2>
          <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
            <label style={{flex:'1 1 180px',fontSize:12,color:C.textDim}}>Find a player<input aria-label="Find a player" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search names" style={{display:'block',boxSizing:'border-box',width:'100%',minHeight:44,marginTop:6,padding:'10px 12px',background:C.bg,color:C.text,border:`1px solid ${C.border}`,borderRadius:8,fontFamily:FONT}} /></label>
            <label style={{flex:'1 1 220px',fontSize:12,color:C.textDim}}>Choose your name<select aria-label="Choose your name" value={selected?.id??''} onChange={event=>choose(event.target.value)} style={{display:'block',width:'100%',minHeight:44,marginTop:6,padding:'10px 12px',background:C.bg,color:C.text,border:`1px solid ${C.accentDim}`,borderRadius:8,fontFamily:FONT}}>
              <option value="">Choose a player</option>{model.players.filter(player=>player.id===selected?.id||player.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(player=><option key={player.id} value={player.id} disabled={!player.selectable}>{player.name}{!player.active?' · no longer active':''}{!player.selectable?' · identity unavailable':''}</option>)}
            </select></label>
          </div>
          {selectedId&&!selected&&<p style={{color:C.amber,fontSize:13}}>Your selected player is no longer listed. Choose your name again.</p>}
          {selected&&!selected.active&&<p style={{color:C.amber,fontSize:13}}>You are no longer active in this session. Your recorded games remain available below.</p>}
          {model.players.some(player=>!player.persistent)&&(!session.data?.ids||(selected&&!selected.persistent))&&<p style={{color:C.textDim,fontSize:12,marginTop:12,lineHeight:1.5}}>Some names have limited identity information. Temporary selections are not remembered; ask the organizer to republish if your name cannot be selected.</p>}
          {!model.players.length&&<p style={{color:C.textDim}}>No players have been published yet.</p>}
        </section>
        <nav role="tablist" aria-label="Player schedule" style={{display:'flex',gap:8,marginBottom:16}}>{([{id:'all',label:'All games'},{id:'mine',label:'My games'}] as const).map(item=><button key={item.id} role="tab" aria-selected={tab===item.id} onClick={()=>setTab(item.id)} style={{...buttonStyle,background:tab===item.id?C.accentDim:C.card,fontWeight:700}}>{item.label}</button>)}</nav>
        <p style={{color:C.textDim,fontSize:13,margin:'0 0 20px',lineHeight:1.5}}>Future games are tentative. Lineups, courts and approximate times may change as the organizer updates the session.</p>
        {tab==='mine'&&!selected?<p style={{color:C.textDim}}>Choose your name above to see your games.</p>:<>
          {!model.current.length&&!model.upcoming.length&&!model.played.length&&<p style={{color:C.textDim}}>The organizer has not published games yet.</p>}
          <section aria-label="Current games" style={{marginBottom:24}}><h2 style={{fontSize:17,margin:'0 0 12px'}}>{tab==='mine'?'Your current game':'Current courts'}</h2>{current.length?cards(current):<p style={{color:C.textDim,fontSize:13}}>{tab==='mine'?'You are not on court in the current lineup.':'No current court lineups.'}</p>}</section>
          <section aria-label="Planned games" style={{marginBottom:24}}><h2 style={{fontSize:17,margin:'0 0 12px'}}>{tab==='mine'?'Your planned games':'Planned games'}</h2>{upcoming.length?cards(upcoming):<p style={{color:C.textDim,fontSize:13}}>{tab==='mine'?'No upcoming games are currently assigned to you.':'No upcoming games have been published.'}</p>}</section>
          <details style={{marginBottom:24}}><summary style={{cursor:'pointer',minHeight:44,fontWeight:700}}>Played games ({played.length})</summary><section aria-label="Played games">{played.length?cards(played):<p style={{color:C.textDim}}>No recorded games yet.</p>}</section></details>
        </>}
        {hasSelection&&<p style={{fontSize:12,color:C.textMuted}}>This player view updates from the organizer’s shared session.</p>}
      </>}
    </div>
  </main>;
}
