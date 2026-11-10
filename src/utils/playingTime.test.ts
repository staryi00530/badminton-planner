import { expect, it } from 'vitest';
import type { Player } from '../algorithm/types';
import type { PlayedGame } from './playedHistory';
import { playerPlayingTimes } from './playingTime';

const players: Player[] = ['A','B','C','D'].map(name=>({id:name,name,gender:'M',availFrom:0,availTo:10}));
const game: PlayedGame = {id:'g',planId:'p',slot:1,court:0,completedAt:120_000,startedAt:60_000,durationMs:60_000,
  teamA:[players[0]!,players[1]!] as PlayedGame['teamA'],teamB:[players[2]!,players[3]!] as PlayedGame['teamB'],waitingIds:[]};

it('totals timed completions once by permanent ID, keeps unknowns separate and includes former players',()=>{
  const {startedAt:_,durationMs:__,...unknown}=game;
  const rows=playerPlayingTimes([game,game,{...unknown,id:'old',slot:2}], [{...players[0]!,name:'Renamed'}], [], null, 200_000);
  expect(rows).toHaveLength(4);
  expect(rows.find(row=>row.player.id==='A')).toMatchObject({player:{name:'Renamed'},completedMs:60_000,timedGames:1,unknownGames:1,averageMs:60_000,liveMs:0});
});
it('keeps provisional live time separate and does not invent unknown live starts',()=>{
  const result={schedule:[{slot:2,courts:[{court:1,teamA:game.teamA,teamB:game.teamB}],sitting:[],playerState:[],repeatedCourts:[]}],gamesPlayed:[]};
  const ref={slot:2,court:0,startedAt:120_000};
  const rows=playerPlayingTimes([game],players,[ref,ref],result,150_000);
  expect(rows[0]).toMatchObject({completedMs:60_000,liveMs:30_000,liveGames:1,untimedLiveGames:0});
  expect(playerPlayingTimes([],players,[{slot:2,court:0}],result,150_000)[0]).toMatchObject({liveMs:0,liveGames:1,untimedLiveGames:1,averageMs:null});
});
it('never merges permanent identities just because names match',()=>{
  const rows=playerPlayingTimes([game],[{...players[0]!,id:'different'}],[],null,150_000);
  expect(rows.find(row=>row.player.id==='different')?.completedMs).toBe(0);
  expect(rows.find(row=>row.player.id==='A')?.completedMs).toBe(60_000);
  const result={schedule:[{slot:2,courts:[{court:1,teamA:game.teamA,teamB:game.teamB}],sitting:[],playerState:[],repeatedCourts:[]}],gamesPlayed:[]};
  const liveRows=playerPlayingTimes([], [{...players[0]!,id:'different'}], [{slot:2,court:0,players:['A','B','C','D'],startedAt:100_000}],result,150_000);
  expect(liveRows.find(row=>row.player.id==='different')?.liveMs).toBe(0);
  expect(liveRows.find(row=>row.player.id==='A')?.liveMs).toBe(50_000);
});
