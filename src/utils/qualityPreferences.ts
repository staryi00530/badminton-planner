import { DEFAULT_QUALITY_WEIGHTS, type QualityWeights } from './gameQuality';
import { plannerStorageKey } from './plannerStorage';

const STORAGE_KEY = 'bp-quality-weights';
function normalize(value: unknown): QualityWeights {
  const weights = { ...DEFAULT_QUALITY_WEIGHTS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return weights;
  for (const key of Object.keys(weights) as Array<keyof QualityWeights>) {
    if (key === 'waiting') continue;
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === 'number' && Number.isFinite(number)) weights[key] = Math.max(0, Math.min(100, number));
  }
  return weights;
}
export function loadQualityWeights(): QualityWeights {
  try { return normalize(JSON.parse(localStorage.getItem(plannerStorageKey(STORAGE_KEY)) ?? 'null')); }
  catch { return { ...DEFAULT_QUALITY_WEIGHTS }; }
}
export function saveQualityWeights(weights: QualityWeights): void {
  try { localStorage.setItem(plannerStorageKey(STORAGE_KEY), JSON.stringify(normalize(weights))); }
  catch { /* Unavailable browser storage must not block the session. */ }
}
