import { extractState, recomputeStats } from '../algorithm/scheduler';
import type { Court, Player, ScheduleState, SlotResult } from '../algorithm/types';
import type { GameRef } from './liveQueue';

/** Keep the plan prefix intact, but derive rotation history only from runtime. */
export function extractRuntimeScheduleState(keptSlots: SlotResult[], players: Player[], actualGames: GameRef[]): ScheduleState {
  const roster = new Map(players.map(player => [player.name, player]));
  const refs = new Map(actualGames.map(game => [`${game.slot}:${game.court}`, game]));
  const actualSlots = keptSlots.flatMap(slot => {
    const courts = slot.courts.flatMap((court, index): Court[] => {
      const ref = refs.get(`${slot.slot}:${index}`);
      if (!ref) return [];
      if (ref.players?.length !== 4) return [court];
      const snapshots = ref.players.map(name => roster.get(name) ?? [...court.teamA, ...court.teamB].find(player => player.name === name) ?? { name, gender: 'M' as const });
      return [{ ...court, teamA: [snapshots[0]!, snapshots[1]!], teamB: [snapshots[2]!, snapshots[3]!] }];
    });
    if (courts.length === 0) return [];
    const playing = new Set(courts.flatMap(court => [...court.teamA, ...court.teamB].map(player => player.name)));
    return [{ ...slot, courts, sitting: players.filter(player => !playing.has(player.name) && !player.quarantined && player.availFrom <= slot.slot - 1 && player.availTo >= slot.slot - 1) }];
  });
  const state = extractState(recomputeStats(actualSlots, players).schedule, players);
  return { ...state, keptSlots };
}
