import type { Player } from '../algorithm/types';
import type { PlannerResult, WinLossMap } from '../types';
import { isSlotCompleted } from './liveQueue';
import type { GameRef } from './liveQueue';

export interface PlayerStats {
  name: string;
  gender: Player['gender'];
  played: number;
  rested: number;
  live: number;
  wins: number;
  losses: number;
}

function scheduledPlayers(result: PlannerResult, game: GameRef) {
  const court = result.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
  return court ? [...court.teamA, ...court.teamB].map(player => player.name) : [];
}

function actualPlayers(result: PlannerResult, game: GameRef) {
  return game.players?.length ? game.players : scheduledPlayers(result, game);
}

export function calculatePlayerStats(
  players: Player[],
  result: PlannerResult | null,
  completedGames: GameRef[],
  liveGames: GameRef[],
  winLoss: WinLossMap,
): PlayerStats[] {
  const stats = new Map(players.map(player => [player.name, {
    name: player.name,
    gender: player.gender,
    played: 0,
    rested: 0,
    live: 0,
    wins: winLoss[player.name]?.wins ?? 0,
    losses: winLoss[player.name]?.losses ?? 0,
  }]));
  if (!result) return [...stats.values()];

  for (const game of completedGames) {
    for (const name of actualPlayers(result, game)) {
      const stat = stats.get(name);
      if (stat) stat.played += 1;
    }
  }

  for (const game of liveGames) {
    for (const name of actualPlayers(result, game)) {
      const stat = stats.get(name);
      if (stat) stat.live += 1;
    }
  }

  const completedSlots = new Set(
    result.schedule
      .filter(slot => isSlotCompleted(slot, completedGames))
      .map(slot => slot.slot),
  );
  for (const slotNumber of completedSlots) {
    const slot = result.schedule.find(item => item.slot === slotNumber);
    if (!slot) continue;
    const playedInSlot = new Set(
      completedGames
        .filter(game => game.slot === slotNumber)
        .flatMap(game => actualPlayers(result, game)),
    );
    for (const player of slot.sitting) {
      const stat = stats.get(player.name);
      if (stat && !playedInSlot.has(player.name)) stat.rested += 1;
    }
  }

  return [...stats.values()];
}
