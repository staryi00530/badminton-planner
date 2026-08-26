import type {
  Player,
  PlayerInGame,
  Court,
  PlayerState,
  SlotResult,
  ScheduleState,
  GeneratorYield,
  ForcedFirstSlot,
} from './types.js';

// ─── Utilities ───────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function groupKey(idxs: number[]): string {
  return idxs.slice().sort((a, b) => a - b).join(',');
}

// ─── Algorithm ───────────────────────────────────────────────────────────────

export interface ScheduleOptions {
  preferMixedTeams?: boolean; // pack 2F+2M on one court rather than spreading 1F per court
}

export function* generateScheduleGen(
  players: Player[],
  totalSlots: number,
  courtsPerSlot: number[],
  startFrom = 0,
  initialState: ScheduleState | null = null,
  forcedFirstSlot: ForcedFirstSlot | null = null,
  options: ScheduleOptions = {},
  rng: () => number = Math.random,
): Generator<GeneratorYield> {
  const n = players.length;
  if (n < 4) return null;

  const schedule: SlotResult[] = initialState ? [...initialState.keptSlots] : [];
  const gamesPlayed: number[] = initialState ? [...initialState.gamesPlayed] : new Array(n).fill(0);
  const consecutivePlayed: number[] = initialState ? [...initialState.consecutivePlayed] : new Array(n).fill(0);
  const consecutiveRested: number[] = initialState ? [...initialState.consecutiveRested] : new Array(n).fill(0);
  const partnerCount: number[][] = initialState
    ? initialState.partnerCount.map(r => [...r])
    : Array.from({ length: n }, () => new Array(n).fill(0));
  const opponentCount: number[][] = initialState
    ? initialState.opponentCount.map(r => [...r])
    : Array.from({ length: n }, () => new Array(n).fill(0));
  const courtGroupHistory: Set<string> = initialState?.courtGroupHistory
    ? new Set(initialState.courtGroupHistory)
    : new Set();
  // Bug fix: restore womenDoublesCount from initialState instead of always starting at 0
  let womenDoublesCount: number = initialState?.womenDoublesCount ?? 0;

  for (let slot = startFrom; slot < totalSlots; slot++) {
    const available: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = players[i]!;
      if (slot >= p.availFrom && slot <= p.availTo) available.push(i);
    }

    // Compute constraints first so courtsThisSlot reflects who can actually play
    const mustPlay: number[] = [];
    const mustRest: number[] = [];
    const canPlay: number[] = [];
    for (const i of available) {
      if (consecutivePlayed[i]! >= 2) mustRest.push(i);
      else if (consecutiveRested[i]! >= 2) mustPlay.push(i);
      else canPlay.push(i);
    }

    // Use all available players for court count — mustRest players can play
    // a 3rd consecutive game rather than leaving a court empty.
    const courtsThisSlot = Math.min(courtsPerSlot[slot]!, Math.floor(available.length / 4));
    if (courtsThisSlot === 0) {
      schedule.push({
        slot: slot + 1,
        courts: [],
        sitting: available.map(i => players[i] as PlayerInGame),
        playerState: players.map((p, i) => ({
          name: p.name,
          gender: p.gender,
          total: gamesPlayed[i]!,
          conPlayed: consecutivePlayed[i]!,
          conRested: consecutiveRested[i]!,
          playing: false,
          available: available.includes(i),
        }) satisfies PlayerState),
        repeatedCourts: [], // bug fix: was missing in JS version
      });
      for (const i of available) {
        consecutiveRested[i]!;
        consecutiveRested[i] = (consecutiveRested[i] ?? 0) + 1;
        consecutivePlayed[i] = 0;
      }
      yield { schedule: [...schedule], gamesPlayed: [...gamesPlayed] };
      continue;
    }

    // Phase 1 — Player selection
    // If this is the first slot being generated and a forced selection was provided,
    // skip the normal selection algorithm and use the manually chosen players.
    // forcedFirstSlot can be:
    //   - number[]            — flat list of selected player indices (auto-pair)
    //   - { courts: [[...]] } — explicit court layout, skip phase 1-3 entirely
    const isForcedSlot = forcedFirstSlot != null && slot === startFrom;
    const isForcedCourts =
      isForcedSlot &&
      !Array.isArray(forcedFirstSlot) &&
      (forcedFirstSlot as { courts: number[][] }).courts != null;

    if (isForcedCourts) {
      // Fully or partially forced — accept provided courts as-is, then optionally
      // fill additional courts when a live pulled-up slot is being expanded.
      const forced = forcedFirstSlot as { courts: number[][]; targetCourts?: number };
      const courtsForced = forced.courts;
      const selectedForced = courtsForced.flat();
      const forcedSet = new Set(selectedForced);
      const playableCount = new Set([...available, ...selectedForced]).size;
      const targetCourts = Math.max(
        courtsForced.length,
        Math.min(forced.targetCourts ?? courtsForced.length, Math.floor(playableCount / 4), courtsPerSlot[slot]!),
      );
      const additionalNeeded = Math.max(0, targetCourts - courtsForced.length) * 4;
      const selectedAdditional: number[] = [];
      const addCandidate = (i: number) => {
        if (selectedAdditional.length >= additionalNeeded) return;
        if (forcedSet.has(i) || selectedAdditional.includes(i)) return;
        selectedAdditional.push(i);
      };
      const candidatesByRate = (idxs: number[]) => {
        const grouped: Record<string, number[]> = {};
        for (const p of idxs) {
          const avail = players[p]!.availTo - players[p]!.availFrom + 1;
          const rate = avail > 0 ? (gamesPlayed[p] ?? 0) / avail : 0;
          const key = `${Math.round(rate * 100)}`;
          if (!grouped[key]) grouped[key] = [];
          grouped[key]!.push(p);
        }
        return Object.keys(grouped)
          .sort((a, b) => Number(a) - Number(b))
          .flatMap(g => shuffle(grouped[g]!, rng));
      };
      for (const p of shuffle(mustPlay.filter(i => !forcedSet.has(i)), rng)) addCandidate(p);
      for (const p of candidatesByRate(canPlay.filter(i => !forcedSet.has(i)))) addCandidate(p);
      for (const p of shuffle(mustRest.filter(i => !forcedSet.has(i)), rng)) addCandidate(p);

      const courtsToBuild = [...courtsForced];
      for (let i = 0; i + 3 < selectedAdditional.length; i += 4) {
        courtsToBuild.push(selectedAdditional.slice(i, i + 4));
      }
      const courts: Court[] = [];
      for (let c = 0; c < courtsToBuild.length; c++) {
        const cf = courtsToBuild[c]!;
        const [a1, a2, b1, b2] = [cf[0]!, cf[1]!, cf[2]!, cf[3]!];
        courts.push({
          court: c + 1,
          teamA: [players[a1] as PlayerInGame, players[a2] as PlayerInGame],
          teamB: [players[b1] as PlayerInGame, players[b2] as PlayerInGame],
        });
        partnerCount[a1]![a2]!;
        partnerCount[a1]![a2] = (partnerCount[a1]![a2] ?? 0) + 1;
        partnerCount[a2]![a1] = (partnerCount[a2]![a1] ?? 0) + 1;
        partnerCount[b1]![b2] = (partnerCount[b1]![b2] ?? 0) + 1;
        partnerCount[b2]![b1] = (partnerCount[b2]![b1] ?? 0) + 1;
        for (const x of [a1, a2]) {
          for (const y of [b1, b2]) {
            opponentCount[x]![y] = (opponentCount[x]![y] ?? 0) + 1;
            opponentCount[y]![x] = (opponentCount[y]![x] ?? 0) + 1;
          }
        }
        const genders = [players[a1]!.gender, players[a2]!.gender, players[b1]!.gender, players[b2]!.gender];
        if (genders.every(g => g === 'F')) womenDoublesCount++;
      }
      const playingSet = new Set(courtsToBuild.flat());
      for (let i = 0; i < n; i++) {
        const isAvail = available.includes(i);
        if (playingSet.has(i)) {
          gamesPlayed[i] = (gamesPlayed[i] ?? 0) + 1;
          consecutivePlayed[i] = (consecutivePlayed[i] ?? 0) + 1;
          consecutiveRested[i] = 0;
        } else if (isAvail) {
          consecutiveRested[i] = (consecutiveRested[i] ?? 0) + 1;
          consecutivePlayed[i] = 0;
        }
      }
      const sitting = available.filter(i => !playingSet.has(i)).map(i => players[i] as PlayerInGame);
      const playerState: PlayerState[] = players.map((p, i) => ({
        name: p.name,
        gender: p.gender,
        total: gamesPlayed[i]!,
        conPlayed: consecutivePlayed[i]!,
        conRested: consecutiveRested[i]!,
        playing: playingSet.has(i),
        available: available.includes(i),
      }));
      for (const cf of courtsToBuild) courtGroupHistory.add(groupKey(cf));
      schedule.push({ slot: slot + 1, courts, sitting, playerState, repeatedCourts: [] });
      yield { schedule: [...schedule], gamesPlayed: [...gamesPlayed] };
      continue;
    }

    let selected: number[];
    let remaining: number[] = [];
    if (isForcedSlot && Array.isArray(forcedFirstSlot)) {
      selected = (forcedFirstSlot as number[]).filter(i => available.includes(i));
      remaining = available.filter(i => !selected.includes(i) && !mustRest.includes(i));
    } else {
      const playersNeeded = courtsThisSlot * 4;
      const canPlayGrouped: Record<string, number[]> = {};
      for (const p of canPlay) {
        const avail = players[p]!.availTo - players[p]!.availFrom + 1;
        const rate = avail > 0 ? (gamesPlayed[p] ?? 0) / avail : 0;
        const key = `${Math.round(rate * 100)}`;
        if (!canPlayGrouped[key]) canPlayGrouped[key] = [];
        canPlayGrouped[key].push(p);
      }
      const canPlayShuffled = Object.keys(canPlayGrouped)
        .sort((a, b) => Number(a) - Number(b))
        .flatMap(g => shuffle(canPlayGrouped[g]!, rng));
      const pool = [...shuffle(mustPlay, rng), ...canPlayShuffled];
      selected = [];
      for (const p of mustPlay) {
        if (selected.length < playersNeeded) selected.push(p);
      }
      remaining = pool.filter(p => !selected.includes(p) && !mustRest.includes(p));
      for (const p of remaining) {
        if (selected.length >= playersNeeded) break;
        if (!selected.includes(p)) selected.push(p);
      }
      // Draft mustRest players if courts would otherwise be under-filled
      if (selected.length < playersNeeded) {
        for (const p of shuffle(mustRest.filter(i => !selected.includes(i)), rng)) {
          if (selected.length >= playersNeeded) break;
          selected.push(p);
        }
      }
    }

    const actualCourts = Math.min(courtsThisSlot, Math.floor(selected.length / 4));
    selected = selected.slice(0, actualCourts * 4);

    // ── Gender balance: ensure even F count so courts can be distributed
    // as 2F+2M or 4M (never 3F+1M or 1F+3M which force MF vs MM/FF).
    // Skip if the slot is forced — respect user's explicit selection even if uneven.
    const selFCount = selected.filter(i => players[i]!.gender === 'F').length;
    if (!isForcedSlot && selFCount % 2 !== 0) {
      // Odd F — try swapping one non-mustPlay F out for an unselected M
      const swappableF = selected.filter(i => players[i]!.gender === 'F' && !mustPlay.includes(i));
      const unselM = remaining.filter(i => players[i]!.gender === 'M' && !selected.includes(i));
      if (swappableF.length > 0 && unselM.length > 0) {
        selected = selected.filter(i => i !== swappableF[swappableF.length - 1]);
        selected.push(unselM[0]!);
      } else {
        // Alternatively add one more F if available
        const unselF = remaining.filter(i => players[i]!.gender === 'F' && !selected.includes(i));
        if (unselF.length > 0) selected = [...selected.slice(0, actualCourts * 4 - 1), unselF[0]!];
      }
    }

    // ── Court grouping ───────────────────────────────────────────────────────
    // Goal: give the pairing optimizer a balanced gender composition per court.
    // Normal mode  → 2F+2M per court  (enables MF vs MF)
    // WD mode      → 4F on one court, rest get 4M (enables FF vs FF + MM vs MM)
    //   WD mode activates when: wdTarget not met AND ≥4F selected AND ≥2 courts
    //   so that grouping an all-female court is possible without leaving a
    //   short-changed court. After the target is met, revert to normal mode.
    // Helper: take exactly 4 players from remF+remM, capturing remF.length
    // BEFORE the first splice to avoid the JS mutation hazard.
    let remF = shuffle(selected.filter(i => players[i]!.gender === 'F'), rng);
    let remM = shuffle(selected.filter(i => players[i]!.gender === 'M'), rng);

    const takeGroup = (): number[] => {
      const fCount = Math.min(remF.length, 4);
      return [...remF.splice(0, fCount), ...remM.splice(0, 4 - fCount)];
    };

    const courtGroups: number[][] = [];
    const useWDGrouping = womenDoublesCount < 2 && remF.length >= 4 && actualCourts >= 2;
    if (useWDGrouping) {
      courtGroups.push(remF.splice(0, 4)); // all-female court → FF vs FF
      for (let c = 1; c < actualCourts; c++) {
        const courtsLeft = actualCourts - c;
        if (remF.length >= 2 && remM.length >= 2 && Math.ceil(remF.length / courtsLeft) >= 2) {
          courtGroups.push([...remF.splice(0, 2), ...remM.splice(0, 2)]);
        } else {
          courtGroups.push(takeGroup());
        }
      }
    } else {
      for (let c = 0; c < actualCourts; c++) {
        const courtsLeft = actualCourts - c;
        const fPerCourt = courtsLeft > 0 ? Math.ceil(remF.length / courtsLeft) : 0;
        if (fPerCourt >= 2 && remF.length >= 2 && remM.length >= 2) {
          // 2F+2M: enables MF vs MF
          courtGroups.push([...remF.splice(0, 2), ...remM.splice(0, 2)]);
        } else if (remF.length >= 4) {
          // All-female court
          courtGroups.push(remF.splice(0, 4));
        } else if (fPerCourt >= 1 && remM.length >= 3 && !options.preferMixedTeams) {
          // 1F+3M: spread females evenly across courts instead of packing into court 0
          courtGroups.push([remF.splice(0, 1)[0]!, ...remM.splice(0, 3)]);
        } else {
          courtGroups.push(takeGroup());
        }
      }
    }

    // ── Group-repeat detection & fix ─────────────────────────────────────────
    // Try to replace 2 players (then 1) to avoid repeating the exact same
    // 4-player group on a court.  mustRest players are used as subs when
    // needed ("sacrifice" the consecutive-rest constraint to break the repeat).
    const repeatedCourts: number[] = [];
    {
      const usedInGroups = new Set(courtGroups.flat());
      const freeSitters = available.filter(i => !usedInGroups.has(i));
      const normalSubs = freeSitters.filter(i => !mustRest.includes(i));
      const rstSubs = freeSitters.filter(i => mustRest.includes(i));
      const allSubs = [...normalSubs, ...rstSubs];

      for (let ci = 0; ci < courtGroups.length; ci++) {
        const currentGroup = courtGroups[ci]!;
        if (!courtGroupHistory.has(groupKey(currentGroup))) continue;
        let fixed = false;
        const swappable = currentGroup
          .map((pid, pos) => ({ pid, pos }))
          .filter(({ pid }) => !mustPlay.includes(pid));

        // 1. Try swapping 2 players first (game feels more different)
        outer2: for (let s1 = 0; s1 < allSubs.length; s1++) {
          for (let s2 = s1 + 1; s2 < allSubs.length; s2++) {
            for (let p1 = 0; p1 < swappable.length; p1++) {
              for (let p2 = p1 + 1; p2 < swappable.length; p2++) {
                const ng = [...currentGroup];
                ng[swappable[p1]!.pos] = allSubs[s1]!;
                ng[swappable[p2]!.pos] = allSubs[s2]!;
                if (ng.filter(i => players[i]!.gender === 'F').length % 2 !== 0) continue;
                if (courtGroupHistory.has(groupKey(ng))) continue;
                const o1 = swappable[p1]!.pid;
                const o2 = swappable[p2]!.pid;
                selected = selected.filter(i => i !== o1 && i !== o2);
                for (const sub of [allSubs[s1]!, allSubs[s2]!]) {
                  if (!selected.includes(sub)) selected.push(sub);
                }
                courtGroups[ci] = ng;
                fixed = true;
                break outer2;
              }
            }
          }
        }

        // 2. Fallback: swap 1 player (same gender to keep gender balance)
        if (!fixed) {
          outer1: for (const sub of allSubs) {
            for (const { pid, pos } of swappable) {
              if (players[pid]!.gender !== players[sub]!.gender) continue;
              const ng = [...currentGroup];
              ng[pos] = sub;
              if (courtGroupHistory.has(groupKey(ng))) continue;
              selected = selected.filter(i => i !== pid);
              if (!selected.includes(sub)) selected.push(sub);
              courtGroups[ci] = ng;
              fixed = true;
              break outer1;
            }
          }
        }

        if (!fixed) repeatedCourts.push(ci);
      }
      for (const g of courtGroups) courtGroupHistory.add(groupKey(g));
    }

    const courts: Court[] = [];

    for (let c = 0; c < actualCourts; c++) {
      const courtPlayers = courtGroups[c]!;

      const pairings: [[number, number], [number, number]][] = [
        [[courtPlayers[0]!, courtPlayers[1]!], [courtPlayers[2]!, courtPlayers[3]!]],
        [[courtPlayers[0]!, courtPlayers[2]!], [courtPlayers[1]!, courtPlayers[3]!]],
        [[courtPlayers[0]!, courtPlayers[3]!], [courtPlayers[1]!, courtPlayers[2]!]],
      ];

      // MM, FF, or MF — used to penalise unbalanced gender matchups
      const genderType = (t: [number, number]): string => {
        const a = players[t[0]]!.gender;
        const b = players[t[1]]!.gender;
        return a === 'M' && b === 'M' ? 'MM' : a === 'F' && b === 'F' ? 'FF' : 'MF';
      };
      const isWD = (t: [number, number]): boolean => genderType(t) === 'FF';

      let bestPairing = pairings[0]!;
      let bestScore = Infinity;
      for (const pairing of pairings) {
        const [tA, tB] = pairing;
        let score = 0;
        score += (partnerCount[tA[0]]![tA[1]] ?? 0) * 3;
        score += (partnerCount[tB[0]]![tB[1]] ?? 0) * 3;
        score += (opponentCount[tA[0]]![tB[0]] ?? 0) + (opponentCount[tA[0]]![tB[1]] ?? 0);
        score += (opponentCount[tA[1]]![tB[0]] ?? 0) + (opponentCount[tA[1]]![tB[1]] ?? 0);
        // Penalise unbalanced gender matchups (MF vs MM, MF vs FF, MM vs FF).
        if (genderType(tA) !== genderType(tB)) score += 15;
        const skillA = (players[tA[0]]!.skill ?? 0.5) + (players[tA[1]]!.skill ?? 0.5);
        const skillB = (players[tB[0]]!.skill ?? 0.5) + (players[tB[1]]!.skill ?? 0.5);
        score += Math.abs(skillA - skillB) * 2;
        score += rng() * 1.5;
        if (score < bestScore) {
          bestScore = score;
          bestPairing = pairing;
        }
      }

      const [teamA, teamB] = bestPairing;
      courts.push({
        court: c + 1,
        teamA: [players[teamA[0]] as PlayerInGame, players[teamA[1]] as PlayerInGame],
        teamB: [players[teamB[0]] as PlayerInGame, players[teamB[1]] as PlayerInGame],
      });
      if (isWD(teamA) || isWD(teamB)) womenDoublesCount++;

      partnerCount[teamA[0]]![teamA[1]] = (partnerCount[teamA[0]]![teamA[1]] ?? 0) + 1;
      partnerCount[teamA[1]]![teamA[0]] = (partnerCount[teamA[1]]![teamA[0]] ?? 0) + 1;
      partnerCount[teamB[0]]![teamB[1]] = (partnerCount[teamB[0]]![teamB[1]] ?? 0) + 1;
      partnerCount[teamB[1]]![teamB[0]] = (partnerCount[teamB[1]]![teamB[0]] ?? 0) + 1;
      for (const a of teamA) {
        for (const b of teamB) {
          opponentCount[a]![b] = (opponentCount[a]![b] ?? 0) + 1;
          opponentCount[b]![a] = (opponentCount[b]![a] ?? 0) + 1;
        }
      }
    }

    const playingSet = new Set(selected);
    for (let i = 0; i < n; i++) {
      const isAvail = available.includes(i);
      if (playingSet.has(i)) {
        gamesPlayed[i] = (gamesPlayed[i] ?? 0) + 1;
        consecutivePlayed[i] = (consecutivePlayed[i] ?? 0) + 1;
        consecutiveRested[i] = 0;
      } else if (isAvail) {
        consecutiveRested[i] = (consecutiveRested[i] ?? 0) + 1;
        consecutivePlayed[i] = 0;
      }
    }

    const sitting = available.filter(i => !playingSet.has(i)).map(i => players[i] as PlayerInGame);
    const playerState: PlayerState[] = players.map((p, i) => ({
      name: p.name,
      gender: p.gender,
      total: gamesPlayed[i]!,
      conPlayed: consecutivePlayed[i]!,
      conRested: consecutiveRested[i]!,
      playing: playingSet.has(i),
      available: available.includes(i),
    }));

    schedule.push({ slot: slot + 1, courts, sitting, playerState, repeatedCourts });
    yield { schedule: [...schedule], gamesPlayed: [...gamesPlayed] };
  }
}

// Synchronous wrapper — collects all yields and returns the final result
export function generateSchedule(
  players: Player[],
  totalSlots: number,
  courtsPerSlot: number[],
  startFrom = 0,
  initialState: ScheduleState | null = null,
  forcedFirstSlot: ForcedFirstSlot | null = null,
  options: ScheduleOptions = {},
  rng: () => number = Math.random,
): GeneratorYield | null {
  let result: GeneratorYield | null = null;
  for (result of generateScheduleGen(players, totalSlots, courtsPerSlot, startFrom, initialState, forcedFirstSlot, options, rng));
  return result;
}

// Recomputes per-slot cumulative stats (gamesPlayed/streaks/playerState) from a schedule's
// actual court/sitting assignments, without altering who plays in any slot. Used after a
// manual single-slot edit so the tracker stays accurate without cascading a regeneration
// into later slots.
export function recomputeStats(schedule: SlotResult[], players: Player[]): GeneratorYield {
  const n = players.length;
  const gamesPlayed = new Array<number>(n).fill(0);
  const consecutivePlayed = new Array<number>(n).fill(0);
  const consecutiveRested = new Array<number>(n).fill(0);
  const nameToIdx = new Map(players.map((p, i) => [p.name, i]));

  const newSchedule = schedule.map(slot => {
    const playingIdx = new Set(
      slot.courts.flatMap(c => [...c.teamA, ...c.teamB]).map(p => nameToIdx.get(p.name)).filter(i => i !== undefined),
    );
    const availableIdx = new Set([
      ...playingIdx,
      ...slot.sitting.map(p => nameToIdx.get(p.name)).filter(i => i !== undefined),
    ]);
    for (let i = 0; i < n; i++) {
      if (playingIdx.has(i)) {
        gamesPlayed[i] = (gamesPlayed[i] ?? 0) + 1;
        consecutivePlayed[i] = (consecutivePlayed[i] ?? 0) + 1;
        consecutiveRested[i] = 0;
      } else if (availableIdx.has(i)) {
        consecutiveRested[i] = (consecutiveRested[i] ?? 0) + 1;
        consecutivePlayed[i] = 0;
      }
    }
    const playerState: PlayerState[] = players.map((p, i) => ({
      name: p.name,
      gender: p.gender,
      total: gamesPlayed[i]!,
      conPlayed: consecutivePlayed[i]!,
      conRested: consecutiveRested[i]!,
      playing: playingIdx.has(i),
      available: availableIdx.has(i),
    }));
    return { ...slot, playerState };
  });

  return { schedule: newSchedule, gamesPlayed: [...gamesPlayed] };
}

export function extractState(keptSlots: SlotResult[], players: Player[]): ScheduleState {
  const n = players.length;
  const gamesPlayed = new Array<number>(n).fill(0);
  const consecutivePlayed = new Array<number>(n).fill(0);
  const consecutiveRested = new Array<number>(n).fill(0);
  const partnerCount: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const opponentCount: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  if (keptSlots.length > 0) {
    const lastState = keptSlots[keptSlots.length - 1]!.playerState;
    lastState.forEach(ps => {
      const i = players.findIndex(p => p.name === ps.name);
      if (i >= 0) {
        gamesPlayed[i] = ps.total;
        consecutivePlayed[i] = ps.conPlayed;
        consecutiveRested[i] = ps.conRested;
      }
    });
    keptSlots.forEach(s => {
      s.courts.forEach(court => {
        const tA = court.teamA.map(p => players.findIndex(pl => pl.name === p.name));
        const tB = court.teamB.map(p => players.findIndex(pl => pl.name === p.name));
        if (tA.every(x => x >= 0) && tB.every(x => x >= 0)) {
          partnerCount[tA[0]!]![tA[1]!] = (partnerCount[tA[0]!]![tA[1]!] ?? 0) + 1;
          partnerCount[tA[1]!]![tA[0]!] = (partnerCount[tA[1]!]![tA[0]!] ?? 0) + 1;
          partnerCount[tB[0]!]![tB[1]!] = (partnerCount[tB[0]!]![tB[1]!] ?? 0) + 1;
          partnerCount[tB[1]!]![tB[0]!] = (partnerCount[tB[1]!]![tB[0]!] ?? 0) + 1;
          for (const a of tA) {
            for (const b of tB) {
              opponentCount[a!]![b!] = (opponentCount[a!]![b!] ?? 0) + 1;
              opponentCount[b!]![a!] = (opponentCount[b!]![a!] ?? 0) + 1;
            }
          }
        }
      });
    });
  }

  const courtGroupHistory = new Set<string>();
  keptSlots.forEach(s => {
    s.courts.forEach(court => {
      const g = [...court.teamA, ...court.teamB].map(p => players.findIndex(pl => pl.name === p.name));
      if (g.every(x => x >= 0)) courtGroupHistory.add(groupKey(g as number[]));
    });
  });

  // Bug fix: count womenDoublesCount from kept slots
  let womenDoublesCount = 0;
  keptSlots.forEach(s => {
    s.courts.forEach(court => {
      const isWD = (team: typeof court.teamA) =>
        team[0].gender === 'F' && team[1].gender === 'F';
      if (isWD(court.teamA) || isWD(court.teamB)) womenDoublesCount++;
    });
  });

  return {
    keptSlots,
    gamesPlayed,
    consecutivePlayed,
    consecutiveRested,
    partnerCount,
    opponentCount,
    courtGroupHistory,
    womenDoublesCount,
  };
}
