import type { Court, Player, ScheduleState, SlotResult } from '../algorithm/types';
import type { PlannerResult, ScoresMap } from '../types';
import type { GameRef } from './liveQueue';

export interface PlayedPlayer { id: string; name: string; gender: 'M' | 'F' }
export interface PlayedGame {
  id: string;
  planId: string;
  slot: number;
  court: number;
  displayCourt?: number;
  completedAt: number;
  teamA: [PlayedPlayer, PlayedPlayer];
  teamB: [PlayedPlayer, PlayedPlayer];
  score?: { a: string; b: string; applied: boolean };
  waitingIds: string[];
}
const identity = (player: {id?: string; name: string}) => player.id || `legacy:${player.name.trim().toLowerCase()}`;
/** Only name-derived historical IDs may fall back to names; permanent IDs never merge by name. */
const matchesPlayer = (record: PlayedPlayer, player: Player) => record.id === identity(player) ||
  (record.id.startsWith('legacy:') && [player.name,...(player.aliases ?? [])].some(name =>
    `legacy:${name.trim().toLowerCase()}` === record.id));
const participants = (game: PlayedGame) => [...game.teamA, ...game.teamB];
const provenance = (game: PlayedGame) => JSON.stringify([game.planId,game.slot,participants(game).map(p=>p.id).sort()]);
const copyGame = (game: PlayedGame): PlayedGame => ({
  ...game, teamA: game.teamA.map(p=>({id:p.id,name:p.name,gender:p.gender})) as PlayedGame['teamA'],
  teamB: game.teamB.map(p=>({id:p.id,name:p.name,gender:p.gender})) as PlayedGame['teamB'],
  waitingIds:[...game.waitingIds], ...(game.score ? {score:{...game.score}} : {}),
});

/** Existing snapshots win: migration must never reinterpret an already recorded game. */
export function mergePlayedGames(existing: PlayedGame[], records: PlayedGame[]): PlayedGame[] {
  const ids = new Set<string>(), sources = new Set<string>();
  return [...existing,...records].filter(game=>{
    const key=provenance(game);
    if(ids.has(game.id)||sources.has(key)) return false;
    ids.add(game.id); sources.add(key); return true;
  }).map(copyGame);
}

export function makePlayedGame(
  result: (PlannerResult & {planId?:string}) | null, players: Player[], ref: GameRef, scores: ScoresMap,
  liveBefore: GameRef[] = [], completedAt = Date.now(),
): PlayedGame | null {
  const court=result?.schedule.find(slot=>slot.slot===ref.slot)?.courts[ref.court];
  if(!result||!court) return null;
  const original=[...court.teamA,...court.teamB];
  const names=ref.players?.length===4 ? ref.players : original.map(p=>p.name);
  const lineup=names.map(name=>{
    const snapshot=original.find(p=>p.name===name);
    const roster=players.find(p=>p.name===name||p.aliases?.includes(name));
    const player=snapshot ?? roster ?? {name,gender:'M' as const};
    return {id:player.id || roster?.id || identity(player),name,gender:player.gender};
  });
  if(new Set(lineup.map(p=>p.id)).size!==4) return null;
  const planId=result.planId || 'legacy';
  const busy=new Set([...lineup.map(p=>p.id),...liveBefore.flatMap(game=>{
    const scheduled=result.schedule.find(slot=>slot.slot===game.slot)?.courts[game.court];
    return (game.players ?? (scheduled?[...scheduled.teamA,...scheduled.teamB].map(p=>p.name):[]))
      .map(name=>identity(players.find(p=>p.name===name||p.aliases?.includes(name)) ?? {name}));
  })]);
  const score=scores[`s${ref.slot}c${ref.court}`];
  return {
    id: ref.id || JSON.stringify([planId,ref.slot,ref.court,lineup.map(p=>p.id)]), planId,
    slot:ref.slot,court:ref.court,...(ref.displayCourt!=null?{displayCourt:ref.displayCourt}:{}),completedAt,
    teamA:[lineup[0]!,lineup[1]!],teamB:[lineup[2]!,lineup[3]!],
    ...(score?{score:{a:score.a,b:score.b,applied:score.applied}}:{}),
    waitingIds:players.filter(p=>!p.quarantined && p.availFrom<=ref.slot-1 && p.availTo>=ref.slot-1 &&
      (p.leavesAt==null||p.leavesAt>=ref.slot-1) && !busy.has(identity(p))).map(identity),
  };
}

export function migratePlayedGames(
  result: (PlannerResult & {planId?:string}) | null, players: Player[], completed: GameRef[], scores: ScoresMap, existing: PlayedGame[]=[],
): PlayedGame[] {
  const records=completed.flatMap((ref,index)=>{
    const record=makePlayedGame(result,players,ref,scores,[],index);
    return record?[record]:[];
  });
  return mergePlayedGames(existing,records);
}

export function historyCourts(history: PlayedGame[]): Court[] {
  return mergePlayedGames([],history).map(game=>({
    court:(game.displayCourt ?? game.court)+1,
    teamA:game.teamA.map(p=>({...p})) as Court['teamA'],teamB:game.teamB.map(p=>({...p})) as Court['teamB'],
  }));
}

/** Values are keyed by current public name for the board; records always retain permanent IDs. */
export function historyGamesWaited(history: PlayedGame[], players: Player[], live: GameRef[]=[]): Record<string,number> {
  const waited: Record<string,number> = Object.fromEntries(players.map(player=>[player.name,0]));
  for(const game of mergePlayedGames([],history)) for(const player of players) {
    if(participants(game).some(record=>matchesPlayer(record,player))) waited[player.name]=0;
    else if(game.waitingIds.some(id=>matchesPlayer({id,name:'',gender:'M'},player))) waited[player.name]!++;
  }
  for(const game of live) for(const name of game.players ?? []) {
    const player=players.find(p=>p.name===name||p.aliases?.includes(name));
    if(player) waited[player.name]=0;
  }
  return waited;
}

export function historyScheduleState(history: PlayedGame[], players: Player[], keptSlots: SlotResult[]=[]): ScheduleState {
  const n=players.length, zeros=()=>Array<number>(n).fill(0);
  const state:ScheduleState={keptSlots,gamesPlayed:zeros(),consecutivePlayed:zeros(),consecutiveRested:zeros(),
    partnerCount:Array.from({length:n},zeros),opponentCount:Array.from({length:n},zeros),courtGroupHistory:new Set(),womenDoublesCount:0};
  const indices=new Map(players.map((player,index)=>[identity(player),index]));
  const indexFor=(record:PlayedPlayer) => indices.get(record.id) ?? (
    record.id.startsWith('legacy:') ? players.findIndex(player=>matchesPlayer(record,player)) : -1);
  const rounds=new Map<string,{planId:string;slot:number;played:Set<number>;waited:Set<number>}>();
  const planOrder=new Map<string,number>();
  for(const game of mergePlayedGames([],history)){
    const group=participants(game).map(player=>((index)=>index!=null&&index>=0?index:undefined)(indexFor(player)));
    group.forEach(index=>{if(index!=null) state.gamesPlayed[index]!++;});
    const pair=(a:number|undefined,b:number|undefined,matrix:number[][])=>{
      if(a!=null&&b!=null){matrix[a]![b]!++;matrix[b]![a]!++;}
    };
    pair(group[0],group[1],state.partnerCount); pair(group[2],group[3],state.partnerCount);
    for(const a of group.slice(0,2)) for(const b of group.slice(2)) pair(a,b,state.opponentCount);
    if(group.every((i):i is number=>i!=null)) state.courtGroupHistory.add([...group].sort((a,b)=>a-b).join(','));
    if(participants(game).every(p=>p.gender==='F')) state.womenDoublesCount++;
    const key=JSON.stringify([game.planId,game.slot]);
    if(!planOrder.has(game.planId)) planOrder.set(game.planId,planOrder.size);
    const round=rounds.get(key) ?? {planId:game.planId,slot:game.slot,played:new Set<number>(),waited:new Set<number>()};
    group.forEach(i=>{if(i!=null)round.played.add(i);});
    game.waitingIds.forEach(id=>{const i=indexFor({id,name:"",gender:"M"});if(i!=null&&i>=0)round.waited.add(i);});
    rounds.set(key,round);
  }
  for(const round of [...rounds.values()].sort((a,b)=>planOrder.get(a.planId)!-planOrder.get(b.planId)! || a.slot-b.slot)) for(let i=0;i<n;i++){
    if(round.played.has(i)) state.consecutivePlayed[i]!++;
    else state.consecutivePlayed[i]=0;
  }
  // Selection priority uses eligible completed-game events in actual completion
  // order. Only consecutive play is a logical-round constraint: grouping waits
  // by slot undercredits multi-court finishes and reverses asynchronous resets.
  const waited = historyGamesWaited(history, players);
  state.consecutiveRested = players.map(player => waited[player.name] ?? 0);
  return state;
}

export function remainingCourtsPerSlot(history: PlayedGame[], nominal:number[]):number[] {
  const remaining=nominal.map(n=>Math.max(0,n));
  for(const game of mergePlayedGames([],history)) if(game.slot>=1&&game.slot<=remaining.length)
    remaining[game.slot-1]=Math.max(0,remaining[game.slot-1]!-1);
  return remaining;
}
