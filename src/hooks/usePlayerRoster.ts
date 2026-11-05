import { newPlayerId, patchPlayerMetadata, resolvePlayerIdentity } from '../utils/playerIdentity';
import type { ImportedPlayer } from '../utils/rosterPaste';
import { useCallback } from 'react';
import { DEFAULT_PLAYERS } from '../constants';
import { buildImportedPlayers } from '../utils/rosterPaste';
import type { Player, PlannerState } from '../types';

interface PlayerRosterOptions extends Pick<PlannerState, 'players' | 'playerHistory' | 'nameInput' | 'genderInput'> {
  onPlayerMetadataChange?: (before: Player, after: Player) => Partial<PlannerState>;
  levelInput?: Player['level'];
  totalSlots: number;
  scheduleActive?: boolean;
  patchState: (patch: Partial<PlannerState>) => void;
}

/** Roster + player-bank management: adding/removing players, bulk-adding from the bank, editing fields. */
export function usePlayerRoster({ players, playerHistory, nameInput, genderInput, levelInput = 3, totalSlots, scheduleActive = false, patchState, onPlayerMetadataChange }: PlayerRosterOptions) {
  const loadDefaults = useCallback(() => {
    const existing = new Set(players.map(p => p.name.toLowerCase()));
    const toAdd = DEFAULT_PLAYERS.filter(p => !existing.has(p.name.toLowerCase()));
    if (toAdd.length === 0) return;
    patchState({
      players: [
        ...players,
        ...toAdd.map(p => ({ ...p, id: resolvePlayerIdentity(p.name, [...players,...playerHistory])?.id ?? newPlayerId(), statsKey: p.name, level: p.level ?? 3, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null })),
      ],
      result: null,
    });
  }, [players, totalSlots]);

  const resetPlayers = useCallback(() => {
    patchState({
      players: DEFAULT_PLAYERS.map(p => ({ ...p, id: resolvePlayerIdentity(p.name, [...players,...playerHistory])?.id ?? newPlayerId(), statsKey: p.name, level: p.level ?? 3, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null })),
      result: null,
    });
  }, [totalSlots]);

  const clearPlayers = useCallback(() => patchState({ players: [], result: null }), []);

  const addPlayer = useCallback(() => {
    const name = nameInput.trim();
    if (!name || players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
    patchState({
      players: [...players, ...buildImportedPlayers([],playerHistory,[{name,gender:genderInput,level:levelInput}],totalSlots)],
      nameInput: '',
      undoSnapshot: null,
      ...(scheduleActive ? { scheduleDirty: true } : {}),
    });
  }, [genderInput, levelInput, nameInput, players, playerHistory, scheduleActive, totalSlots]);

  const addSelectedFromBank = useCallback((entries: PlannerState['playerHistory']) => {
    const existing = new Set(players.map(p => p.name.toLowerCase()));
    const toAdd = entries.filter(e => !existing.has(e.name.toLowerCase()));
    if (toAdd.length === 0) return;
    patchState({
      players: [...players, ...toAdd.map(e => ({ ...e, id: e.id ?? newPlayerId(), statsKey: e.statsKey ?? e.name, name: e.name, gender: e.gender, level: e.level ?? 3, skill: 2, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null }))],
      undoSnapshot: null,
      ...(scheduleActive ? { scheduleDirty: true } : {}),
    });
  }, [players, scheduleActive, totalSlots]);

  const addImportedPlayers = useCallback((entries: ImportedPlayer[]) => {
    const replacement = buildImportedPlayers([], [...players, ...playerHistory], entries, totalSlots);
    if (replacement.length === 0) return;
    patchState({
      players: replacement,
      ...(playerHistory.some(p=>replacement.some(r=>r.id===p.id && JSON.stringify(r.aliases??[])!==JSON.stringify(p.aliases??[]))) ? {playerHistory:playerHistory.map(p=>{
        const imported=replacement.find(r=>p.id&&r.id===p.id);return imported?{...p,aliases:imported.aliases}:p;
      })}:{}),
      undoSnapshot: null,
      ...(scheduleActive ? { scheduleDirty: true } : { result: null }),
    });
  }, [patchState, playerHistory, players, scheduleActive, totalSlots]);

  const addToBank = useCallback((name: string, gender: Player['gender']) => {
    const trimmed = name.trim();
    if (!trimmed || playerHistory.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) return;
    const known=resolvePlayerIdentity(trimmed,players);
    patchState({ playerHistory: [...playerHistory, known ? {id:known.id??newPlayerId(),statsKey:known.statsKey??known.name,name:known.name,gender:known.gender,level:known.level??3,aliases:known.aliases,quarantined:known.quarantined} : { id: newPlayerId(), statsKey: trimmed, name: trimmed, gender, level: 3 }] });
  }, [playerHistory, players]);

  const removeFromHistory = useCallback((name: string) => {
    patchState({ playerHistory: playerHistory.filter(p => p.name.toLowerCase() !== name.toLowerCase()) });
  }, [playerHistory]);

  const removePlayer = useCallback((idx: number) => {
    patchState({ players: players.filter((_, i) => i !== idx), undoSnapshot: null, ...(scheduleActive ? { scheduleDirty: true } : { result: null }) });
  }, [players, scheduleActive]);

  const updatePlayer = useCallback((idx: number, field: 'name' | 'gender' | 'level' | 'group' | 'availFrom' | 'availTo' | 'leavesAt', value: string | number | null) => {
    if (field === 'level') {
      const before=players[idx];
      if(!before || typeof value!=='number' || ![1,2,3,4,5].includes(value)) return;
      const level=value as NonNullable<Player['level']>;
      const bankMatch=resolvePlayerIdentity(before.name,playerHistory,before.id);
      const metadata={id:before.id??bankMatch?.id??newPlayerId(),name:before.name,gender:before.gender,
        statsKey:before.statsKey??bankMatch?.statsKey??before.name,
        aliases:[...new Set([...(bankMatch?.aliases??[]),...(before.aliases??[])])],
        ...(before.quarantined!==undefined?{quarantined:before.quarantined}:{}),level};
      patchState({players:players.map((player,i)=>i===idx?{...player,id:metadata.id,level}:player),
        playerHistory:bankMatch?playerHistory.map(player=>player===bankMatch?{...player,...metadata}:player):[...playerHistory,metadata],
        undoSnapshot:null});
      return;
    }
    if (field === 'name' || field === 'gender') {
      const before=players[idx]; if(!before) return;
      if(field==='name' && (!String(value).trim() || players.some((p,i)=>i!==idx && p.name.toLocaleLowerCase()===String(value).trim().toLocaleLowerCase()))) return;
      const after=patchPlayerMetadata(before, {[field]: value} as Partial<Pick<Player,'name'|'gender'>>);
      patchState({players:players.map((p,i)=>i===idx?after:p), playerHistory:playerHistory.map(p=>(before.id?p.id===before.id:p.name===before.name)?{...p,...after}:p), undoSnapshot:null, ...onPlayerMetadataChange?.(before,after)});
      return;
    }
    patchState({
      players: players.map((p, i) => i === idx ? { ...p, [field]: value } : p),
      undoSnapshot: null,
      ...(scheduleActive ? { scheduleDirty: true } : { result: null }),
    });
  }, [players, playerHistory, scheduleActive, onPlayerMetadataChange, patchState]);

  return {
    loadDefaults,
    resetPlayers,
    clearPlayers,
    addPlayer,
    addSelectedFromBank,
    addImportedPlayers,
    addToBank,
    removeFromHistory,
    removePlayer,
    updatePlayer,
  };
}
