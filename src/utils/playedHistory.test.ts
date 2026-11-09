import { describe, expect, it } from 'vitest';
import { makePlayedGame, migratePlayedGames, mergePlayedGames, remainingCourtsPerSlot, historyScheduleState, historyGamesWaited, historyCourts } from './playedHistory';
import type { Player } from '../algorithm/types';
const players: Player[] = ['A','B','C','D','E','F'].map((name,i)=>({id:name,name,gender:i%2?'F':'M',availFrom:0,availTo:10}));
const result = {planId:'p1',schedule:[{slot:1,courts:[{court:1,teamA:[players[0]!,players[1]!] as [Player,Player],teamB:[players[2]!,players[3]!] as [Player,Player]}],sitting:players.slice(4),playerState:[],repeatedCourts:[]}],gamesPlayed:[]};
describe('played history',()=>{
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
