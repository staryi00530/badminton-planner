import type { PlannerResult } from '../types';
import type { GameRef } from './liveQueue';

type Person = { id?: string; name: string };
export interface LiveEditConflict {
  name: string;
  editedGame: GameRef;
  otherGame: GameRef;
  editedLineup: string[];
  otherLineup: string[];
}

/** Compare actual live occupancy, allowing edits which only remove existing collisions. */
export function newLiveEditConflicts(result: PlannerResult, games: GameRef[], editedSlot: number, courts: string[][], roster: Person[] = []): LiveEditConflict[] {
  const scheduled = (game: GameRef): Person[] => {
    const court=result.schedule.find(slot=>slot.slot===game.slot)?.courts[game.court];
    return court ? [...court.teamA,...court.teamB] : [];
  };
  const names = (game: GameRef) => game.players?.length===4 ? game.players : scheduled(game).map(player=>player.name);
  const known = [...roster,...result.schedule.flatMap(slot=>slot.courts.flatMap(court=>[...court.teamA,...court.teamB]))];
  const idsByName=new Map<string,Set<string>>();
  for(const person of known)if(person.id){
    const ids=idsByName.get(person.name) ?? new Set<string>();ids.add(person.id);idsByName.set(person.name,ids);
  }
  // A retained pre-rename snapshot may still carry the old public name. Its
  // stable scheduled position supplies an alias when that name has no ID now.
  for(const game of games)names(game).forEach((name,index)=>{
    const id=scheduled(game)[index]?.id;
    if(id&&!idsByName.has(name))idsByName.set(name,new Set([id]));
  });
  const identity=(name:string)=>{
    const ids=idsByName.get(name);
    return ids?.size===1 ? `id:${[...ids][0]}` : `name:${name}`;
  };
  const conflicts:LiveEditConflict[]=[];
  for(const editedGame of games.filter(game=>game.slot===editedSlot)){
    const before=new Set(names(editedGame).map(identity));
    const editedLineup=courts[editedGame.court] ?? [];
    for(const otherGame of games.filter(game=>game.slot!==editedSlot)){
      const otherLineup=names(otherGame), busy=new Set(otherLineup.map(identity));
      const seen=new Set<string>();
      for(const name of editedLineup){
        const key=identity(name);
        if(busy.has(key)&&!before.has(key)&&!seen.has(key)){
          conflicts.push({name,editedGame,otherGame,editedLineup:[...editedLineup],otherLineup:[...otherLineup]});seen.add(key);
        }
      }
    }
  }
  return conflicts;
}
