export interface GameRef {
  id?: string;
  slot: number;
  court: number;
  players?: string[];
  /** Physical live-court lane used for stable Current game ordering. */
  displayCourt?: number;
}

const LIVE_QUEUE_LOG_LIMIT = 500;
const liveQueueLogBuffer: Array<{ timestamp: string; label: string; details: Record<string, unknown> }> = [];

export function liveQueueDebug(label: string, details: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  liveQueueLogBuffer.push({ timestamp: new Date().toISOString(), label, details });
  if (liveQueueLogBuffer.length > LIVE_QUEUE_LOG_LIMIT) liveQueueLogBuffer.shift();
}

export function exportLiveQueueLogs() {
  return JSON.stringify({ exportedAt: new Date().toISOString(), buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown', logs: liveQueueLogBuffer }, null, 2);
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

export function initialLiveGamesForSchedule(
  result: { planId?: string; schedule: Array<{ slot: number; courts: Array<{ teamA: Array<{ id?: string; name: string }>; teamB: Array<{ id?: string; name: string }> }> }> },
  capacity: number,
): GameRef[] {
  const games: GameRef[] = [], busy = new Set<string>();
  for (const slot of result.schedule) for (const [court, lineup] of slot.courts.entries()) {
    if (games.length >= Math.max(0, Math.floor(capacity))) return games;
    const players = [...lineup.teamA, ...lineup.teamB];
    if (players.length !== 4 || players.some(p => busy.has(p.name))) continue;
    players.forEach(p => busy.add(p.name));
    games.push({ slot: slot.slot, court, players: players.map(p => p.name), ...(result.planId ? {
      displayCourt: games.length,
      id: JSON.stringify([result.planId, slot.slot, court, players.map(p => p.id ?? `legacy:${p.name.toLowerCase()}`)]),
    } : {}) });
  }
  return games;
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
    normalized.push({
      slot: game.slot,
      court: game.court,
      ...(game.players ? { players: [...game.players] } : {}),
      ...(game.displayCourt != null ? { displayCourt: game.displayCourt } : {}),
    });
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
