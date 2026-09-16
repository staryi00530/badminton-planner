import { useCallback } from 'react';
import { DEFAULT_PLAYERS } from '../constants';

/** Roster + player-bank management: adding/removing players, bulk-adding from the bank, editing fields. */
export function usePlayerRoster({ players, playerHistory, nameInput, genderInput, levelInput, totalSlots, patchState }) {
  const loadDefaults = useCallback(() => {
    const existing = new Set(players.map(p => p.name.toLowerCase()));
    const toAdd = DEFAULT_PLAYERS.filter(p => !existing.has(p.name.toLowerCase()));
    if (toAdd.length === 0) return;
    patchState({
      players: [
        ...players,
        ...toAdd.map(p => ({ ...p, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null })),
      ],
      result: null,
    });
  }, [players, totalSlots]);

  const resetPlayers = useCallback(() => {
    patchState({
      players: DEFAULT_PLAYERS.map(p => ({ ...p, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null })),
      result: null,
    });
  }, [totalSlots]);

  const clearPlayers = useCallback(() => patchState({ players: [], result: null }), []);

  const addPlayer = useCallback(() => {
    const name = nameInput.trim();
    if (!name || players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
    patchState({
      players: [...players, { name, gender: genderInput, level: levelInput, skill: 2, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null }],
      nameInput: '',
    });
  }, [genderInput, levelInput, nameInput, players, totalSlots]);

  const addSelectedFromBank = useCallback((entries) => {
    const existing = new Set(players.map(p => p.name.toLowerCase()));
    const toAdd = entries.filter(e => !existing.has(e.name.toLowerCase()));
    if (toAdd.length === 0) return;
    patchState({
      players: [...players, ...toAdd.map(e => ({ name: e.name, gender: e.gender, level: e.level ?? 2, skill: 2, availFrom: 0, availTo: totalSlots - 1, group: 'full', leavesAt: null }))],
    });
  }, [players, totalSlots]);

  const addToBank = useCallback((name, gender) => {
    const trimmed = name.trim();
    if (!trimmed || playerHistory.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) return;
    patchState({ playerHistory: [...playerHistory, { name: trimmed, gender }] });
  }, [playerHistory]);

  const removeFromHistory = useCallback((name) => {
    patchState({ playerHistory: playerHistory.filter(p => p.name.toLowerCase() !== name.toLowerCase()) });
  }, [playerHistory]);

  const removePlayer = useCallback((idx) => {
    patchState({ players: players.filter((_, i) => i !== idx), result: null });
  }, [players]);

  const updatePlayer = useCallback((idx, field, value) => {
    patchState({
      players: players.map((p, i) => i === idx ? { ...p, [field]: value } : p),
      result: null,
    });
  }, [players]);

  return {
    loadDefaults,
    resetPlayers,
    clearPlayers,
    addPlayer,
    addSelectedFromBank,
    addToBank,
    removeFromHistory,
    removePlayer,
    updatePlayer,
  };
}
