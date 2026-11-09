import { expect, it } from 'vitest';
import { scoreGameQuality } from './gameQuality';
import type { Court, Player } from '../algorithm/types';
const players: Player[] = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, gender: i % 2 ? 'F' : 'M', availFrom: 0, availTo: 8, level: 3 }));
const court: Court = { court: 1, teamA: [players[0]!, players[1]!], teamB: [players[2]!, players[3]!] };
it('scores matchups independently of waiting and current busy status', () => {
  const plain = scoreGameQuality(court, { players, slot: 1 });
  const busy = scoreGameQuality(court, { players, slot: 1, busyNames: new Set(['P0']), waited: { P0: 100 } }, { waiting: 1e9 });
  expect(busy.score).toBe(plain.score);
  expect(busy.eligible).toBe(false);
  expect(busy.rotation.gamesWaited.P0).toBe(100);
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
it('uses permanent identity and legacy aliases across renamed history', () => {
  const original = players.map((p, i) => ({ ...p, id: `id${i}` }));
  const old: Court = { ...court, teamA: [original[0]!, original[1]!], teamB: [original[2]!, original[3]!] };
  const renamed = original.map(p => ({ ...p, name: `New ${p.name}`, aliases: [p.name] }));
  const next: Court = { ...court, teamA: [renamed[0]!, renamed[1]!], teamB: [renamed[2]!, renamed[3]!] };
  expect(scoreGameQuality(next, { players: renamed, slot: 1, history: [old] }).breakdown.partners.raw).toBe(-2);
  expect(scoreGameQuality(next, { players: renamed, slot: 1, history: [court] }).breakdown.opponents.raw).toBe(-4);
});
