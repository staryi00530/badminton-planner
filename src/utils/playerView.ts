import type { SharePayload } from '../types';
import type { PlayedPlayer } from './playedHistory';
import { mergePlayedGames, migratePlayedGames } from './playedHistory';
import { reconstructScheduleFromSharePayload } from './sharePayload';
import { formatSlotTime } from './slotTime';

export interface PlayerViewPerson { id: string; name: string }
export interface PlayerViewPlayer extends PlayerViewPerson { persistent: boolean; active: boolean; selectable: boolean }
export interface PlayerViewGame {
  key: string; slot: number; court: number;
  teamA: [PlayerViewPerson, PlayerViewPerson]; teamB: [PlayerViewPerson, PlayerViewPerson];
  status: 'current' | 'planned' | 'played'; score?: { a: string; b: string }; timeLabel?: string;
  startedAt?: number; completedAt?: number; durationMs?: number;
}
export interface PlayerViewModel {
  players: PlayerViewPlayer[]; current: PlayerViewGame[]; upcoming: PlayerViewGame[]; played: PlayerViewGame[];
  numCourts: number; gameMinutes: number; sessionStart: string;
}

const safeShareId = (id: string | null): id is string => !!id && /^[-_A-Za-z0-9]{1,128}$/.test(id);
export function playerShareId(search: string): string | null {
  const query = new URLSearchParams(search), id = query.get('share');
  return query.get('view') === 'players' && safeShareId(id) ? id : null;
}
export function playerViewUrl(organizerUrl: string): string {
  const url = new URL(organizerUrl);
  if (!['https:','http:'].includes(url.protocol) || !safeShareId(url.searchParams.get('share'))) throw new Error('A valid shared session is required for a player link');
  url.searchParams.set('view', 'players'); url.hash = '';
  return url.toString();
}

const canonical = (name: string) => name.trim().toLocaleLowerCase();
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const score = (value: {a:string;b:string;applied?:boolean} | undefined) => value && value.applied !== false
  && typeof value.a === 'string' && typeof value.b === 'string' && value.a !== '' && value.b !== '' ? {a:value.a,b:value.b} : undefined;

/** Public presentation only: never hydrates planner storage or exposes private metadata. */
export function playerViewModel(data: SharePayload): PlayerViewModel {
  if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('Invalid shared schedule');
  // RTDB removes empty array children. Only a recognized modern session with
  // valid configuration may interpret those missing children as an empty plan.
  const cfg=data.cfg;
  const knownSession=data.v===1&&data.schema===3&&!!cfg&&typeof cfg==='object'&&!Array.isArray(cfg)
    &&typeof cfg.g==='number'&&Number.isFinite(cfg.g)&&cfg.g>0&&Number.isInteger(cfg.c)&&cfg.c!>=1&&cfg.c!<=5;
  if(data.slots==null){
    if(!knownSession)throw new Error('Invalid shared schedule');
    data={...data,slots:[]};
  }
  if(data.p==null){
    if(!knownSession||!Array.isArray(data.slots)||data.slots.length!==0)throw new Error('Invalid shared schedule');
    data={...data,p:[]};
  }
  const decoded = reconstructScheduleFromSharePayload(data, {currentGameMinutes:15,currentNumCourts:1});
  const slotNumbers = new Set<number>();
  for (const slot of data.slots) {
    if (slot.s < 1 || slotNumbers.has(slot.s)) throw new Error('Invalid shared schedule');
    slotNumbers.add(slot.s);
  }
  const nameCounts = new Map<string,number>();
  for (const [name] of data.p) nameCounts.set(canonical(name),(nameCounts.get(canonical(name)) ?? 0)+1);
  const active = new Set(data.active ?? data.p.map((_,index)=>index));
  const players:PlayerViewPlayer[] = data.p.map(([name],index)=>({
    id:data.ids?.[index] ?? (nameCounts.get(canonical(name)) === 1 ? `legacy:${canonical(name)}` : `ambiguous:${index}:${encodeURIComponent(name)}`),
    name,persistent:!!data.ids,active:active.has(index),selectable:!!data.ids || nameCounts.get(canonical(name)) === 1,
  }));
  const personAt = (index:number):PlayerViewPerson => ({id:players[index]!.id,name:players[index]!.name});
  for(const slot of data.slots)for(const teams of slot.c ?? []){
    if(new Set(teams.flat().map(index=>personAt(index).id)).size!==4)throw new Error('Invalid shared planned lineup');
  }
  const rosterPlayers=[...players];
  const byId = new Map(players.map(player=>[player.id,player]));
  const historicalIds=new Map<string,PlayerViewPlayer>();
  const historyPerson = (record:PlayedPlayer):PlayerViewPerson => {
    let player=byId.get(record.id) ?? historicalIds.get(record.id);
    if (!player && record.id.startsWith('legacy:')) {
      const matches=rosterPlayers.filter(p=>canonical(p.name)===canonical(record.name));
      if(matches.length===1 && matches[0]!.selectable) player=matches[0];
    }
    if (!player) {
      const ambiguous=record.id.startsWith('legacy:') && (nameCounts.get(canonical(record.name)) ?? 0)>1;
      const id=ambiguous ? `history:${record.id}` : record.id;
      player=byId.get(id);
      if(!player){
        player={id,name:record.name,persistent:!record.id.startsWith('legacy:'),active:false,selectable:!ambiguous};
        players.push(player);byId.set(id,player);
      }
    }
    historicalIds.set(record.id,player);
    return {id:player.id,name:record.name};
  };
  const fullRoster=data.p.map(([name,gender],index)=>({id:players[index]!.id,name,gender:gender==='F'?'F' as const:'M' as const,availFrom:0,availTo:Math.max(0,data.slots.length-1)}));
  const recorded=mergePlayedGames([],decoded.playedGames);
  // Completed refs may intentionally keep an old name after the roster is renamed.
  // An immutable ledger record already captured that game's IDs; remigrating its
  // names against today's roster would invent a second legacy identity/game.
  const uncaptured=decoded.completedGames.filter(ref=>{
    const indices=data.slots.find(slot=>slot.s===ref.slot)?.c?.[ref.court]?.flat() ?? [];
    const ids=indices.map(index=>personAt(index).id).sort();
    return !recorded.some(game=>(!!ref.id&&game.id===ref.id) || (game.planId===(data.planId ?? 'legacy')&&game.slot===ref.slot
      && (game.court===ref.court || (ids.length===4&&[...game.teamA,...game.teamB].map(player=>player.id).sort().every((id,index)=>id===ids[index])))));
  });
  const history=mergePlayedGames([],migratePlayedGames(decoded.result,fullRoster,uncaptured,decoded.scores,recorded));
  const played:PlayerViewGame[]=history.map(game=>({
    key:`played:${game.id}`,slot:game.slot,court:(game.displayCourt ?? game.court)+1,
    teamA:game.teamA.map(historyPerson) as PlayerViewGame['teamA'],teamB:game.teamB.map(historyPerson) as PlayerViewGame['teamB'],status:'played',
    ...(score(game.score)?{score:score(game.score)}:{}),...(time(game.startedAt)?{startedAt:game.startedAt}:{}),
    completedAt:game.completedAt,...(time(game.durationMs)?{durationMs:game.durationMs}:{}),
  }));
  const completed=new Set(decoded.completedGames.map(game=>`${game.slot}:${game.court}`));
  const current:PlayerViewGame[]=[];
  const liveKeys=new Set<string>();
  for(const ref of decoded.liveGames){
    const key=`${ref.slot}:${ref.court}`;
    if(liveKeys.has(key))continue;
    liveKeys.add(key);
    const slot=data.slots.find(slot=>slot.s===ref.slot)!;
    const indices=slot.c![ref.court]!.flat();
    const original=indices.map(personAt);
    if(ref.players !== undefined && (!Array.isArray(ref.players)||ref.players.length!==4||ref.players.some(name=>typeof name!=='string'))) throw new Error('Invalid shared live lineup');
    const names=ref.players?.length===4?ref.players:original.map(p=>p.name);
    const unchanged=names.every((name,index)=>name===original[index]!.name);
    const lineup=names.map((name,index)=>{
      if(unchanged)return original[index]!;
      const matches=rosterPlayers.filter(player=>player.name===name);
      if(matches.length===1 && matches[0]!.selectable)return {id:matches[0]!.id,name};
      const person={id:`unresolved:${ref.slot}:${ref.court}:${index}:${encodeURIComponent(name)}`,name};
      if(!byId.has(person.id)){
        const option={...person,persistent:false,active:false,selectable:matches.length===0};
        players.push(option);byId.set(person.id,option);
      }
      return person;
    });
    if(new Set(lineup.map(player=>player.id)).size!==4)throw new Error('Invalid shared live lineup');
    current.push({key:`current:${key}`,slot:ref.slot,court:Number.isInteger(ref.displayCourt)&&ref.displayCourt!>=0&&ref.displayCourt!<5?ref.displayCourt!+1:ref.court+1,
      teamA:[lineup[0]!,lineup[1]!],teamB:[lineup[2]!,lineup[3]!],status:'current',...(time(ref.startedAt)?{startedAt:ref.startedAt}:{})});
  }
  const gameMinutes=typeof decoded.gameMinutes==='number'&&Number.isFinite(decoded.gameMinutes)&&decoded.gameMinutes>0?decoded.gameMinutes:15;
  const sessionStart=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(decoded.sessionStart)?decoded.sessionStart:'';
  const upcoming:PlayerViewGame[]=[];
  for(const slot of [...data.slots].sort((a,b)=>a.s-b.s))for(const [court,teams] of (slot.c ?? []).entries()){
    const key=`${slot.s}:${court}`;
    if(liveKeys.has(key)||completed.has(key))continue;
    const teamA=teams[0]!.map(personAt) as PlayerViewGame['teamA'],teamB=teams[1]!.map(personAt) as PlayerViewGame['teamB'];
    const ids=[...teamA,...teamB].map(p=>p.id).sort();
    if(history.some(game=>game.planId===(data.planId ?? 'legacy')&&game.slot===slot.s
      && [...game.teamA,...game.teamB].map(p=>historyPerson(p).id).sort().every((id,index)=>id===ids[index])))continue;
    upcoming.push({key:`planned:${key}`,slot:slot.s,court:court+1,teamA,teamB,status:'planned',timeLabel:`Planned approx. ${formatSlotTime(slot.s,{gameMinutes,sessionStart})}`});
  }
  current.sort((a,b)=>a.court-b.court || a.slot-b.slot);
  players.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const numCourts=Number.isInteger(decoded.numCourts)&&decoded.numCourts>=1&&decoded.numCourts<=5?decoded.numCourts:Math.max(1,...data.slots.map(slot=>slot.c?.length ?? 0));
  return {players,current,upcoming,played,numCourts,gameMinutes,sessionStart};
}
