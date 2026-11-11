import { describe, expect, it } from 'vitest';
import type { SharePayload } from '../types';
import { playerShareId, playerViewModel, playerViewUrl } from './playerView';

function share(): SharePayload {
  return { v: 1, planId: 'plan', ids: ['a','b','c','d','e','f','g','h'],
    p: ['A','B','C','D','E','F','G','H'].map(name=>[name,'M']),
    cfg:{g:15,c:2,sessionStart:'20:30'},
    slots:[{s:1,c:[[[0,1],[2,3]],[[4,5],[6,7]]],sit:[]},{s:2,c:[[[0,4],[2,6]]],sit:[1,3,5,7]}],
    runtime:{live:[{slot:1,court:1,displayCourt:0,players:['H','G','F','E'],startedAt:100}],completed:[{slot:1,court:0}]},
    history:[{id:'played',planId:'plan',slot:1,court:0,completedAt:200,startedAt:100,durationMs:100,
      teamA:[{id:'a',name:'A',gender:'M'},{id:'b',name:'B',gender:'M'}],teamB:[{id:'c',name:'C',gender:'M'},{id:'d',name:'D',gender:'M'}],waitingIds:[],score:{a:'21',b:'19',applied:true}}] };
}

describe('player view model',()=>{
  it('uses actual live lineup/court, labels future times tentative and deduplicates retained history',()=>{
    const model=playerViewModel(share());
    expect(model.current).toHaveLength(1);
    expect(model.current[0]).toMatchObject({court:1,status:'current',startedAt:100,teamA:[{id:'h',name:'H'},{id:'g',name:'G'}],teamB:[{id:'f',name:'F'},{id:'e',name:'E'}]});
    expect(model.upcoming).toHaveLength(1);
    expect(model.upcoming[0]).toMatchObject({slot:2,court:1,status:'planned'});
    expect(model.upcoming[0]!.timeLabel).toMatch(/Planned.*8:45 PM/);
    expect(model.played).toHaveLength(1);
    expect(model.played[0]).toMatchObject({status:'played',score:{a:'21',b:'19'},durationMs:100});
  });
  it('keeps stable IDs after rename and retired historical participants available',()=>{
    const data=share(); data.p[0]=['Renamed','M']; data.active=[0,1,2,4,5,6,7];
    data.history![0]!.teamB[1]={id:'retired',name:'Former player',gender:'F'};
    const model=playerViewModel(data);
    expect(model.players.find(p=>p.id==='a')).toMatchObject({name:'Renamed',persistent:true,active:true,selectable:true});
    expect(model.players.find(p=>p.id==='retired')).toMatchObject({name:'Former player',active:false,persistent:true,selectable:true});
    expect(model.players.find(p=>p.id==='d')?.active).toBe(false);
    expect(model.played[0]!.teamA[0]).toEqual({id:'a',name:'A'});
  });
  it('keeps authoritative ledger completion after a roster rename without fabricating a legacy player',()=>{
    const data=share();data.p[0]=['Renamed A','M'];
    data.runtime!.completed![0]!.players=['A','B','C','D'];
    const model=playerViewModel(data);
    expect(model.played).toHaveLength(1);
    expect(model.played[0]!.teamA[0]).toEqual({id:'a',name:'A'});
    expect(model.players).toHaveLength(8);
    expect(model.players.every(player=>player.persistent)).toBe(true);
    expect(model.players.find(player=>player.id==='a')?.name).toBe('Renamed A');
  });
  it('does not remigrate an explicitly captured completion reference from an older recovery plan',()=>{
    const data=share();data.planId='recovery';data.p[0]=['Renamed A','M'];
    data.runtime!.completed![0]={slot:1,court:0,id:'played',players:['A','B','C','D']};
    expect(playerViewModel(data).played).toHaveLength(1);
  });
  it('does not mistake old-plan history for a completed game in a recovery plan',()=>{
    const data=share(); data.planId='recovery';data.runtime={live:[],completed:[]};
    const model=playerViewModel(data);
    expect(model.played).toHaveLength(1);
    expect(model.upcoming).toHaveLength(3);
  });
  it('exposes no draft scores or private metadata',()=>{
    const data=share();data.history![0]!.score!.applied=false;
    data.scores={s1c1:{a:'10',b:'12',applied:false},s2c0:{a:'21',b:'18',applied:true}};
    const model=playerViewModel(data);
    expect([...model.current,...model.upcoming,...model.played].every(game=>game.score===undefined)).toBe(true);
    expect(Object.keys(model.players[0]!)).toEqual(['id','name','persistent','active','selectable']);
  });
  it('allows only temporary unique-name filtering for legacy shares and rejects ambiguous names',()=>{
    const data=share();delete data.ids;delete data.history;data.runtime={};data.p[1]=['A','M'];
    const model=playerViewModel(data);
    const ambiguous=model.players.filter(p=>p.name==='A');
    expect(ambiguous).toHaveLength(2);
    expect(ambiguous.every(p=>!p.selectable&&!p.persistent)).toBe(true);
    expect(model.players.find(p=>p.name==='C')).toMatchObject({persistent:false,selectable:true});
    expect(new Set(ambiguous.map(p=>p.id)).size).toBe(2);
  });
  it('never guesses a stable player ID for an ambiguous runtime name',()=>{
    const data=share();data.p[0]=['Alex','M'];data.p[4]=['Alex','M'];
    data.runtime={live:[{slot:2,court:0,players:['H','Alex','C','G']}],completed:[]};
    const model=playerViewModel(data);
    expect(model.current[0]!.teamA[1]!.id).not.toBe('a');
    expect(model.current[0]!.teamA[1]!.id).not.toBe('e');
  });
  it('accepts empty prepared sessions and rejects duplicate logical slot numbers',()=>{
    const empty=share();empty.slots=[];empty.runtime={};empty.history=[];
    expect(playerViewModel(empty).upcoming).toEqual([]);
    const duplicate=share();duplicate.slots.push(duplicate.slots[0]!);
    expect(()=>playerViewModel(duplicate)).toThrow();
  });
  it('restores pruned RTDB empty-plan arrays only for a known configured schema-3 share',()=>{
    const data=share();data.schema=3;data.runtime={};
    delete (data as Partial<SharePayload>).slots;
    const model=playerViewModel(data);
    expect(model.current).toEqual([]);expect(model.upcoming).toEqual([]);
    expect(model.players).toHaveLength(8);expect(model.played).toHaveLength(1);
    delete (data as Partial<SharePayload>).p;delete data.ids;
    const historical=playerViewModel(data);
    expect(historical.players).toHaveLength(4);
    expect(historical.players.every(player=>!player.active&&player.persistent)).toBe(true);
    expect(historical.played).toHaveLength(1);
    expect(historical.current).toEqual([]);expect(historical.upcoming).toEqual([]);
    const nulls={...data,p:null,slots:null} as unknown as SharePayload;
    expect(playerViewModel(nulls).players).toHaveLength(4);
  });
  it('does not normalize malformed plans or unknown payloads into an empty session',()=>{
    for(const value of [null,42,'share',{}, {v:1,p:[]}, {v:1,schema:3,p:[]},
      {v:1,schema:3,p:[],cfg:{g:15,c:0}}, {v:1,schema:3,p:[],slots:{},cfg:{g:15,c:2}},
      {v:1,schema:3,p:'bad',slots:[],cfg:{g:15,c:2}}, {v:1,schema:3,slots:[{s:1,c:[],sit:[]}],cfg:{g:15,c:2}}]){
      expect(()=>playerViewModel(value as unknown as SharePayload)).toThrow();
    }
  });
  it('does not mutate public payloads and rejects malformed explicit live lineups',()=>{
    const data=share(), before=JSON.stringify(data);
    playerViewModel(data);
    expect(JSON.stringify(data)).toBe(before);
    data.runtime!.live![0]!.players=['A','B'];
    expect(()=>playerViewModel(data)).toThrow('Invalid shared live lineup');
  });
  it('rejects a repeated resolved player in a live or planned game',()=>{
    const current=share();current.runtime!.live![0]!.players=['H','H','F','E'];
    expect(()=>playerViewModel(current)).toThrow('Invalid shared live lineup');
    const planned=share();planned.slots[1]!.c[0]=[[0,0],[2,6]];
    expect(()=>playerViewModel(planned)).toThrow('Invalid shared planned lineup');
    const duplicateNames=share();duplicateNames.p[4]=['Alex','M'];duplicateNames.p[5]=['Alex','M'];
    duplicateNames.runtime!.live![0]!.players=['Alex','Alex','G','H'];
    expect(playerViewModel(duplicateNames).current[0]!.teamA.map(player=>player.id)).toEqual(['e','f']);
  });
});

describe('player links',()=>{
  it('derives a player URL without organizer fragments and preserves unrelated parameters',()=>{
    const url=playerViewUrl('https://example.test/beta/?share=-abc_123&foo=bar#secret');
    expect(url).toBe('https://example.test/beta/?share=-abc_123&foo=bar&view=players');
    expect(playerShareId(new URL(url).search)).toBe('-abc_123');
    expect(playerShareId('?share=-abc_123')).toBeNull();
  });
  it.each(['','abc/def','abc.def','abc%23def','abc%20def'])('rejects missing or unsafe share IDs %s',id=>{
    expect(playerShareId(`?view=players&share=${id}`)).toBeNull();
    expect(()=>playerViewUrl(`https://example.test/?share=${id}`)).toThrow();
  });
  it('rejects non-web link protocols',()=>expect(()=>playerViewUrl('javascript:alert(1)?share=abc')).toThrow());
});
