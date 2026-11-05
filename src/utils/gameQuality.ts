import type { Court, Player } from '../algorithm/types';

export const DEFAULT_QUALITY_WEIGHTS = { waiting: 10, gender: 15, levels: 4, partners: 3, opponents: 1, preferred: 12 };
export type QualityWeights = typeof DEFAULT_QUALITY_WEIGHTS;
export interface QualityContext {
  players: Player[];
  slot: number;
  busyNames?: Set<string>;
  waited?: Record<string, number>;
  history?: Court[];
  preferredPairs?: Array<[string, string]>;
}

/** Decision aid only. Hard eligibility is checked before any weighted points. */
export function scoreGameQuality(court: Court, context: QualityContext, overrides: Partial<QualityWeights> = {}) {
  const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...overrides };
  const participants = [...court.teamA, ...court.teamB];
  const roster = new Map(context.players.map(p => [p.name, p]));
  const reasons = participants.flatMap(p => {
    const current = roster.get(p.name);
    if (!current) return [`${p.name}: missing from roster`];
    if (current.quarantined) return [`${p.name}: quarantined`];
    if (context.busyNames?.has(p.name)) return [`${p.name}: already playing`];
    if (context.slot - 1 < current.availFrom || context.slot - 1 > current.availTo) return [`${p.name}: outside availability`];
    return [];
  });
  if (new Set(participants.map(p => p.name)).size !== 4) reasons.push('Four distinct players required');
  const formatOf = (team: Court['teamA']) => team[0].gender === team[1].gender ? `${team[0].gender}${team[1].gender}` : 'MF';
  const a = formatOf(court.teamA), b = formatOf(court.teamB);
  const teams = [court.teamA, court.teamB];
  const samePair = (team: Court['teamA'], pair: string[]) => pair.includes(team[0].name) && pair.includes(team[1].name);
  const history = context.history ?? [];
  const raw = {
    waiting: participants.reduce((sum, p) => sum + (context.waited?.[p.name] ?? 0), 0),
    gender: a === b ? 1 : -1,
    levels: -Math.abs(court.teamA.reduce((sum, p) => sum + (roster.get(p.name)?.level ?? 3), 0) - court.teamB.reduce((sum, p) => sum + (roster.get(p.name)?.level ?? 3), 0)),
    partners: -teams.reduce((sum, team) => sum + history.filter(h => [h.teamA, h.teamB].some(old => samePair(team, old.map(p => p.name)))).length, 0),
    opponents: -court.teamA.reduce((sum, p) => sum + court.teamB.reduce((inner, q) => inner + history.filter(h => (h.teamA.some(x => x.name === p.name) && h.teamB.some(x => x.name === q.name)) || (h.teamB.some(x => x.name === p.name) && h.teamA.some(x => x.name === q.name))).length, 0), 0),
    preferred: teams.filter(team => (context.preferredPairs ?? []).some(pair => samePair(team, pair))).length,
  };
  const breakdown = Object.fromEntries((Object.keys(raw) as Array<keyof QualityWeights>).map(key => [key, { raw: raw[key], weight: weights[key], points: raw[key] * weights[key] }])) as Record<keyof QualityWeights, { raw: number; weight: number; points: number }>;
  return { eligible: reasons.length === 0, reasons, format: `${a} vs ${b}`, score: reasons.length ? null : Object.values(breakdown).reduce((sum, item) => sum + item.points, 0), breakdown };
}
