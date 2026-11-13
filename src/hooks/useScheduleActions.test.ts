// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useScheduleActions } from './useScheduleActions';
import type { Player } from '../types';
import * as scheduler from '../algorithm/scheduler';
import { exportLiveQueueLogs } from '../utils/liveQueue';
import { migratePlayedGames } from '../utils/playedHistory';
import { computeCourtsPerSlot } from '../utils/courtsPerSlot';

it('retains the expanded capacity phase across repeated recovery rerolls of earlier partial slots',()=>{
  const players:Player[]=Array.from({length:32},(_,i)=>({id:`phase${i}`,name:`Phase${i}`,gender:'M',availFrom:0,availTo:5}));
  const prior={...scheduler.generateSchedule(players,6,[4,4,4,5,5,5])!,planId:'phase-prior'};
  const completed=[{slot:1,court:0}];
  const history=migratePlayedGames(prior,players,completed,{});
  const getCourtsPerSlot=(courtOverrides:Record<number,number>={})=>computeCourtsPerSlot({totalSlots:6,gameMinutes:15,numCourts:4,extraCourt:{enabled:false,startMin:0,durationMin:0},courtOverrides});
  const frames:FrameRequestCallback[]=[];
  const raf=vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  const generator=vi.spyOn(scheduler,'generateScheduleGen').mockImplementation(function*(roster,totalSlots,courts){
    let cursor=0;
    yield {gamesPlayed:roster.map(()=>0),schedule:Array.from({length:totalSlots},(_,slot)=>({slot:slot+1,courts:Array.from({length:courts[slot] ?? 0},(_,court)=>{
      const group=Array.from({length:4},()=>roster[cursor++%roster.length]!);
      return {court:court+1,teamA:[group[0]!,group[1]!] as [Player,Player],teamB:[group[2]!,group[3]!] as [Player,Player]};
    }),sitting:[],playerState:[],repeatedCourts:[]}))};
  });
  try{
    const recover=(base:typeof prior,live:PlayerGameRef[],done:PlayerGameRef[],reset=false)=>{
      const patchState=vi.fn();
      const hook=renderHook(()=>useScheduleActions({players,result:base,playedGames:history,historyEpoch:2,totalSlots:6,configuredNumCourts:4,isGenerating:false,isConfirmed:false,
        scores:{},winLoss:{},liveGames:live,completedGames:done,fromSlot:1,fromSlotCourts:0,courtOverrides:{4:5},
        recordUndo:vi.fn(),computeSkill:()=>0.5,getPlayersWithAvailability:()=>players,applyAvailability:p=>p,getCourtsPerSlot,
        getScheduleOptions:()=>({}),patchState,keepGamesBeforeSlot:games=>games}));
      act(()=>{hook.result.current.runGenerate(reset);while(frames.length)frames.shift()!(0);});
      hook.unmount();return patchState.mock.calls.at(-1)![0];
    };
    const first=recover(prior,[{slot:3,court:0}],completed);
    expect(first.result.capacityProgressFloorSlot).toBe(4);expect(first.liveGames).toHaveLength(5);
    expect(Math.max(...first.liveGames.map((game:PlayerGameRef)=>game.slot))).toBe(2);
    const second=recover(first.result,first.liveGames,[]);
    expect(second.result.capacityProgressFloorSlot).toBe(4);expect(second.liveGames).toHaveLength(5);
    const reset=recover(second.result,second.liveGames,[],true);
    expect(reset.result).not.toHaveProperty('capacityProgressFloorSlot');expect(reset.liveGames).toHaveLength(4);
  }finally{generator.mockRestore();raf.mockRestore();}
});
type PlayerGameRef={slot:number;court:number;players?:string[]};

it.each([false,true])('uses fresh base capacity without completed history even when old court overrides exist (%s)',resetHistory=>{
  const players:Player[]=Array.from({length:16},(_,i)=>({id:`fresh${i}`,name:`Fresh${i}`,gender:'M',availFrom:0,availTo:1}));
  const prior={...scheduler.generateSchedule(players,2,[3,3])!,planId:'unstarted',capacityProgressFloorSlot:2};
  const getCourtsPerSlot=(courtOverrides:Record<number,number>={})=>computeCourtsPerSlot({totalSlots:2,gameMinutes:15,numCourts:2,extraCourt:{enabled:false,startMin:0,durationMin:0},courtOverrides});
  const frames:FrameRequestCallback[]=[];
  const raf=vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  const patchState=vi.fn();
  try{
    const {result}=renderHook(()=>useScheduleActions({players,result:prior,playedGames:[],historyEpoch:0,totalSlots:2,configuredNumCourts:2,isGenerating:false,isConfirmed:false,
      scores:{},winLoss:{},liveGames:[{slot:1,court:0}],completedGames:[],fromSlot:1,fromSlotCourts:0,courtOverrides:{1:3},
      recordUndo:vi.fn(),computeSkill:()=>0.5,getPlayersWithAvailability:()=>players,applyAvailability:p=>p,getCourtsPerSlot,
      getScheduleOptions:()=>({}),patchState,keepGamesBeforeSlot:games=>games}));
    act(()=>{result.current.runGenerate(resetHistory);while(frames.length)frames.shift()!(0);});
    const applied=patchState.mock.calls.at(-1)![0];
    expect(applied.result.schedule.map((slot:{courts:unknown[]})=>slot.courts.length)).toEqual([2,2]);
    expect(applied.liveGames).toHaveLength(2);expect(applied.courtOverrides).toEqual({});
    expect(applied.result).not.toHaveProperty('capacityProgressFloorSlot');
    const logs=JSON.parse(exportLiveQueueLogs()).logs as Array<{label:string;details:Record<string,unknown>}>;
    expect(logs.filter(log=>log.label==='generate:complete').at(-1)!.details).toMatchObject({capacityIntent:'fresh-configuration',sourceCapacity:3,
      plannedInitialCapacity:2,nominalCourtsPerSlot:[2,2],courtOverridesBefore:{1:3},courtOverridesAfter:{}});
  }finally{raf.mockRestore();}
});

it.each([false,true])('keeps expanded recovery capacity and court plan unless history is explicitly reset (%s)',resetHistory=>{
  const players:Player[]=Array.from({length:32},(_,i)=>({id:`p${i}`,name:`P${i}`,gender:'M',availFrom:0,availTo:3}));
  const prior={...scheduler.generateSchedule(players,4,[3,3,4,5])!,planId:'expanded'};
  const completed=[...Array.from({length:3},(_,court)=>({slot:1,court})),...Array.from({length:2},(_,court)=>({slot:2,court})),...Array.from({length:2},(_,court)=>({slot:3,court}))];
  const playedGames=migratePlayedGames(prior,players,completed,{});
  const overrides={3:4,4:5};
  const getCourtsPerSlot=vi.fn((courtOverrides:Record<number,number>={})=>computeCourtsPerSlot({totalSlots:4,gameMinutes:15,numCourts:3,extraCourt:{enabled:false,startMin:0,durationMin:0},courtOverrides}));
  const frames:FrameRequestCallback[]=[];
  const raf=vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  const generator=vi.spyOn(scheduler,'generateScheduleGen').mockImplementation(function*(roster,totalSlots,courts){
    let cursor=0;
    yield {gamesPlayed:roster.map(()=>0),schedule:Array.from({length:totalSlots},(_,slot)=>({slot:slot+1,courts:Array.from({length:courts[slot] ?? 0},(_,court)=>{
      const group=Array.from({length:4},()=>roster[cursor++%roster.length]!);
      return {court:court+1,teamA:[group[0]!,group[1]!] as [Player,Player],teamB:[group[2]!,group[3]!] as [Player,Player]};
    }),sitting:[],playerState:[],repeatedCourts:[]}))};
  });
  const patchState=vi.fn();
  try{
    const {result}=renderHook(()=>useScheduleActions({players,result:prior,playedGames,historyEpoch:2,totalSlots:4,configuredNumCourts:3,isGenerating:false,isConfirmed:false,
      scores:{},winLoss:{},liveGames:[{slot:3,court:2},{slot:4,court:0}],completedGames:completed,fromSlot:4,fromSlotCourts:0,courtOverrides:overrides,
      recordUndo:vi.fn(),computeSkill:()=>0.5,getPlayersWithAvailability:()=>players,applyAvailability:p=>p,getCourtsPerSlot,
      getScheduleOptions:()=>({}),patchState,keepGamesBeforeSlot:games=>games}));
    act(()=>{result.current.runGenerate(resetHistory);while(frames.length)frames.shift()!(0);});
    const applied=patchState.mock.calls.at(-1)![0];
    expect(applied.result.schedule.map((slot:{courts:unknown[]})=>slot.courts.length)).toEqual(resetHistory?[3,3,3,3]:[0,1,2,5]);
    expect(applied.courtOverrides).toEqual(resetHistory?{}:overrides);
    expect(applied.liveGames).toHaveLength(resetHistory?3:5);
    expect(new Set(applied.liveGames.flatMap((ref:{players:string[]})=>ref.players)).size).toBe(resetHistory?12:20);
    expect(applied.playedGames).toHaveLength(resetHistory?0:7);
    const logs=JSON.parse(exportLiveQueueLogs()).logs as Array<{label:string;details:Record<string,unknown>}>;
    expect(logs.filter(log=>log.label==='generate:complete').at(-1)!.details).toMatchObject({configuredNumCourts:3,sourceCapacity:5,capacityIntent:resetHistory?'fresh-configuration':'history-recovery',
      plannedInitialCapacity:resetHistory?3:5,courtOverridesBefore:overrides,courtOverridesAfter:resetHistory?{}:overrides,
      nominalCourtsPerSlot:resetHistory?[3,3,3,3]:[3,3,4,5],remainingCourtsPerSlot:resetHistory?[3,3,3,3]:[0,1,2,5]});
  }finally{generator.mockRestore();raf.mockRestore();}
});

it.each([false,true])('logs explicit reroll intent and original versus remaining capacity for seven retained games (%s)',resetHistory=>{
  const players:Player[]=Array.from({length:32},(_,i)=>({id:`p${i}`,name:`P${i}`,gender:'M',availFrom:0,availTo:3}));
  const prior={...scheduler.generateSchedule(players,4,[5,5,5,5])!,planId:'prior'};
  const completed=[...Array.from({length:3},(_,court)=>({slot:1,court})),...Array.from({length:2},(_,court)=>({slot:2,court})),...Array.from({length:2},(_,court)=>({slot:3,court}))];
  const playedGames=migratePlayedGames(prior,players,completed,{});
  const frames:FrameRequestCallback[]=[];
  const raf=vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{frames.push(callback);return frames.length;});
  const patchState=vi.fn(), getCourtsPerSlot=vi.fn(()=>[5,5,5,5]);
  try{
    const {result}=renderHook(()=>useScheduleActions({players,result:prior,playedGames,historyEpoch:4,totalSlots:4,configuredNumCourts:5,isGenerating:false,isConfirmed:false,
      scores:{},winLoss:{},liveGames:[],completedGames:completed,fromSlot:4,fromSlotCourts:3,courtOverrides:{2:3},
      recordUndo:vi.fn(),computeSkill:()=>0.5,getPlayersWithAvailability:()=>players,applyAvailability:p=>p,getCourtsPerSlot,
      getScheduleOptions:()=>({}),patchState,keepGamesBeforeSlot:games=>games}));
    act(()=>{result.current.runGenerate(resetHistory);while(frames.length)frames.shift()!(0);});
    const applied=patchState.mock.calls.at(-1)![0];
    expect(getCourtsPerSlot).toHaveBeenCalledWith(resetHistory?{}:{2:3});
    expect(applied.result.schedule.map((slot:{courts:unknown[]})=>slot.courts.length)).toEqual(resetHistory?[5,5,5,5]:[2,3,3,5]);
    expect(applied.playedGames).toHaveLength(resetHistory?0:7);
    expect(applied.historyEpoch).toBe(resetHistory?5:4);
    const logs=JSON.parse(exportLiveQueueLogs()).logs as Array<{label:string;details:Record<string,unknown>}>;
    const start=logs.filter(log=>log.label==='generate:start').at(-1)!.details;
    const complete=logs.filter(log=>log.label==='generate:complete').at(-1)!.details;
    for(const details of [start,complete])expect(details).toMatchObject({intent:resetHistory?'reset-history':'keep-history',resetHistory,
      historyCountBefore:7,retainedHistoryCount:resetHistory?0:7,historyEpochBefore:4,historyEpochAfter:resetHistory?5:4,configuredNumCourts:5,
      nominalCourtsPerSlot:[5,5,5,5],remainingCourtsPerSlot:resetHistory?[5,5,5,5]:[2,3,3,5]});
    expect(complete.generationId).toBe(start.generationId);
    expect(complete).toMatchObject({historyResetApplied:resetHistory,firstSlotScheduledGameCount:resetHistory?5:2,
      activeFirstSlotCount:resetHistory?5:2,deferredFirstSlotCount:0});
  }finally{raf.mockRestore();}
});

it.each([false, true])('rerolls only unplayed court budget unless history reset is selected (%s)', reset => {
  const players: Player[] = Array.from({ length: 32 }, (_, i) => ({ id: `id-${i}`, name: `P${i}`, gender: 'M', availFrom: 0, availTo: 2 }));
  const prior = { ...scheduler.generateSchedule(players, 3, [5, 5, 5])!, planId: 'old' };
  const completed = [0, 1, 2].map(court => ({ slot: 1, court }));
  const playedGames = migratePlayedGames(prior, players, completed, {});
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const patchState = vi.fn();
  try {
    const { result } = renderHook(() => useScheduleActions({ players, result: prior, playedGames, historyEpoch: 0, totalSlots: 3, isGenerating: false, isConfirmed: false,
      scores: {}, winLoss: {}, liveGames: [{ slot: 1, court: 3 }, { slot: 1, court: 4 }], completedGames: completed, fromSlot: 1, fromSlotCourts: 0,
      recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players, applyAvailability: p => p,
      getCourtsPerSlot: () => [5, 5, 5], getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot: games => games,
    }));
    act(() => { result.current.runGenerate(reset); while (frames.length) frames.shift()!(0); });
    const applied = patchState.mock.calls.at(-1)![0];
    expect(applied.result.schedule.reduce((n: number, slot: { courts: unknown[] }) => n + slot.courts.length, 0)).toBe(reset ? 15 : 12);
    expect(applied.result.planId).not.toBe('old');
    expect(applied.playedGames).toHaveLength(reset ? 0 : 3);
    expect(applied.historyEpoch).toBe(reset ? 1 : 0);
    expect(applied.liveGames).toHaveLength(5);
    expect(applied.result.gamesPlayed.reduce((a: number, b: number) => a + b, 0)).toBe(60);
  } finally { raf.mockRestore(); }
});

it('explains why regenerating beyond the last shared slot cannot change a game', () => {
  const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: 'M', availFrom: 0, availTo: 0 }));
  const patchState = vi.fn();
  const { result } = renderHook(() => useScheduleActions({ players, result: { schedule: [], gamesPlayed: [] }, totalSlots: 1, isGenerating: false, isConfirmed: false,
    scores: {}, winLoss: {}, liveGames: [{ slot: 1, court: 0 }], completedGames: [], fromSlot: 1, fromSlotCourts: 0,
    recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players, applyAvailability: p => p,
    getCourtsPerSlot: () => [1], getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot: games => games,
  }));
  act(() => result.current.runRegenerateFromSlotWithCourts(1, 0));
  expect(patchState).toHaveBeenCalledWith(expect.objectContaining({ sessionChangeNotice: expect.stringMatching(/no upcoming/i) }));
});

it('releases generation and restores the previous plan when a later slot throws', () => {
  const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: 'M', availFrom: 0, availTo: 11 }));
  const prior = scheduler.generateSchedule(players, 1, [1])!;
  const frames: FrameRequestCallback[] = [];
  const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
  const generator = vi.spyOn(scheduler, 'generateScheduleGen').mockImplementation(function* () {
    for (let i = 1; i <= 5; i++) yield { schedule: Array.from({ length: i }, (_, index) => ({ ...prior.schedule[0]!, slot: index + 1 })), gamesPlayed: [0, 0, 0, 0] };
    throw new Error('private failure details');
  });
  const patchState = vi.fn();
  try {
    const { result } = renderHook(() => useScheduleActions({ players, result: prior, totalSlots: 12, isGenerating: false, isConfirmed: true,
      scores: {}, winLoss: {}, liveGames: [{ slot: 1, court: 0 }], completedGames: [], fromSlot: 2, fromSlotCourts: 4, courtOverrides: { 2: 4 },
      recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players, applyAvailability: p => p,
      getCourtsPerSlot: () => Array(12).fill(4), getScheduleOptions: () => ({}), patchState, keepGamesBeforeSlot: games => games,
    }));
    act(() => { result.current.runGenerate(); while (frames.length) frames.shift()!(0); });
    expect(patchState).toHaveBeenLastCalledWith(expect.objectContaining({ result: prior, isGenerating: false, isConfirmed: true, genSlot: 0,
      liveGames: [{ slot: 1, court: 0 }], courtOverrides: { 2: 4 }, sessionChangeNotice: expect.stringMatching(/slot 6.*previous schedule.*restored/i) }));
    const logs = exportLiveQueueLogs();
    expect(logs).toContain('generate:failed');
    expect(logs).not.toContain('private failure details');
  } finally { generator.mockRestore(); raf.mockRestore(); }
});

it.each(['doRegen', 'upcoming'] as const)('seeds %s from retained completions and live games exactly once', action => {
  const players: Player[] = Array.from({ length: 16 }, (_, i) => ({
    id: `id-${i}`, name: `P${i}`, gender: 'M', availFrom: 0, availTo: 2,
  }));
  const prior = { ...scheduler.generateSchedule(players, 3, [3, 3, 3])!, planId: 'current', capacityProgressFloorSlot: 2 };
  const older = { ...prior, planId: 'older' };
  const completed = [{ slot: 1, court: 0 }];
  const live = [{ slot: 1, court: 1 }];
  const playedGames = migratePlayedGames(prior, players, completed, {},
    migratePlayedGames(older, players, completed, {}));
  const generate = vi.spyOn(scheduler, 'generateSchedule');
  const patchState = vi.fn();
  try {
    const { result } = renderHook(() => useScheduleActions({
      players, result: prior, playedGames, totalSlots: 3, isGenerating: false, isConfirmed: false,
      scores: {}, winLoss: {}, liveGames: live, completedGames: completed, fromSlot: 2, fromSlotCourts: 0,
      recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players,
      applyAvailability: p => p, getCourtsPerSlot: () => [3, 3, 3], getScheduleOptions: () => ({}),
      patchState, keepGamesBeforeSlot: games => games,
    }));
    let regenerated;
    act(() => {
      if (action === 'doRegen') regenerated = result.current.doRegen(2, null);
      else result.current.runRegenerateFromSlotWithCourts(2, 0);
    });
    const snapshot = generate.mock.calls[0]![4]!;
    expect(snapshot.gamesPlayed.reduce((a, b) => a + b, 0)).toBe(12);
    expect(snapshot.partnerCount.flat().reduce((a, b) => a + b, 0)).toBe(12);
    expect(snapshot.keptSlots).toEqual(prior.schedule.slice(0, 1));
    const newResult = action === 'doRegen'
      ? (regenerated as unknown as { newResult: typeof prior }).newResult
      : patchState.mock.calls.at(-1)![0].result;
    expect(newResult.planId).toBe('current');
    expect(newResult.capacityProgressFloorSlot).toBe(2);
    expect(newResult.schedule[0]).toEqual(prior.schedule[0]);
    expect(playedGames).toHaveLength(2);
    expect(patchState.mock.calls.every(([patch]) => patch.playedGames === undefined)).toBe(true);
  } finally { generate.mockRestore(); }
});

it.each(['doRegen', 'upcoming'] as const)('keeps prior-plan later-slot court consumption during %s', action => {
  const players: Player[] = Array.from({ length: 16 }, (_, i) => ({
    id: `id-${i}`, name: `P${i}`, gender: 'M', availFrom: 0, availTo: 2,
  }));
  const older = { ...scheduler.generateSchedule(players, 3, [2, 2, 2])!, planId: 'older' };
  const playedGames = migratePlayedGames(older, players,
    [{ slot: 2, court: 0 }, { slot: 3, court: 0 }, { slot: 3, court: 1 }], {});
  const prior = { ...scheduler.generateSchedule(players, 3, [2, 1, 0])!, planId: 'current' };
  const completed = [{ slot: 1, court: 0 }];
  const history = migratePlayedGames(prior, players, completed, {}, playedGames);
  const patchState = vi.fn();
  const generate = vi.spyOn(scheduler, 'generateSchedule');
  try {
    const { result } = renderHook(() => useScheduleActions({
      players, result: prior, playedGames: history, totalSlots: 3, isGenerating: false, isConfirmed: false,
      scores: {}, winLoss: {}, liveGames: [], completedGames: completed, fromSlot: 2, fromSlotCourts: 0,
      recordUndo: vi.fn(), computeSkill: () => 0.5, getPlayersWithAvailability: () => players,
      applyAvailability: p => p, getCourtsPerSlot: () => [2, 2, 2], getScheduleOptions: () => ({}),
      patchState, keepGamesBeforeSlot: games => games,
    }));
    let regenerated;
    act(() => {
      if (action === 'doRegen') regenerated = result.current.doRegen(2, null);
      else result.current.runRegenerateFromSlotWithCourts(2, 0);
    });
    if (action === 'upcoming') expect(patchState.mock.calls.at(-1)![0].fromSlotCourts).toBe(2);
    expect(generate.mock.calls[0]![2]).toEqual([2, 1, 0]);
    expect(generate.mock.calls[0]![6]?.consumedSlots).toEqual([3]);
    const newResult = action === 'doRegen'
      ? (regenerated as unknown as { newResult: typeof prior }).newResult
      : patchState.mock.calls.at(-1)![0].result;
    expect(newResult.schedule.map((slot: { courts: unknown[] }) => slot.courts.length)).toEqual([2, 1, 0]);
    expect(newResult.planId).toBe('current');
  } finally { generate.mockRestore(); }
});

it.each([false, true])('skips a consumed regeneration boundary or reports session completion (%s)', exhausted => {
  const players: Player[] = Array.from({ length: 8 }, (_, i) => ({
    id: `id-${i}`, name: `P${i}`, gender: 'M', availFrom: 0, availTo: 2,
  }));
  const older = { ...scheduler.generateSchedule(players, 3, [1, 1, 1])!, planId: 'older' };
  const playedGames = migratePlayedGames(older, players,
    [{ slot: 2, court: 0 }, ...(exhausted ? [{ slot: 3, court: 0 }] : [])], {});
  const prior = { ...scheduler.generateSchedule(players, 3, [1, 0, exhausted ? 0 : 1])!, planId: 'current' };
  const patchState = vi.fn();
  const recordUndo = vi.fn();
  const { result } = renderHook(() => useScheduleActions({
    players, result: prior, playedGames, totalSlots: 3, isGenerating: false, isConfirmed: false,
    scores: {}, winLoss: {}, liveGames: [], completedGames: [{ slot: 1, court: 0 }], fromSlot: 2, fromSlotCourts: 0,
    recordUndo, computeSkill: () => 0.5, getPlayersWithAvailability: () => players,
    applyAvailability: p => p, getCourtsPerSlot: () => [1, 1, 1], getScheduleOptions: () => ({}),
    patchState, keepGamesBeforeSlot: games => games,
  }));
  act(() => result.current.runRegenerateFromSlotWithCourts(2, 0));
  const patch = patchState.mock.calls.at(-1)![0];
  if (exhausted) {
    expect(patch.result).toBeUndefined();
    expect(patch.sessionChangeNotice).toMatch(/no remaining games/i);
    expect(recordUndo).not.toHaveBeenCalled();
  } else {
    expect(patch.fromSlot).toBe(3);
    expect(patch.result.schedule.map((slot: { courts: unknown[] }) => slot.courts.length)).toEqual([1, 0, 1]);
    expect(patch.sessionChangeNotice).toMatch(/from slot 3/i);
    expect(recordUndo).toHaveBeenCalledOnce();
  }
});
