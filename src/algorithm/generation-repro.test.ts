import {it,expect,vi} from 'vitest';
import {generateScheduleGen} from './scheduler';
import {DEFAULT_QUALITY_WEIGHTS} from '../utils/gameQuality';
import type {Player} from './types';
import { scoreGameQuality } from '../utils/gameQuality';

// Multi-seed generation stress tests need more than a small unit test's budget.
vi.setConfig({ testTimeout: 15_000 });

// Anonymized gender/level distribution from the reported beta failure.
const roster=['M3','F4','M5','M2','M4','M4','F4','F4','M2','F4','M5','M3','M3','M3','F2','M3','F4','F4','F4','F4','F3','F4','M4','M4','M5','F3','F3','M3','F3','M3','M5','M2'];
const players:Player[]=roster.map((entry,i)=>({name:`P${i+1}`,gender:entry[0] as 'M'|'F',level:Number(entry[1]) as NonNullable<Player['level']>,skill:(Number(entry[1])-1)/4,availFrom:0,availTo:11}));

it('completes twelve four-court slots without reusing a substitute on multiple courts',()=>{
 for(const seed of [10,...Array.from({length:100},(_,i)=>i+1)]){
  let s=seed,last=0;
  const rng=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};
  const gen=generateScheduleGen(players,12,Array(12).fill(4),0,null,null,{qualityWeights:DEFAULT_QUALITY_WEIGHTS},rng);
  for(const frame of gen){
   last=frame.schedule.length;
   const slot=frame.schedule.at(-1)!;
   const names=slot.courts.flatMap(c=>[...c.teamA,...c.teamB].map(p=>p.name));
   expect(names.length,`seed${seed} slot${slot.slot}`).toBe(16);
   expect(new Set(names).size,`seed${seed} slot${slot.slot}`).toBe(16);
   expect(slot.playerState.filter(p=>p.playing).map(p=>p.name).sort(),`seed${seed} slot${slot.slot} accounting`).toEqual([...names].sort());
  }
  expect(last).toBe(12);
 }
});

it('keeps five courts full and matching across the reported hundred-seed distribution', () => {
 let totalScore=0, games=0, mismatches=0, ready=0, spread=0, minimum=0, maximum=0, waitingEvents=0, repeatGroups=0;
 for(let seed=1;seed<=100;seed++){
  let state=seed;
  const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
  const history:import('./types').Court[]=[];
  const groups=new Set<string>();
  let previous=new Set<string>();
  for(const frame of generateScheduleGen(players,12,Array(12).fill(5),0,null,null,{qualityWeights:DEFAULT_QUALITY_WEIGHTS},rng)){
   const slot=frame.schedule.at(-1)!;
   const names=slot.courts.flatMap(c=>[...c.teamA,...c.teamB].map(p=>p.name));
   expect(names.length).toBe(20);expect(new Set(names).size).toBe(20);
   for(const court of slot.courts){
    const group=[...court.teamA,...court.teamB].map(p=>p.name).sort().join(',');
    if(groups.has(group))repeatGroups++;groups.add(group);
    const quality=scoreGameQuality(court,{players,slot:slot.slot,history});
    if(quality.breakdown.gender.raw<0)mismatches++;
    totalScore+=quality.score;games++;
    if(slot.slot>1&&[...court.teamA,...court.teamB].every(p=>!previous.has(p.name)))ready++;
    history.push(court);
   }
   previous=new Set(names);
   waitingEvents+=slot.sitting.length;
   if(slot.slot===12){spread+=Math.max(...frame.gamesPlayed)-Math.min(...frame.gamesPlayed);minimum+=Math.min(...frame.gamesPlayed);maximum+=Math.max(...frame.gamesPlayed);}
  }
 }
 console.log(JSON.stringify({meanMatchup:totalScore/games,mismatchRate:mismatches/games,uniquePlayersPerSlot:20,readyGroupsPerTransition:ready/1100,meanGameCountSpread:spread/100,meanMinGames:minimum/100,meanMaxGames:maximum/100,eligibleWaitingEventsPerSchedule:waitingEvents/100,repeatGroupsPerSchedule:repeatGroups/100}));
 expect(mismatches).toBe(0);
 expect(repeatGroups/100).toBeLessThanOrEqual(3);
});

it('fills feasible five-court slots across roster sizes, genders and attendance windows', () => {
 for(const count of [28,30,32])for(const females of [1,7,14,25])for(let seed=1;seed<=10;seed++){
  const roster:Player[]=Array.from({length:count},(_,i)=>({name:`A${i}`,gender:i<females?'F':'M',availFrom:i===count-1?2:0,availTo:i===count-2?5:7,quarantined:i===count-3}));
  let state=seed;const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
  for(const frame of generateScheduleGen(roster,8,Array(8).fill(5),0,null,null,{},rng)){
   const slot=frame.schedule.at(-1)!;
   const participants=slot.courts.flatMap(c=>[...c.teamA,...c.teamB]);
   expect(participants).toHaveLength(20);expect(new Set(participants.map(p=>p.name)).size).toBe(20);
   expect(participants.every(p=>{const current=roster.find(q=>q.name===p.name)!;return !current.quarantined&&current.availFrom<slot.slot&&current.availTo>=slot.slot-1})).toBe(true);
   expect(slot.courts.every(c=>scoreGameQuality(c,{players:roster,slot:slot.slot}).breakdown.gender.raw===1)).toBe(true);
  }
 }
});
