/** Paths on GitHub Pages share an origin, so beta needs its own browser-storage keys. */
export function plannerStorageKey(key: string): string {
  return import.meta.env.VITE_BETA === 'true' ? `beta:${key}` : key;
}

/** Start beta from a one-time copy of existing personal data without changing main. */
export function seedBetaPlannerStorage(keys: string[]) {
  if (import.meta.env.VITE_BETA !== 'true') return;
  const marker = plannerStorageKey('bp-storage-seeded');
  try {
    if (localStorage.getItem(marker)) return;
    for (const key of keys) {
      const target = plannerStorageKey(key);
      const value = localStorage.getItem(key);
      if (localStorage.getItem(target) === null && value !== null) localStorage.setItem(target, value);
    }
    localStorage.setItem(marker, '1');
  } catch {
    // A blocked/full storage area must not prevent the planner from opening.
  }
}
