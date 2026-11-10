import { describe, expect, it } from 'vitest';
import { makePlayedGame, migratePlayedGames, mergePlayedGames, remainingCourtsPerSlot, historyScheduleState, historyGamesWaited, historySlotsWaited, historyCourts } from './playedHistory';
import type { Player } from '../algorithm/types';
import { publicPlayedGames } from './playedHistoryCodec';
import { applySharedAction, sharedGameId, commitSharedSnapshot } from './sharedSession';
import type { SharePayload } from '../types';
const players: Player[] = ['A','B','C','D','E','F'].map((name,i)=>({id:name,name,gender:i%2?'F':'M',availFrom:0,availTo:10}));
const result = {planId:'p1',schedule:[{slot:1,courts:[{court:1,teamA:[players[0]!,players[1]!] as [Player,Player],teamB:[players[2]!,players[3]!] as [Player,Player]}],sitting:players.slice(4),playerState:[],repeatedCourts:[]}],gamesPlayed:[]};
it('counts a waiting slot once across courts and recovery plans, and excludes unavailable slots',()=>{
 const base=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 const history=[base,{...base,id:'court2',court:1,teamA:[{...base.teamA[1],id:'guest',name:'Guest'},base.teamA[0]] as typeof base.teamA},
  {...base,id:'recovery',planId:'recovery'}, {...base,id:'next',slot:2}, {...base,id:'absent',slot:3,waitingIds:[]}];
 expect(historySlotsWaited(history,players).E).toBe(2);
 expect(historyGamesWaited(history,players).E).toBe(4);
 expect(historySlotsWaited(history,players,[{slot:4,court:0,players:['E']}]).E).toBe(0);
});
it('resets slot waits after playing and never credits late finishes from played or earlier slots',()=>{
 const base=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 const play={...base,id:'play',slot:2,teamA:[{id:'E',name:'E',gender:'M' as const},base.teamA[1]] as typeof base.teamA};
 const history=[base,play,{...base,id:'late-same-slot',slot:2},{...base,id:'late-older-slot',slot:1}, {...base,id:'future',slot:3}];
 const renamed=players.map(p=>p.id==='E'?{...p,name:'Renamed'}:p);
 expect(historySlotsWaited(history,renamed).Renamed).toBe(1);
 expect(historySlotsWaited(history.slice(0,-1),renamed).Renamed).toBe(0);
 expect(historySlotsWaited(history.filter(g=>g.id!=='play'),renamed).Renamed).toBe(3);
});
describe('played history',()=>{
 it('records actual elapsed play from the matching live game before the completion ref',()=>{
  const game=makePlayedGame(result,players,{slot:1,court:0,startedAt:200},{},[{slot:1,court:0,players:['A','B','C','D'],startedAt:100}],1100)!;
  expect(game).toMatchObject({startedAt:100,durationMs:1000,completedAt:1100});
  expect(publicPlayedGames([game])[0]).toMatchObject({startedAt:100,durationMs:1000});
 });
 it('uses a captured ref start and rejects stale-lineup live clocks and invalid starts',()=>{
  const game=makePlayedGame(result,players,{slot:1,court:0,startedAt:200},{},[{slot:1,court:0,players:['A','B','E','F'],startedAt:100}],1100)!;
  expect(game).toMatchObject({startedAt:200,durationMs:900});
  for(const startedAt of [undefined,NaN,Infinity,-1,0.5,1101,Number.MAX_SAFE_INTEGER+1]) {
   const unknown=makePlayedGame(result,players,{slot:1,court:0,startedAt},{},[],1100)!;
   expect(unknown).not.toHaveProperty('startedAt');
   expect(unknown).not.toHaveProperty('durationMs');
  }
  expect(makePlayedGame(result,players,{slot:1,court:0,startedAt:1100},{},[],1100)).toMatchObject({startedAt:1100,durationMs:0});
 });
 it('preserves timing and unknown legacy snapshots across migration, score changes and copies',()=>{
  const known=makePlayedGame(result,players,{slot:1,court:0,startedAt:100},{},[],1100)!;
  const changed={...known,startedAt:200,durationMs:900};
  expect(mergePlayedGames([known],[changed])[0]).toMatchObject({startedAt:100,durationMs:1000});
  const legacy=makePlayedGame(result,players,{slot:1,court:0},{},[],0)!;
  expect(mergePlayedGames([legacy],[known])[0]).not.toHaveProperty('durationMs');
  expect(migratePlayedGames(result,players,[{slot:1,court:0,startedAt:100}],{},[known])[0]).toMatchObject({startedAt:100,durationMs:1000});
  expect(migratePlayedGames(result,players,[{slot:1,court:0,startedAt:100}],{},[legacy])[0]).not.toHaveProperty('durationMs');
  expect(migratePlayedGames(result,players,[{slot:1,court:0,startedAt:0}],{})[0]).not.toHaveProperty('durationMs');
 });
 it('validates and whitelists paired actual timing while allowing legacy records',()=>{
  const legacy=makePlayedGame(result,players,{slot:1,court:0},{},[],1100)!;
  expect(publicPlayedGames([legacy])[0]).not.toHaveProperty('durationMs');
  for(const timing of [{startedAt:100},{durationMs:1000},{startedAt:100,durationMs:900},{startedAt:-1,durationMs:1101},{startedAt:1101,durationMs:-1},{startedAt:0.5,durationMs:1099.5},{startedAt:NaN,durationMs:1000}])
   expect(()=>publicPlayedGames([{...legacy,...timing}])).toThrow('Invalid played-game history');
  expect(publicPlayedGames([{...legacy,startedAt:100,durationMs:1000,privateThing:'drop'}])[0]).toEqual({...legacy,startedAt:100,durationMs:1000});
 });
 it('shared Finish records timing once, Undo removes it and stale snapshots cannot change it',()=>{
  const base: SharePayload={v:1,planId:'shared',p:players.map(p=>[p.name,p.gender]),ids:players.map(p=>p.id!),
   slots:[{s:1,c:[[[0,1],[2,3]]],sit:[4,5]}],runtime:{live:[{slot:1,court:0,startedAt:100}],completed:[]},history:[],historyEpoch:0};
  const finished=applySharedAction(base,{type:'finish',id:'finish',gameId:sharedGameId(base,1,0),at:1100})!;
  expect(finished.history![0]).toMatchObject({startedAt:100,durationMs:1000});
  const stale={...finished,history:[{...finished.history![0]!,startedAt:200,durationMs:900}]};
  expect(commitSharedSnapshot(finished,finished.revision!,stale)?.history![0]).toMatchObject({startedAt:100,durationMs:1000});
  const undone=applySharedAction(finished,{type:'undo',id:'undo',target:'finish',at:1200})!;
  expect(undone.history).toEqual([]);
  expect(undone.runtime!.live![0]!.startedAt).toBe(100);
 });
 it('snapshots public identity and score and deduplicates migration',()=>{
 const scores={s1c0:{a:'21',b:'15',applied:true,teamA:['A','B'],teamB:['C','D']}};
 const history=migratePlayedGames(result,players,[{slot:1,court:0}],scores);
 scores.s1c0.a='0';
 expect(history[0]?.score?.a).toBe('21');
 expect(Object.keys(history[0]!.teamA[0]!)).toEqual(['id','name','gender']);
 expect(migratePlayedGames(result,players,[{slot:1,court:0}],scores,history)).toHaveLength(1);
 expect(mergePlayedGames(history,[{...history[0]!,id:'other'}])).toHaveLength(1);
 });
 it('keeps event waits, excludes live players and seeds renamed IDs exactly once',()=>{
 const game=makePlayedGame(result,players,{slot:1,court:0},{},[{slot:2,court:0,players:['E']}],1)!;
 expect(game.waitingIds).toEqual(['F']);
 expect(historyGamesWaited([game],players)).toMatchObject({E:0,F:1});
 const renamed=players.map(p=>p.id==='A'?{...p,name:'Renamed'}:p);
 const state=historyScheduleState([game],renamed);
 expect(state.gamesPlayed).toEqual([1,1,1,1,0,0]);
 expect(state.partnerCount[0]![1]).toBe(1);
 expect(state.opponentCount[0]![2]).toBe(1);
 expect(state.consecutivePlayed).toEqual([1,1,1,1,0,0]);
 });
 it('consumes partial logical-slot budget across plans without duplicates',()=>{
 const game=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 expect(remainingCourtsPerSlot([game,{...game,id:'p2game',planId:'p2',court:1}], [5,5])).toEqual([3,5]);
 expect(remainingCourtsPerSlot([game,game],[1])).toEqual([0]);
 });
});

it('deduplicates renumbered courts, preserves distinct plans and resets event waits after playing',()=>{
 const game=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 expect(mergePlayedGames([game],[{...game,id:'shifted',court:3}])).toHaveLength(1);
 expect(mergePlayedGames([game],[{...game,id:'otherPlan',planId:'p2'}])).toHaveLength(2);
 const waiting={...game,id:'wait',planId:'p0',waitingIds:['A'],teamA:[game.teamB[0],game.teamB[1]] as typeof game.teamA,teamB:[{id:'E',name:'E',gender:'M' as const},{id:'F',name:'F',gender:'F' as const}] as typeof game.teamB};
 expect(historyGamesWaited([waiting,game],players).A).toBe(0);
});
it('matches legacy fallback IDs to returned permanent identities without changing snapshots',()=>{
 const game=makePlayedGame({...result,planId:undefined},players.map(p=>({...p,id:undefined})),{slot:1,court:0},{},[],1)!;
 const renamed=players.map(p=>p.name==='A'?{...p,name:'Renamed',aliases:['A']}:p);
 expect(historyScheduleState([game],renamed).gamesPlayed).toEqual([1,1,1,1,0,0]);
 expect(game.teamA[0].name).toBe('A');
});
it('counts consecutive rotation by logical round even when completion order crosses slots',()=>{
 const game=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 const later={...game,id:'later',slot:2,teamA:[{id:'E',name:'E',gender:'M' as const},game.teamA[1]] as typeof game.teamA,waitingIds:['A','F']};
 const state=historyScheduleState([later,game],players);
 expect(state.consecutivePlayed[0]).toBe(0);
 expect(state.consecutiveRested[0]).toBe(0);
 expect(state.consecutivePlayed[1]).toBe(2);
});

it('seeds wait priority per eligible completion event across asynchronous courts and slots',()=>{
 const roster:Player[]=['A','B','C','D','E','F','G','H','W','Busy'].map(name=>({id:name,name,gender:'M',availFrom:0,availTo:9}));
 const snapshot=(name:string)=>({id:name,name,gender:'M' as const});
 const base=makePlayedGame(result,players,{slot:1,court:0},{},[],1)!;
 const first={...base,id:'first',slot:2,court:0,waitingIds:['W','A'],teamA:[snapshot('E'),snapshot('F')] as typeof base.teamA,teamB:[snapshot('G'),snapshot('H')] as typeof base.teamB};
 const second={...base,id:'second',slot:1,court:1,waitingIds:['W'],completedAt:2};
 const third={...first,id:'third',slot:1,court:2,waitingIds:['W','A'],completedAt:3};
 const history=[first,second,third];
 const state=historyScheduleState(history,roster);
 const waited=historyGamesWaited(history,roster);
 expect(waited).toMatchObject({W:3,A:1,Busy:0});
 expect(state.consecutiveRested).toEqual(roster.map(p=>waited[p.name]));
 expect(state.consecutivePlayed[4]).toBe(2);
 expect(state.gamesPlayed).toEqual([1,1,1,1,2,2,2,2,0,0]);
});
it('converts zero-based physical court lanes to one-based court display numbers',()=>{
 const game=makePlayedGame(result,players,{slot:1,court:3,displayCourt:0},{});
 const base=makePlayedGame(result,players,{slot:1,court:0,displayCourt:0},{})!;
 expect(game).toBeNull();
 expect(historyCourts([base])[0]?.court).toBe(1);
 expect(historyCourts([{...base,id:'lane3',displayCourt:2}])[0]?.court).toBe(3);
});
