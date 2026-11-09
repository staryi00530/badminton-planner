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

/** Matchup assessment and play eligibility are independent signals. */
export function scoreGameQuality(court: Court, context: QualityContext, overrides: Partial<QualityWeights> = {}) {
  const weights = { ...DEFAULT_QUALITY_WEIGHTS, ...overrides };
  const participants = [...court.teamA, ...court.teamB];
  const canonical = (name: string) => name.trim().toLowerCase();
  const roster = new Map(context.players.flatMap(p => [p.name, ...(p.aliases ?? [])].map(name => [canonical(name), p] as const)));
  const byId = new Map(context.players.filter(p => p.id).map(p => [p.id, p]));
  const resolve = (p: Court['teamA'][number]) => p.id && !p.id.startsWith('legacy:') ? byId.get(p.id) : roster.get(canonical(p.name));
  const samePlayer = (p: Court['teamA'][number], q: Court['teamA'][number]) => {
    const a = resolve(p)?.id || p.id, b = resolve(q)?.id || q.id;
    if (a && b && !a.startsWith('legacy:') && !b.startsWith('legacy:')) return a === b;
    return canonical(resolve(p)?.name ?? p.name) === canonical(resolve(q)?.name ?? q.name);
  };
  const reasons = participants.flatMap(p => {
    const current = resolve(p);
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
  const samePair = (team: Court['teamA'], pair: Court['teamA']) => team.every(p => pair.some(q => samePlayer(p, q)));
  const history = context.history ?? [];
  const raw = {
    waiting: participants.reduce((sum, p) => sum + (context.waited?.[p.name] ?? 0), 0),
    gender: a === b ? 1 : -1,
    levels: -Math.abs(court.teamA.reduce((sum, p) => sum + (resolve(p)?.level ?? 3), 0) - court.teamB.reduce((sum, p) => sum + (resolve(p)?.level ?? 3), 0)),
    partners: -teams.reduce((sum, team) => sum + history.filter(h => [h.teamA, h.teamB].some(old => samePair(team, old))).length, 0),
    opponents: -court.teamA.reduce((sum, p) => sum + court.teamB.reduce((inner, q) => inner + history.filter(h => (h.teamA.some(x => samePlayer(x, p)) && h.teamB.some(x => samePlayer(x, q))) || (h.teamB.some(x => samePlayer(x, p)) && h.teamA.some(x => samePlayer(x, q)))).length, 0), 0),
    preferred: teams.filter(team => (context.preferredPairs ?? []).some(pair => samePair(team, [{ name: pair[0], gender: 'M' }, { name: pair[1], gender: 'M' }]))).length,
  };
  const breakdown = Object.fromEntries((Object.keys(raw) as Array<keyof QualityWeights>).map(key => [key, { raw: raw[key], weight: key === 'waiting' ? 0 : weights[key], points: key === 'waiting' ? 0 : raw[key] * weights[key] }])) as Record<keyof QualityWeights, { raw: number; weight: number; points: number }>;
  const matchupScore = Object.values(breakdown).reduce((sum, item) => sum + item.points, 0);
  const assumedLevels = participants.filter(p => resolve(p)?.level == null).map(p => p.name);
  const women = participants.filter(p => p.gender === 'F').length;
  const formatCompromise = a === b ? null : women % 2
    ? `Format compromise: this lineup has ${women} women and ${4 - women} men; matching formats require an even number of women.`
    : 'Format compromise: this fixed team split needs regrouping to match formats.';
  return { eligible: reasons.length === 0, reasons, format: `${a} vs ${b}`, formatCompromise, score: matchupScore, matchupScore, breakdown, assumedLevels, rotation: { gamesWaited: Object.fromEntries(participants.map(p => [p.name, context.waited?.[p.name] ?? 0])), totalWaited: raw.waiting } };
}
