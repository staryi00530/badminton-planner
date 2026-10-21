import type { PlannerResult, ScoresMap } from '../types';
import type { GameRef } from './liveQueue';

export interface PairingRecord {
  name: string;
  games: number;
  lastGame: { number: number; slot: number; court: number };
}

export function completedGameLineup(game: GameRef, result: PlannerResult | null): string[] {
  if (game.players != null) return game.players;
  const court = result?.schedule.find(slot => slot.slot === game.slot)?.courts[game.court];
  return court ? [...court.teamA, ...court.teamB].map(player => player.name) : [];
}

export function calculatePairingHistory(playerName: string, completedGames: GameRef[], scores: ScoresMap, result: PlannerResult | null = null) {
  const teammates = new Map<string, PairingRecord>();
  const opponents = new Map<string, PairingRecord>();

  completedGames.forEach((game, index) => {
    const score = scores[`s${game.slot}c${game.court}`];
    const lineup = completedGameLineup(game, result);
    const teamA = score?.teamA?.length === 2 ? score.teamA : lineup.slice(0, 2);
    const teamB = score?.teamB?.length === 2 ? score.teamB : lineup.slice(2, 4);
    if (teamA.length !== 2 || teamB.length !== 2) return;

    const playerTeam = teamA.includes(playerName) ? teamA : teamB.includes(playerName) ? teamB : null;
    if (!playerTeam) return;
    const otherTeam = playerTeam === teamA ? teamB : teamA;
    const lastGame = { number: index + 1, slot: game.slot, court: game.court };

    const addEncounters = (counts: Map<string, PairingRecord>, names: string[]) => {
      for (const name of names) {
        if (name === playerName) continue;
        const prior = counts.get(name);
        counts.set(name, { name, games: (prior?.games ?? 0) + 1, lastGame });
      }
    };

    addEncounters(teammates, playerTeam);
    addEncounters(opponents, otherTeam);
  });

  const sortRecords = (counts: Map<string, PairingRecord>) => [...counts.values()]
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  return { teammates: sortRecords(teammates), opponents: sortRecords(opponents) };
}
