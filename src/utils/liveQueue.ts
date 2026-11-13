export interface GameRef {
  /** Actual activation time, independent of nominal slot time. */
  startedAt?: number;
  id?: string;
  slot: number;
  court: number;
  players?: string[];
  /** Physical live-court lane used for stable Current game ordering. */
  displayCourt?: number;
}

const LIVE_QUEUE_LOG_LIMIT = 2000;
const liveQueueLogBuffer: Array<{ sequence: number; timestamp: string; label: string; details: Record<string, unknown> }> = [];
let liveQueueLogSequence = 0;
let liveQueueDroppedEntries = 0;

export function liveQueueDebug(label: string, details: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  let snapshot: Record<string, unknown>;
  try { snapshot = JSON.parse(JSON.stringify(details)) as Record<string, unknown>; }
  catch { snapshot = { diagnosticError: 'Details could not be serialized' }; }
  liveQueueLogBuffer.push({ sequence: ++liveQueueLogSequence, timestamp: new Date().toISOString(), label, details: snapshot });
  if (liveQueueLogBuffer.length > LIVE_QUEUE_LOG_LIMIT) { liveQueueLogBuffer.shift(); liveQueueDroppedEntries++; }
}

export function exportLiveQueueLogs() {
  return JSON.stringify({ formatVersion: 2, exportedAt: new Date().toISOString(), buildTime: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown',
    retention: { limit: LIVE_QUEUE_LOG_LIMIT, retained: liveQueueLogBuffer.length, dropped: liveQueueDroppedEntries,
      firstSequence: liveQueueLogBuffer[0]?.sequence ?? null, lastSequence: liveQueueLogBuffer.at(-1)?.sequence ?? null },
    logs: liveQueueLogBuffer }, null, 2);
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
  startedAt?: number,
): GameRef[] {
  const games: GameRef[] = [], busy = new Set<string>();
  for (const slot of result.schedule) for (const [court, lineup] of slot.courts.entries()) {
    if (games.length >= Math.max(0, Math.floor(capacity))) return games;
    const players = [...lineup.teamA, ...lineup.teamB];
    if (players.length !== 4 || players.some(p => busy.has(p.name))) continue;
    players.forEach(p => busy.add(p.name));
    games.push({ ...(validStartTime(startedAt) ? { startedAt } : {}), slot: slot.slot, court, players: players.map(p => p.name), ...(result.planId ? {
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
      ...(typeof game.id === 'string' && game.id ? { id: game.id } : {}),
      slot: game.slot,
      court: game.court,
      ...(game.players ? { players: [...game.players] } : {}),
      ...(game.displayCourt != null ? { displayCourt: game.displayCourt } : {}),
      ...(validStartTime(game.startedAt) ? { startedAt: game.startedAt } : {}),
    });
    if (normalized.length >= maxCount) break;
  }
  return normalized;
}

function validStartTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Start the prepared courts together without restarting any already-running clock. */
export function startUntimedLiveGames(games: GameRef[], now = Date.now()): GameRef[] {
  return games.map(game => validStartTime(game.startedAt) ? game : { ...game, startedAt: now });
}

/** Only activation creates a timer; legacy already-live games keep an unknown start. */
export function stampNewLiveGames(games: GameRef[], previous: GameRef[], now = Date.now()): GameRef[] {
  return games.map(game => {
    const before = previous.find(old => gameMatches(old, game.slot, game.court));
    const startedAt = validStartTime(before?.startedAt) ? before.startedAt
      : validStartTime(game.startedAt) ? game.startedAt : before ? undefined : now;
    return { ...game, ...(validStartTime(startedAt) ? { startedAt } : {}) };
  });
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
