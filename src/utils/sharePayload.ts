import type { PlannerResult, ScoresMap, SharePayload } from '../types';
import { migratePlayedGames, type PlayedGame } from './playedHistory';
import { publicPlayedGames } from './playedHistoryCodec';
import type { Player } from '../algorithm/types';

/** Serializes the current schedule into the compact shape written to a share link. */
export function buildSharePayload({
  result,
  playersWithAvailability,
  gameMinutes,
  numCourts,
  scores,
  isConfirmed,
  settings = {},
  runtime,
  includeScoreDrafts = false,
  playedGames,
  historyEpoch = 0,
}: {
  result: Pick<PlannerResult, 'schedule' | 'planId'> | null;
  playersWithAvailability: { id?: string; name: string; gender: string; quarantined?: boolean; availFrom?: number; availTo?: number; group?: string; leavesAt?: number | null }[];
  gameMinutes: number;
  numCourts: number;
  scores: Record<string, { a: string; b: string; applied?: boolean }>;
  isConfirmed: boolean;
  settings?: Omit<NonNullable<SharePayload['cfg']>, 'g' | 'c'>;
  runtime?: SharePayload['runtime'];
  includeScoreDrafts?: boolean;
  playedGames?: PlayedGame[];
  historyEpoch?: number;
}): SharePayload | null {
  if (!result) return null;
  const pwith = [...playersWithAvailability];
  // Protected courts can still contain someone removed by roster replacement.
  // Keep their public snapshots addressable without adding them back to the roster.
  for (const slot of result.schedule) for (const player of [...slot.courts.flatMap(c => [...c.teamA, ...c.teamB]), ...(slot.sitting ?? [])]) {
    if (!pwith.some(p => player.id && p.id ? player.id === p.id : p.name === player.name)) pwith.push({ ...player, quarantined: true, availFrom: 0, availTo: -1 });
  }
  const indexOf = (player: { id?: string; name: string }) => pwith.findIndex(p => player.id && p.id ? player.id === p.id : p.name === player.name);
  return {
    v: 1,
    schema: 3,
    ...(result.planId ? { planId: result.planId } : {}),
    ...(playedGames ? { history: publicPlayedGames(playedGames), historyEpoch } : {}),
    p: pwith.map(p => [p.name, p.gender as 'M' | 'F' | '?']),
    ids: pwith.map(p => p.id ?? `legacy:${p.name.toLocaleLowerCase()}`),
    ...(pwith.length !== playersWithAvailability.length ? { active: playersWithAvailability.map((_, i) => i) } : {}),
    availability: pwith.map(p => ({ from: p.availFrom ?? 0, to: p.availTo ?? Math.max(0, result.schedule.length - 1), ...(p.group ? { group: p.group } : {}), ...(p.leavesAt != null ? { leavesAt: p.leavesAt } : {}) })),
    ...(runtime ? { runtime } : {}),
    // Empty arrays clear an existing RTDB child during update(), rather than retaining stale quarantine.
    q: pwith.flatMap((p, index) => p.quarantined ? [index] : []),
    cfg: { g: gameMinutes, c: numCourts, ...settings },
    scores: Object.fromEntries(
      Object.entries(scores)
        .filter(([, value]) => includeScoreDrafts || value?.applied)
        .map(([key, value]) => [key, { a: value.a, b: value.b, ...(includeScoreDrafts ? { applied: !!value.applied } : {}) }]),
    ),
    slots: result.schedule.map(s => ({
      s: s.slot,
      c: s.courts.map(court => [
        court.teamA.map(indexOf),
        court.teamB.map(indexOf),
      ]),
      sit: (s.sitting || []).map(indexOf),
    })),
    confirmed: isConfirmed,
  };
}

/**
 * Decodes a share payload back into planner-shape state (players/result/scores/config).
 * Pure reconstruction only — does not touch Saved Plans, see upsertSavedPlanFromShare.
 */
export function reconstructScheduleFromSharePayload(
  data: { p: [string, string][]; q?: number[]; cfg?: SharePayload['cfg']; ids?: string[]; active?: number[]; availability?: SharePayload['availability']; runtime?: SharePayload['runtime']; slots: Array<{ s: number; c?: number[][][]; sit?: number[] }>; scores?: SharePayload['scores']; confirmed?: boolean; planId?: string; history?: PlayedGame[]; historyEpoch?: number },
  { currentGameMinutes, currentNumCourts }: { currentGameMinutes: number; currentNumCourts: number }
) {
  const { p: sharedPlayers, cfg, slots, scores: sharedScores, confirmed } = data;
  const invalid = () => Object.assign(new Error('Invalid shared schedule'), { code: 'share/invalid' });
  if (!Array.isArray(sharedPlayers) || !Array.isArray(slots)
    || (slots.length > 0 && sharedPlayers.length === 0)
    || sharedPlayers.some(player => !Array.isArray(player) || typeof player[0] !== 'string' || typeof player[1] !== 'string')) throw invalid();
  const n = sharedPlayers.length;
  if (data.planId !== undefined && (typeof data.planId !== 'string' || !data.planId.trim())) throw invalid();
  if (!Number.isInteger(data.historyEpoch ?? 0) || (data.historyEpoch ?? 0) < 0) throw invalid();
  if (!Array.isArray(data.q ?? []) || !(data.q ?? []).every(index => Number.isInteger(index) && index >= 0 && index < n)) throw invalid();
  const quarantined = new Set(data.q ?? []);
  const active = new Set(data.active ?? sharedPlayers.map((_, i) => i));
  if (data.active && (!Array.isArray(data.active) || !data.active.every(i => Number.isInteger(i) && i >= 0 && i < n))) throw invalid();
  if (data.ids && (!Array.isArray(data.ids) || data.ids.length !== n || new Set(data.ids).size !== n || data.ids.some(id => typeof id !== 'string' || !id))) throw invalid();
  if (data.availability && (!Array.isArray(data.availability) || data.availability.length !== n || data.availability.some(a => !Number.isInteger(a?.from) || !Number.isInteger(a?.to)))) throw invalid();
  const gp: number[] = new Array(n).fill(0);
  const cp: number[] = new Array(n).fill(0);
  const cr: number[] = new Array(n).fill(0);
  const playerAt = (index: number) => ({ name: sharedPlayers[index]![0], gender: sharedPlayers[index]![1] === 'F' ? 'F' as const : 'M' as const, ...(data.ids?.[index] ? { id: data.ids[index] } : {}) });
  type SharedPlayerInGame = ReturnType<typeof playerAt>;
  const teamAt = (indices: number[]): [SharedPlayerInGame, SharedPlayerInGame] => {
    if (indices.length !== 2) throw new Error('Shared teams must contain exactly two players');
    return [playerAt(indices[0]!), playerAt(indices[1]!)];
  };
  const newSchedule = slots.map(slot => {
    if (!slot || !Number.isInteger(slot.s) || !Array.isArray(slot.c ?? []) || !Array.isArray(slot.sit ?? [])) throw invalid();
    const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < n;
    if (!(slot.sit ?? []).every(validIndex) || !(slot.c ?? []).every((court: unknown) =>
      Array.isArray(court) && court.length === 2 && court.every(team => Array.isArray(team) && team.every(validIndex)))) throw invalid();
    const playing = new Set((slot.c ?? []).flat(2));
    for (let i = 0; i < n; i++) {
      if (playing.has(i)) {
        gp[i] = (gp[i] ?? 0) + 1;
        cp[i] = (cp[i] ?? 0) + 1;
        cr[i] = 0;
      } else {
        cr[i] = (cr[i] ?? 0) + 1;
        cp[i] = 0;
      }
    }
    return {
      slot: slot.s,
      courts: (slot.c ?? []).map((court: any, ci: number) => ({
        court: ci + 1,
        teamA: teamAt(court[0]!),
        teamB: teamAt(court[1]!),
      })),
      sitting: (slot.sit ?? []).map(playerAt),
      playerState: sharedPlayers.map(([name, gender], i) => ({
        name,
        gender: gender === 'F' ? 'F' as const : 'M' as const,
        total: gp[i]!,
        conPlayed: cp[i]!,
        conRested: cr[i]!,
        playing: playing.has(i),
        available: !quarantined.has(i),
      })),
      repeatedCourts: [],
    };
  });
  const restoredScores: ScoresMap = {};
  newSchedule.forEach(slot => {
    slot.courts.forEach((court, ci) => {
      const key = `s${slot.slot}c${ci}`;
      const sharedScore = sharedScores?.[key];
      if (!sharedScore) return;
      restoredScores[key] = {
        a: sharedScore.a,
        b: sharedScore.b,
        applied: sharedScore.applied ?? true,
        teamA: court.teamA.map(player => player.name),
        teamB: court.teamB.map(player => player.name),
      };
    });
  });

  const refs = (games: NonNullable<SharePayload['runtime']>['live']) => {
    if (!Array.isArray(games ?? [])) throw invalid();
    return (games ?? []).map(game => {
      if (!Number.isInteger(game.slot) || !Number.isInteger(game.court) || !newSchedule.find(slot => slot.slot === game.slot)?.courts[game.court]) throw invalid();
      if (game.startedAt !== undefined && (typeof game.startedAt !== 'number' || !Number.isInteger(game.startedAt) || game.startedAt < 0)) throw invalid();
      return game;
    });
  };
  const restoredGameMinutes = cfg?.g || currentGameMinutes;
  const decodedPlayers: Player[] = sharedPlayers.flatMap(([name, gender], index) => active.has(index) ? [{ name, gender: gender === 'F' ? 'F' as const : 'M' as const, ...(data.ids?.[index] ? { id: data.ids[index] } : {}), skill: 2, availFrom: data.availability?.[index]?.from ?? 0, availTo: data.availability?.[index]?.to ?? slots.length - 1, group: data.availability?.[index]?.group ?? 'full', leavesAt: data.availability?.[index]?.leavesAt ?? null, ...(quarantined.has(index) ? { quarantined: true } : {}) }] : []);
  const decodedResult: PlannerResult = { schedule: newSchedule, gamesPlayed: gp.filter((_, i) => active.has(i)), ...(data.planId ? { planId: data.planId } : {}) };
  const completedGames = refs(data.runtime?.completed);
  const playedGames = data.history ? publicPlayedGames(data.history) : migratePlayedGames(decodedResult, decodedPlayers, completedGames, restoredScores);
  return {
    players: decodedPlayers,
    playedGames,
    historyEpoch: data.historyEpoch ?? 0,
    totalMinutes: cfg?.totalMinutes ?? Math.max(1, ...slots.map(slot => slot.s)) * restoredGameMinutes,
    sessionStart: cfg?.sessionStart ?? '',
    staggerMode: cfg?.staggerMode ?? 'none',
    extraCourt: cfg?.extraCourt ?? { enabled: false, startMin: 60, durationMin: 90 },
    courtOverrides: cfg?.courtOverrides ?? {},
    liveGames: refs(data.runtime?.live),
    completedGames,
    suspendedPlayerNames: data.runtime?.suspended ?? [],
    gameMinutes: cfg?.g || currentGameMinutes,
    numCourts: cfg?.c || currentNumCourts,
    result: decodedResult,
    scores: restoredScores,
    isConfirmed: !!confirmed,
  };
}

/**
 * Upserts a Saved Plans entry for an opened share link, keyed by sourceShareId so
 * reopening the same link updates the same entry instead of creating a duplicate.
 * `now` is injectable for tests; defaults to the real clock.
 */
export function upsertSavedPlanFromShare(
  savedPlans: { id: number | string; sourceShareId?: string }[],
  sourceShareId: string | null,
  newResult: unknown,
  now: number = Date.now()
) {
  if (!sourceShareId) return { savedPlans, loadedPlanId: null };
  const existing = savedPlans.find(p => p.sourceShareId === sourceShareId);
  if (existing) {
    return {
      loadedPlanId: existing.id,
      savedPlans: savedPlans.map(p => (p.id === existing.id ? { ...p, result: newResult, savedAt: new Date(now).toISOString() } : p)),
    };
  }
  const newLoadedPlanId = now;
  return {
    loadedPlanId: newLoadedPlanId,
    savedPlans: [{ id: newLoadedPlanId, tag: '', result: newResult, savedAt: new Date(now).toISOString(), sourceShareId }, ...savedPlans],
  };
}
