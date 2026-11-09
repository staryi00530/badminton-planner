import { expect, it } from 'vitest';
import { matchingWaitingGroups } from './formatGroups';
it('packs only two matching waiting groups from twelve waiting players with odd female count', () => {
  const ids = Array.from({ length: 32 }, (_, i) => i);
  const groups = matchingWaitingGroups(ids, new Set(ids.slice(0, 12)), i => i < 5 || i >= 20, 5)!;
  expect(groups).toHaveLength(5);
  expect(new Set(groups.flat()).size).toBe(20);
  expect(groups.every(g => g.filter(i => i < 5 || i >= 20).length % 2 === 0)).toBe(true);
  expect(groups.filter(g => g.every(i => i < 12))).toHaveLength(2);
});
