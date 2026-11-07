import {it,expect} from 'vitest';
import {generateScheduleGen} from './scheduler';
import {DEFAULT_QUALITY_WEIGHTS} from '../utils/gameQuality';
import type {Player} from './types';

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
