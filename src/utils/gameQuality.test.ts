import { expect, it } from 'vitest';
import { scoreGameQuality } from './gameQuality';
import type { Court, Player } from '../algorithm/types';
const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: i % 2 ? 'F' : 'M', availFrom: 0, availTo: 8, level: 3 }));
const court: Court = { court: 1, teamA: [players[0]!, players[1]!], teamB: [players[2]!, players[3]!] };
it('never scores an ineligible game even with enormous fairness weights', () => {
  expect(scoreGameQuality(court, { players, slot: 1, busyNames: new Set(['P0']), waited: { P0: 100 } }, { waiting: 1e9 }).score).toBeNull();
});
it('explains actual waiting, gender format, private level, history and preferred pairs', () => {
  const result = scoreGameQuality(court, { players, slot: 1, waited: { P0: 2 }, history: [court], preferredPairs: [['P0', 'P1']] });
  expect(result.eligible).toBe(true);
  expect(result.breakdown.waiting.raw).toBe(2);
  expect(result.format).toBe('MF vs MF');
  expect(result.breakdown.partners.raw).toBe(-2);
  expect(result.breakdown.opponents.raw).toBe(-4);
  expect(result.breakdown.preferred.raw).toBe(1);
  expect(result.score).toBe(Object.values(result.breakdown).reduce((sum, item) => sum + item.points, 0));
});
