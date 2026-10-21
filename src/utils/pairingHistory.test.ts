import { describe, expect, it } from 'vitest';
import { calculatePairingHistory } from './pairingHistory';

describe('calculatePairingHistory', () => {
  it('counts actual teammates and opponents and remembers their most recent game', () => {
    const history = calculatePairingHistory('A', [
      { slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] },
      { slot: 2, court: 1, players: ['A', 'C', 'B', 'E'] },
      { slot: 3, court: 0, players: ['A', 'B', 'C', 'F'] },
    ], {});

    expect(history.teammates).toEqual([
      { name: 'B', games: 2, lastGame: { number: 3, slot: 3, court: 0 } },
      { name: 'C', games: 1, lastGame: { number: 2, slot: 2, court: 1 } },
    ]);
    expect(history.opponents).toEqual([
      { name: 'C', games: 2, lastGame: { number: 3, slot: 3, court: 0 } },
      { name: 'B', games: 1, lastGame: { number: 2, slot: 2, court: 1 } },
      { name: 'D', games: 1, lastGame: { number: 1, slot: 1, court: 0 } },
      { name: 'E', games: 1, lastGame: { number: 2, slot: 2, court: 1 } },
      { name: 'F', games: 1, lastGame: { number: 3, slot: 3, court: 0 } },
    ]);
  });

  it('uses recorded score teams when available and ignores incomplete lineups', () => {
    const history = calculatePairingHistory('A', [
      { slot: 1, court: 0, players: ['A', 'B', 'C', 'D'] },
      { slot: 2, court: 0, players: ['A', 'B'] },
    ], {
      s1c0: { a: '21', b: '18', applied: true, teamA: ['A', 'C'], teamB: ['B', 'D'] },
    });

    expect(history.teammates).toEqual([
      { name: 'C', games: 1, lastGame: { number: 1, slot: 1, court: 0 } },
    ]);
    expect(history.opponents.map(item => item.name)).toEqual(['B', 'D']);
  });

  it('falls back to the planned lineup for legacy completed-game records without snapshots', () => {
    const history = calculatePairingHistory('A', [{ slot: 1, court: 0 }], {}, {
      schedule: [{
        slot: 1,
        courts: [{
          court: 1,
          teamA: [{ name: 'A', gender: 'F' }, { name: 'B', gender: 'M' }],
          teamB: [{ name: 'C', gender: 'F' }, { name: 'D', gender: 'M' }],
        }],
        sitting: [], playerState: [], repeatedCourts: [],
      }],
      gamesPlayed: [],
    });

    expect(history.teammates.map(item => item.name)).toEqual(['B']);
    expect(history.opponents.map(item => item.name)).toEqual(['C', 'D']);
  });
});
