import type { PlayedGame, PlayedPlayer } from './playedHistory';

/** Whitelist public history fields; local balancing metadata is never serialized. */
export function publicPlayedGames(value: unknown): PlayedGame[] {
  const invalid = () => Object.assign(new Error('Invalid played-game history'), { code: 'share/invalid' });
  if (!Array.isArray(value)) throw invalid();
  const ids = new Set<string>();
  const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  const player = (x: unknown): PlayedPlayer => {
    const p = x as Partial<PlayedPlayer> | null;
    if (!p || !text(p.id) || !text(p.name) || !['M', 'F'].includes(p.gender!)) throw invalid();
    return { id: p.id, name: p.name, gender: p.gender! };
  };
  const team = (x: unknown): [PlayedPlayer, PlayedPlayer] => {
    if (!Array.isArray(x) || x.length !== 2) throw invalid();
    return [player(x[0]), player(x[1])];
  };
  return value.map((x: unknown) => {
    const g = x as Partial<PlayedGame> | null;
    if (!g || !text(g.id) || ids.has(g.id) || !text(g.planId) || !Number.isInteger(g.slot) || g.slot! < 1
      || !Number.isInteger(g.court) || g.court! < 0 || !Number.isFinite(g.completedAt) || g.completedAt! < 0
      || !Array.isArray(g.waitingIds ?? []) || !(g.waitingIds ?? []).every(text)) throw invalid();
    ids.add(g.id);
    const teamA = team(g.teamA), teamB = team(g.teamB);
    if (new Set([...teamA, ...teamB].map(p => p.id)).size !== 4) throw invalid();
    if (g.displayCourt != null && (!Number.isInteger(g.displayCourt) || g.displayCourt < 0 || g.displayCourt > 4)) throw invalid();
    if (g.score && (typeof g.score.a !== 'string' || typeof g.score.b !== 'string' || typeof g.score.applied !== 'boolean')) throw invalid();
    const hasTiming = g.startedAt !== undefined || g.durationMs !== undefined;
    if (hasTiming && (!Number.isSafeInteger(g.startedAt) || g.startedAt! < 0
      || !Number.isSafeInteger(g.durationMs) || g.durationMs! < 0 || !Number.isSafeInteger(g.completedAt)
      || g.startedAt! > g.completedAt! || g.durationMs !== g.completedAt! - g.startedAt!)) throw invalid();
    return { id: g.id, planId: g.planId, slot: g.slot!, court: g.court!, completedAt: g.completedAt!, teamA, teamB,
      waitingIds: [...new Set(g.waitingIds ?? [])], ...(g.displayCourt != null ? { displayCourt: g.displayCourt } : {}),
      ...(g.score ? { score: { a: g.score.a, b: g.score.b, applied: g.score.applied } } : {}),
      ...(hasTiming ? { startedAt: g.startedAt!, durationMs: g.durationMs! } : {}),
    };
  });
}
