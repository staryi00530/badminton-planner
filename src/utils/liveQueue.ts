export interface GameRef {
  slot: number;
  court: number;
}

export function liveQueueDebug(label: string, details: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || window.localStorage?.getItem('bp-debug-live-queue') !== 'true') return;
  console.log(`[live-queue] ${label}`, details);
}

export function gameMatches(game: GameRef, slot: number, court: number) {
  return game.slot === slot && game.court === court;
}

export function hasGame(games: GameRef[], slot: number, court: number) {
  return games.some(game => gameMatches(game, slot, court));
}

export function addUniqueGame(games: GameRef[], game: GameRef) {
  return hasGame(games, game.slot, game.court) ? games : [...games, game];
}

export function normalizeGameRefs(
  games: GameRef[],
  schedule: Array<{ slot: number; courts: unknown[] }> | null,
  maxCount = Number.POSITIVE_INFINITY,
) {
  const seen = new Set<string>();
  const normalized: GameRef[] = [];
  for (const game of games) {
    const slot = schedule?.find(item => item.slot === game.slot);
    if (!slot?.courts[game.court]) continue;
    const key = `${game.slot}:${game.court}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ slot: game.slot, court: game.court });
    if (normalized.length >= maxCount) break;
  }
  return normalized;
}

export function contiguousGamesForSlot(games: GameRef[], slotNum: number) {
  const inSlot = games.filter(game => game.slot === slotNum).sort((a, b) => a.court - b.court);
  return inSlot.length > 0 && inSlot.every((game, index) => game.court === index) ? inSlot : null;
}

export function keepGamesBeforeSlot(games: GameRef[], slot: number) {
  return games.filter(game => game.slot < slot);
}

export function isSlotCompleted(slot: { slot: number; courts: unknown[] }, games: GameRef[]) {
  return slot.courts.length > 0 && slot.courts.every((_, court) => hasGame(games, slot.slot, court));
}

export function firstIncompleteSlot(
  schedule: Array<{ slot: number; courts: unknown[] }>,
  games: GameRef[],
  finishedSlot: number,
) {
  return schedule.find(slot => !isSlotCompleted(slot, games))?.slot ?? finishedSlot + 1;
}
