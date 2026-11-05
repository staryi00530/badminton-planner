import type { Player, SlotResult } from '../algorithm/types';
import type { GameRef } from './liveQueue';

/** Completed game events waited during attendance, reset by actual play/live. */
export function actualGamesWaited(schedule: SlotResult[], players: Player[], completed: GameRef[], live: GameRef[]): Record<string, number> {
  const namesFor = (game: GameRef) => {
    if (game.players?.length === 4) return game.players;
    const court = schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
    return court ? [...court.teamA, ...court.teamB].map(player => player.name) : [];
  };
  const waited: Record<string, number> = Object.fromEntries(players.map(player => [player.name, 0]));
  for (const game of completed) {
    const names = namesFor(game);
    if (names.length !== 4) continue;
    const played = new Set(names);
    for (const player of players) {
      if (played.has(player.name)) waited[player.name] = 0;
      else if (!player.quarantined && player.availFrom <= game.slot - 1 && Math.min(player.availTo, player.leavesAt ?? Infinity) >= game.slot - 1) waited[player.name] = (waited[player.name] ?? 0) + 1;
    }
  }
  for (const game of live) for (const name of namesFor(game)) waited[name] = 0;
  return waited;
}
