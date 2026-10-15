import { describe, expect, it } from 'vitest';
import { calculatePlayerStats } from './playerStats';

const player = (name: string, gender: 'M' | 'F' = 'M') => ({ name, gender, availFrom: 0, availTo: 9 });

describe('calculatePlayerStats', () => {
  it('counts actual games, rotations rested, live games, and recorded results', () => {
    const result = {
      schedule: [
        { slot: 1, courts: [{ court: 1, teamA: [player('A'), player('B')], teamB: [player('C'), player('D')] }], sitting: [player('E')], repeatedCourts: [], playerState: [] },
        { slot: 2, courts: [{ court: 1, teamA: [player('A'), player('E')], teamB: [player('C'), player('D')] }], sitting: [player('B')], repeatedCourts: [], playerState: [] },
      ],
      gamesPlayed: [],
    };

    const stats = calculatePlayerStats(
      [player('A'), player('B'), player('C'), player('D'), player('E')],
      result,
      [{ slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] }],
      [{ slot: 2, court: 0, players: ['A', 'E', 'C', 'D'] }],
      { A: { wins: 1, losses: 0 }, C: { wins: 0, losses: 1 }, D: { wins: 0, losses: 1 } },
    );

    expect(stats).toEqual([
      { name: 'A', gender: 'M', played: 1, rested: 0, live: 1, wins: 1, losses: 0 },
      { name: 'B', gender: 'M', played: 1, rested: 0, live: 0, wins: 0, losses: 0 },
      { name: 'C', gender: 'M', played: 1, rested: 0, live: 1, wins: 0, losses: 1 },
      { name: 'D', gender: 'M', played: 1, rested: 0, live: 1, wins: 0, losses: 1 },
      { name: 'E', gender: 'M', played: 0, rested: 1, live: 1, wins: 0, losses: 0 },
    ]);
  });
});
