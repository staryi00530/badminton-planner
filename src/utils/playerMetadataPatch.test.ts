import { describe, it, expect } from 'vitest';
import { playerMetadataPatch, playerStatsKey } from './playerMetadataPatch';
import type { Player } from '../types';
const before:Player={id:'a',name:'Alice',gender:'F',statsKey:'Alice original',availFrom:0,availTo:8};
const after:Player={...before,name:'Alicia',gender:'M',aliases:['Alice']};
function fixture():Parameters<typeof playerMetadataPatch>[0] {
 const a={id:'a',name:'Alice',gender:'F' as const}; const b={id:'b',name:'Bob',gender:'M' as const};
 return { result:{schedule:[{slot:1,courts:[{court:1,teamA:[a,b],teamB:[b,b]}],sitting:[a],playerState:[{...a,total:4,conPlayed:1,conRested:0,playing:true,available:true}],repeatedCourts:[]}],gamesPlayed:[4,3]},scores:{'1:0':{a:'21',b:'19',applied:true,teamA:['Alice','Bob'],teamB:['Bob','Bob']}},liveGames:[{slot:1,court:0,displayCourt:3,players:['Alice','Bob','Bob','Bob']}],completedGames:[{slot:2,court:0,players:['Alice']}],suspendedPlayerNames:['Alice'],preferredPairs:[['Alice','Bob']],editLayout:{courts:[['Alice','Bob']],sitting:['Alice']},playerHistory:[{...before,level:5,quarantined:true}] };
}
describe('playerMetadataPatch',()=>{
 it('updates identity metadata everywhere while retaining exact lineup positions and score values',()=>{
 const state=fixture();const original=structuredClone(state);const patch=playerMetadataPatch(state,before,after);
 const slot=patch.result!.schedule[0]!;
 expect(slot.courts[0]!.teamA).toEqual([{id:'a',name:'Alicia',gender:'M',statsKey:'Alice original'}, {id:'b',name:'Bob',gender:'M'}]);
 expect(slot.courts[0]!.teamB).toEqual(state.result!.schedule[0]!.courts[0]!.teamB);
 expect(slot.sitting[0]).toMatchObject({id:'a',name:'Alicia',gender:'M'});
 expect(slot.playerState[0]).toMatchObject({name:'Alicia',gender:'M',total:4,conPlayed:1});
 expect(patch.result!.gamesPlayed).toEqual([4,3]);
 expect(patch.result).toHaveProperty('preserveLineups',true);
 expect(patch.scores!['1:0']).toEqual({a:'21',b:'19',applied:true,teamA:['Alicia','Bob'],teamB:['Bob','Bob']});
 expect(patch.liveGames![0]).toEqual({...state.liveGames[0],players:['Alicia','Bob','Bob','Bob']});
 expect(patch.completedGames![0]!.players).toEqual(['Alicia']);
 expect(patch.suspendedPlayerNames).toEqual(['Alicia']);expect(patch.preferredPairs).toEqual([['Alicia','Bob']]);
 expect(patch.editLayout).toEqual({courts:[['Alicia','Bob']],sitting:['Alicia']});
 expect(patch.playerHistory![0]).toMatchObject({id:'a',name:'Alicia',gender:'M',statsKey:'Alice original',aliases:['Alice'],level:5,quarantined:true});
 expect(state).toEqual(original);expect(patch).not.toHaveProperty('scheduleDirty');
 });
 it('matches an ID despite an older display snapshot but does not rename a different identified person',()=>{
 const state=fixture(); const court=state.result!.schedule[0]!.courts[0]!;
 court.teamA=[{id:'a',name:'Earlier Alice',gender:'F'},{id:'other',name:'Alice',gender:'F'}];
 const updated=playerMetadataPatch(state,before,after).result!.schedule[0]!.courts[0]!;
 expect(updated.teamA[0].name).toBe('Alicia');expect(updated.teamA[1].name).toBe('Alice');
 });
 it('supports null schedule/layout and legacy name-only lineups',()=>{
 const state=fixture();state.result=null;state.editLayout=null;
 expect(playerMetadataPatch(state,before,after)).toMatchObject({result:null,editLayout:null});
 });
 it('keeps the compatibility statistics key across renames',()=>{expect(playerStatsKey(after)).toBe('Alice original');expect(playerStatsKey({name:'Legacy'})).toBe('Legacy');});
});
