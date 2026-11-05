import type { Player } from '../algorithm/types';
import type { PlannerResult, ScoresMap } from '../types';
import type { GameRef } from './liveQueue';
import { recomputeStats } from '../algorithm/scheduler';

/** Remove stale upcoming games without losing ongoing/history records or their scores. */
export function excludeQuarantinedGames(result: PlannerResult, players: Player[], liveGames: GameRef[], completedGames: GameRef[], scores: ScoresMap) {
  const excluded = new Set(players.filter(p => p.quarantined).map(p => p.name));
  const protectedKeys = new Set([...liveGames, ...completedGames].map(g => `${g.slot}:${g.court}`));
  const indices = new Map<string, number>();
  const schedule = result.schedule.map(slot => {
    const courts = slot.courts.flatMap((court, oldIndex) => {
      if (!protectedKeys.has(`${slot.slot}:${oldIndex}`) && [...court.teamA, ...court.teamB].some(p => excluded.has(p.name))) return [];
      return [{ court, oldIndex }];
    }).map(({ court, oldIndex }, index) => {
      indices.set(`${slot.slot}:${oldIndex}`, index);
      return index === oldIndex ? court : { ...court, court: index + 1 };
    });
    const stillPlaying = new Set(courts.flatMap(court => [...court.teamA, ...court.teamB].map(player => player.name)));
    const waiting = new Map([...slot.sitting, ...slot.courts.flatMap(court => [...court.teamA, ...court.teamB])]
      .filter(player => !excluded.has(player.name) && !stillPlaying.has(player.name))
      .map(player => [player.name, player]));
    return { ...slot, courts, sitting: [...waiting.values()],
      repeatedCourts: slot.repeatedCourts.flatMap(index => {
        const next = indices.get(`${slot.slot}:${index}`);
        return next == null ? [] : [next];
      }) };
  });
  const remapGames = (games: GameRef[]) => games.map(game => ({ ...game,
    court: indices.get(`${game.slot}:${game.court}`)!,
    // Keep the physical lane when a preceding unused court is removed.
    displayCourt: game.displayCourt ?? game.court,
  }));
  const nextScores: ScoresMap = {};
  for (const [key, value] of Object.entries(scores)) {
    const match = /^s(\d+)c(\d+)$/.exec(key);
    if (!match) { nextScores[key] = value; continue; }
    const index = indices.get(`${match[1]}:${match[2]}`);
    if (index != null) nextScores[`s${match[1]}c${index}`] = value;
  }
  return { result: { ...result, ...recomputeStats(schedule, players) }, liveGames: remapGames(liveGames), completedGames: remapGames(completedGames), scores: nextScores };
}
