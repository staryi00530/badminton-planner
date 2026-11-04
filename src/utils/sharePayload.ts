/** Serializes the current schedule into the compact shape written to a share link. */
export function buildSharePayload({
  result,
  playersWithAvailability,
  gameMinutes,
  numCourts,
  scores,
  isConfirmed,
}: {
  result: { schedule: any[] } | null;
  playersWithAvailability: { name: string; gender: string }[];
  gameMinutes: number;
  numCourts: number;
  scores: Record<string, { a: string; b: string; applied?: boolean }>;
  isConfirmed: boolean;
}) {
  if (!result) return null;
  const pwith = playersWithAvailability;
  return {
    v: 1,
    p: pwith.map(p => [p.name, p.gender]),
    cfg: { g: gameMinutes, c: numCourts },
    scores: Object.fromEntries(
      Object.entries(scores)
        .filter(([, value]) => value?.applied)
        .map(([key, value]) => [key, { a: value.a, b: value.b }]),
    ),
    slots: result.schedule.map((s: any) => ({
      s: s.slot,
      c: s.courts.map((court: any) => [
        court.teamA.map((p: any) => pwith.findIndex(pl => pl.name === p.name)),
        court.teamB.map((p: any) => pwith.findIndex(pl => pl.name === p.name)),
      ]),
      sit: (s.sitting || []).map((p: any) => pwith.findIndex(pl => pl.name === p.name)),
    })),
    confirmed: isConfirmed,
  };
}

/**
 * Decodes a share payload back into planner-shape state (players/result/scores/config).
 * Pure reconstruction only — does not touch Saved Plans, see upsertSavedPlanFromShare.
 */
export function reconstructScheduleFromSharePayload(
  data: { p: [string, string][]; cfg?: { g?: number; c?: number }; slots: any[]; scores?: Record<string, any>; confirmed?: boolean },
  { currentGameMinutes, currentNumCourts }: { currentGameMinutes: number; currentNumCourts: number }
) {
  const { p: sharedPlayers, cfg, slots, scores: sharedScores, confirmed } = data;
  const invalid = () => Object.assign(new Error('Invalid shared schedule'), { code: 'share/invalid' });
  if (!Array.isArray(sharedPlayers) || !Array.isArray(slots)
    || (slots.length > 0 && sharedPlayers.length === 0)
    || sharedPlayers.some(player => !Array.isArray(player) || typeof player[0] !== 'string' || typeof player[1] !== 'string')) throw invalid();
  const n = sharedPlayers.length;
  const gp = new Array(n).fill(0);
  const cp = new Array(n).fill(0);
  const cr = new Array(n).fill(0);
  const newSchedule = slots.map(slot => {
    if (!slot || !Number.isInteger(slot.s) || !Array.isArray(slot.c ?? []) || !Array.isArray(slot.sit ?? [])) throw invalid();
    const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < n;
    if (!(slot.sit ?? []).every(validIndex) || !(slot.c ?? []).every((court: unknown) =>
      Array.isArray(court) && court.length === 2 && court.every(team => Array.isArray(team) && team.every(validIndex)))) throw invalid();
    const playing = new Set((slot.c ?? []).flat(2));
    for (let i = 0; i < n; i++) {
      if (playing.has(i)) {
        gp[i]++;
        cp[i]++;
        cr[i] = 0;
      } else {
        cr[i]++;
        cp[i] = 0;
      }
    }
    return {
      slot: slot.s,
      courts: (slot.c ?? []).map((court: any, ci: number) => ({
        court: ci + 1,
        teamA: court[0].map((i: number) => ({ name: sharedPlayers[i]![0], gender: sharedPlayers[i]![1] })),
        teamB: court[1].map((i: number) => ({ name: sharedPlayers[i]![0], gender: sharedPlayers[i]![1] })),
      })),
      sitting: (slot.sit ?? []).map((i: number) => ({ name: sharedPlayers[i]![0], gender: sharedPlayers[i]![1] })),
      playerState: sharedPlayers.map(([name, gender], i) => ({
        name,
        gender,
        total: gp[i],
        conPlayed: cp[i],
        conRested: cr[i],
        playing: playing.has(i),
        available: true,
      })),
      repeatedCourts: [],
    };
  });
  const restoredScores: Record<string, any> = {};
  newSchedule.forEach(slot => {
    slot.courts.forEach((court, ci) => {
      const key = `s${slot.slot}c${ci}`;
      const sharedScore = sharedScores?.[key];
      if (!sharedScore) return;
      restoredScores[key] = {
        a: sharedScore.a,
        b: sharedScore.b,
        applied: true,
        teamA: court.teamA.map(player => player.name),
        teamB: court.teamB.map(player => player.name),
      };
    });
  });

  return {
    players: sharedPlayers.map(([name, gender]) => ({ name, gender, skill: 2, availFrom: 0, availTo: slots.length - 1, group: 'full', leavesAt: null })),
    gameMinutes: cfg?.g || currentGameMinutes,
    numCourts: cfg?.c || currentNumCourts,
    result: { schedule: newSchedule, gamesPlayed: [...gp] },
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
