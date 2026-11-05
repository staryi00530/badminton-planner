import type { Player, PlannerState } from '../types';
import { patchPlayerMetadata } from './playerIdentity';

type MetadataState = Pick<PlannerState,
  'result' | 'scores' | 'liveGames' | 'completedGames' | 'suspendedPlayerNames' |
  'preferredPairs' | 'editLayout' | 'playerHistory'>;

/** Compatibility key for existing name-keyed win/loss records. */
export function playerStatsKey(player: Pick<Player, 'name' | 'statsKey'>): string {
  return player.statsKey ?? player.name;
}

/** Changes display metadata in place in each lineup; never invokes generation or scoring. */
export function playerMetadataPatch(state: MetadataState, before: Player, after: Player): Partial<PlannerState> {
  const matches = (player: { id?: string; name: string }) =>
    player.id && before.id ? player.id === before.id : player.name === before.name;
  const rename = (name: string) => name === before.name ? after.name : name;
  const metadata = <T extends { id?: string; name: string; gender: Player['gender'] }>(player: T): T =>
    matches(player) ? { ...player, ...(after.id ? { id: after.id } : {}), name: after.name, gender: after.gender,
      statsKey: after.statsKey ?? before.statsKey ?? before.name } : player;
  const refs = (games: MetadataState['liveGames']) => games.map(game => ({ ...game,
    ...(game.players ? { players: game.players.map(rename) } : {}),
  }));
  return {
    result: state.result ? { ...state.result, preserveLineups: true, schedule: state.result.schedule.map(slot => ({ ...slot,
      courts: slot.courts.map(court => ({ ...court,
        teamA: court.teamA.map(metadata) as typeof court.teamA,
        teamB: court.teamB.map(metadata) as typeof court.teamB,
      })),
      sitting: slot.sitting.map(metadata), playerState: slot.playerState.map(metadata),
    })) } : null,
    scores: Object.fromEntries(Object.entries(state.scores).map(([key, score]) => [key, {
      ...score, teamA: score.teamA.map(rename), teamB: score.teamB.map(rename),
    }])),
    liveGames: refs(state.liveGames), completedGames: refs(state.completedGames),
    suspendedPlayerNames: state.suspendedPlayerNames.map(rename),
    preferredPairs: state.preferredPairs.map(pair => pair.map(rename) as typeof pair),
    editLayout: state.editLayout ? {
      ...state.editLayout, courts: state.editLayout.courts.map(court => court.map(rename)),
      sitting: state.editLayout.sitting.map(rename),
    } : null,
    playerHistory: state.playerHistory.map(player => matches(player) ? {
      ...patchPlayerMetadata(player, { name: after.name, gender: after.gender }),
      ...(after.id ? { id: after.id } : {}),
      aliases: [...new Set([...(player.aliases ?? []), ...(after.aliases ?? []), ...(before.name !== after.name ? [before.name] : [])])],
      statsKey: player.statsKey ?? before.statsKey ?? before.name,
    } : player),
  };
}
