import { describe, it, expect } from 'vitest';
import { normalizePlayerIdentities, resolvePlayerIdentity, patchPlayerMetadata } from './playerIdentity';
describe('player identity', () => {
 it('migrates roster and bank once and preserves statistics key', () => {
 const legacy = { name:'Alice', gender:'F' as const, availFrom:0, availTo:8 };
 const a=normalizePlayerIdentities([legacy], [{name:'Alice',gender:'F' as const}]);
 expect(a.players[0]!.id).toBeTruthy(); expect(a.players[0]!.id).toBe(a.playerHistory[0]!.id);
 expect(a.players[0]!.statsKey).toBe('Alice');
 expect(normalizePlayerIdentities(a.players,a.playerHistory)).toEqual(a);
 });
 it('resolves aliases but refuses ambiguous names', () => {
 const bank=[{id:'a',name:'Alice',gender:'F' as const,aliases:['Al']},{id:'b',name:'Alan',gender:'M' as const,aliases:['Al']}];
 expect(resolvePlayerIdentity('Alice',bank)?.id).toBe('a');
 expect(resolvePlayerIdentity('Al',bank)).toBeUndefined();
 });
 it('changes current metadata without changing historical teams or statistics associations', () => {
 const p={id:'a',name:'Alice',gender:'F' as const,statsKey:'Alice',availFrom:0,availTo:8};
 const next=patchPlayerMetadata(p,{name:'Alicia',gender:'M'});
 expect(next).toMatchObject({id:'a',name:'Alicia',gender:'M',statsKey:'Alice',aliases:['Alice']});
 });
});

it('reuses a persistent bank ID when migrating a legacy roster',()=>{
 expect(normalizePlayerIdentities([{name:'Alice',gender:'F'}],[{id:'saved',name:'Alice',gender:'F'}]).players[0]!.id).toBe('saved');
});

it('prefers the first metadata record for one resolved identity without hiding ambiguity',()=>{
 const active={id:'a',name:'Alice',gender:'F' as const,aliases:['Al'],level:5,quarantined:true};
 const bank={...active,level:3,quarantined:false};
 expect(resolvePlayerIdentity('Al',[active,bank])).toBe(active);
 expect(resolvePlayerIdentity('Al',[active,bank,{...bank,id:'b'}])).toBeUndefined();
});
