import { describe, expect, it } from 'vitest';
import { newLiveEditConflicts } from './liveEditValidation';
import type { PlannerResult } from '../types';

const result = { schedule: [1,2].map(slot=>({slot,courts:[{court:1,teamA:[{name:slot===1?'A':'E'},{name:slot===1?'B':'F'}],teamB:[{name:slot===1?'C':'G'},{name:slot===1?'D':'H'}]}]})) } as PlannerResult;
const games=[{slot:1,court:0,players:['A','B','C','D']},{slot:2,court:0,displayCourt:3,players:['E','F','G','H']}];
describe('live edit overlap validation',()=>{
  it('rejects assigning someone playing in another logical slot',()=>{
    expect(newLiveEditConflicts(result,games,1,[['E','B','C','D']])).toMatchObject([{name:'E',otherGame:{slot:2,court:0,displayCourt:3}}]);
  });
  it('allows available replacements and same-slot swaps',()=>{
    expect(newLiveEditConflicts(result,games,1,[['I','B','C','D']])).toEqual([]);
    expect(newLiveEditConflicts(result,games,1,[['B','A','C','D']])).toEqual([]);
  });
  it('allows removing one existing collision without requiring all conflicts repaired at once',()=>{
    const corrupt=[{...games[0]!,players:['E','F','C','D']},games[1]!];
    expect(newLiveEditConflicts(result,corrupt,1,[['I','F','C','D']])).toEqual([]);
    expect(newLiveEditConflicts(result,corrupt,1,[['I','G','C','D']])).toMatchObject([{name:'G'}]);
  });
  it('resolves renamed runtime snapshots through stable schedule IDs',()=>{
    const identified=structuredClone(result);
    identified.schedule[1]!.courts[0]!.teamA[0]={id:'e',name:'Renamed E',gender:'M'};
    expect(newLiveEditConflicts(identified,games,1,[['Renamed E','B','C','D']])).toMatchObject([{name:'Renamed E'}]);
  });
});
