import type { Player } from '../algorithm/types';
export type IdentityPlayer = Pick<Player,'id'|'name'|'gender'|'aliases'|'statsKey'>;
export const identityNameKey=(name:string)=>name.toLocaleLowerCase().replace(/\s+/g,' ').trim();
export const newPlayerId=()=>`player-${crypto.randomUUID()}`;
export function resolvePlayerIdentity<T extends IdentityPlayer>(name:string, candidates:T[], id?:string):T|undefined {
 if(id) return candidates.find(p=>p.id===id);
 const matches=candidates.filter(p=>[p.name,...p.aliases??[]].some(n=>identityNameKey(n)===identityNameKey(name)));
 const unique=new Map<string,T>();
 for(const player of matches) {
  const key=player.id??`${identityNameKey(player.name)}:${player.gender}`;
  if(!unique.has(key)) unique.set(key,player);
 }
 return unique.size===1?[...unique.values()][0]:undefined;
}
export function normalizePlayerIdentities<T extends IdentityPlayer,U extends IdentityPlayer>(players:T[],playerHistory:U[]):{players:Array<T & IdentityPlayer>;playerHistory:Array<U & IdentityPlayer>} {
 const known:IdentityPlayer[]=[...players,...playerHistory].filter(p=>p.id);
 const normalize=<V extends IdentityPlayer>(p:V):V=>{
 const match=p.id ? known.find(k=>k.id===p.id) : resolvePlayerIdentity(p.name,known.filter(k=>k.gender===p.gender));
 const next={...p,id:p.id??match?.id??newPlayerId(),statsKey:p.statsKey??match?.statsKey??p.name};
 known.push(next);return next;
 };
 const roster=players.map(normalize);return {players:roster,playerHistory:playerHistory.map(normalize)};
}
export function patchPlayerMetadata<T extends IdentityPlayer>(player:T,patch:Partial<Pick<Player,'name'|'gender'>>):T {
 const name=patch.name?.trim()||player.name;
 return {...player,...patch,name,statsKey:player.statsKey??player.name,aliases:[...new Set([...(player.aliases??[]),...(name!==player.name?[player.name]:[])])]};
}
