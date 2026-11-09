// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { loadQualityWeights, saveQualityWeights } from './qualityPreferences';
import { DEFAULT_QUALITY_WEIGHTS } from './gameQuality';
afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); });
it('persists organizer matchup preferences in isolated beta storage', () => {
  vi.stubEnv('VITE_BETA', 'true');
  saveQualityWeights({ ...DEFAULT_QUALITY_WEIGHTS, levels: 20 });
  expect(loadQualityWeights().levels).toBe(20);
  expect(localStorage.getItem('beta:bp-quality-weights')).not.toBeNull();
  expect(localStorage.getItem('bp-quality-weights')).toBeNull();
});
it('recovers defaults from corrupt storage and validates stored numbers', () => {
  localStorage.setItem('bp-quality-weights', '{');
  expect(loadQualityWeights()).toEqual(DEFAULT_QUALITY_WEIGHTS);
  localStorage.setItem('bp-quality-weights', JSON.stringify({ levels: 300, gender: -2, partners: 'bad' }));
  expect(loadQualityWeights()).toEqual({ ...DEFAULT_QUALITY_WEIGHTS, levels: 100, gender: 0 });
});
