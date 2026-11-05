import { describe, expect, it } from 'vitest';
import type { Player, SlotResult } from '../algorithm/types';
import { excludeQuarantinedGames } from './quarantine';

describe('quarantine cleanup accounting', () => {
  it('does not count removed games as played and returns their eligible teammates to waiting', () => {
    const players: Player[] = Array.from({ length: 8 }, (_, index) => ({ name: `P${index + 1}`, gender: 'M', availFrom: 0, availTo: 1, quarantined: index === 0 }));
    const schedule: SlotResult[] = [1, 2].map(slot => ({
      slot,
      courts: [
        { court: 1, teamA: [players[0]!, players[1]!], teamB: [players[2]!, players[3]!] },
        { court: 2, teamA: [players[4]!, players[5]!], teamB: [players[6]!, players[7]!] },
      ],
      sitting: [], repeatedCourts: [],
      playerState: players.map(player => ({ name: player.name, gender: player.gender, total: slot, conPlayed: slot, conRested: 0, playing: true, available: true })),
    }));
    const cleaned = excludeQuarantinedGames({ schedule, gamesPlayed: Array(8).fill(2) }, players,
      [{ slot: 1, court: 1 }], [{ slot: 2, court: 1 }], { s1c1: { a: '12', b: '10', applied: false, teamA: ['P5', 'P6'], teamB: ['P7', 'P8'] } });
    expect(cleaned.result.gamesPlayed).toEqual([0, 0, 0, 0, 2, 2, 2, 2]);
    expect(cleaned.result.schedule[0]!.sitting.map(player => player.name)).toEqual(['P2', 'P3', 'P4']);
    expect(cleaned.result.schedule[1]!.playerState[1]).toMatchObject({ name: 'P2', total: 0, conPlayed: 0, conRested: 2 });
    expect(cleaned.result.schedule[1]!.playerState[4]).toMatchObject({ name: 'P5', total: 2, conPlayed: 2 });
    expect(cleaned.scores.s1c0).toEqual({ a: '12', b: '10', applied: false, teamA: ['P5', 'P6'], teamB: ['P7', 'P8'] });
  });
});
