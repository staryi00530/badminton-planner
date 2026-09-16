import { describe, it, expect } from 'vitest';
import { computeSkill } from './skill.js';

describe('computeSkill', () => {
  it('defaults to 0.5 when the player has no record at all', () => {
    expect(computeSkill('Nobody', {})).toBe(0.5);
  });

  it('defaults to 0.5 when the player has a record but zero games', () => {
    expect(computeSkill('A', { A: { wins: 0, losses: 0 } })).toBe(0.5);
  });

  it('computes win rate from a mixed record', () => {
    expect(computeSkill('A', { A: { wins: 3, losses: 1 } })).toBe(0.75);
  });

  it('returns 1 for an undefeated record', () => {
    expect(computeSkill('A', { A: { wins: 5, losses: 0 } })).toBe(1);
  });

  it('returns 0 for an all-losses record', () => {
    expect(computeSkill('A', { A: { wins: 0, losses: 5 } })).toBe(0);
  });

  it('uses the private level as the starting rating when no results exist', () => {
    expect(computeSkill('Beginner', {}, 1)).toBe(0);
    expect(computeSkill('Advanced', {}, 3)).toBe(1);
  });
});
