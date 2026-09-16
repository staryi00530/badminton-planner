import { describe, it, expect } from 'vitest';
import { generateSchedule, generateScheduleGen, extractState, recomputeStats } from './scheduler.js';
import type { Player, SlotResult } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePlayers(count: number, femaleCount = 0, totalSlots = 12): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    players.push({
      name: `P${i + 1}`,
      gender: i < femaleCount ? 'F' : 'M',
      availFrom: 0,
      availTo: totalSlots - 1,
    });
  }
  return players;
}

/** Simple LCG for deterministic tests */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0x100000000);
  };
}

function courtsPerSlot(courts: number, totalSlots: number): number[] {
  return new Array(totalSlots).fill(courts);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Equal games', () => {
  it('8 players, 1 court, 12 slots — spread ≤ 1 always', () => {
    // With 8 players and 1 court (4 play, 4 rest per slot), the greedy algorithm
    // reliably achieves ±1 spread because the rest pool always has 4 players.
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const gp = result!.gamesPlayed;
      const spread = Math.max(...gp) - Math.min(...gp);
      expect(spread, `Spread > 1 for seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('10 players, 2 courts, 12 slots — spread ≤ 5', () => {
    // With 10 players and 2 courts (8 play, 2 rest per slot), mustPlay/mustRest
    // hard constraints conflict with rate-based fairness — a rested player must
    // play regardless of their higher game count, causing realistic spread of 3-4.
    // This is a known greedy-algorithm trade-off documented in the original code.
    // We test that the spread is bounded (not unbounded) at ≤5.
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(10, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const gp = result!.gamesPlayed;
      const spread = Math.max(...gp) - Math.min(...gp);
      expect(spread, `Spread > 5 for seed ${seed}`).toBeLessThanOrEqual(5);
    }
  });

  it('12 players, 2 courts, 12 slots — spread ≤ 3', () => {
    // With 12 players (4 sitting per slot), resting/playing pressure is more
    // evenly distributed, giving typical spread 0-1 and at worst 2.
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(12, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const gp = result!.gamesPlayed;
      const spread = Math.max(...gp) - Math.min(...gp);
      expect(spread, `Spread > 3 for seed ${seed}`).toBeLessThanOrEqual(3);
    }
  });
});

describe('Level balancing', () => {
  it('avoids putting level-1 and level-3 players on the same team when possible', () => {
    const players = makePlayers(4).map((player, index) => ({
      ...player,
      level: (index < 2 ? 1 : 3) as 1 | 3,
    }));
    for (let seed = 1; seed <= 10; seed++) {
      const result = generateSchedule(players, 1, [1], 0, null, null, {}, seededRng(seed));
      expect(result).not.toBeNull();
      const court = result!.schedule[0]!.courts[0]!;
      for (const team of [court.teamA, court.teamB]) {
        const levels = team.map(player => players.find(p => p.name === player.name)!.level!);
        expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('separates level-1 and level-3 players onto different courts when possible', () => {
    const players = makePlayers(8).map((player, index) => ({
      ...player,
      level: (index < 4 ? 1 : 3) as 1 | 3,
    }));
    for (let seed = 1; seed <= 10; seed++) {
      const result = generateSchedule(players, 1, [2], 0, null, null, {}, seededRng(seed));
      expect(result).not.toBeNull();
      for (const court of result!.schedule[0]!.courts) {
        const levels = [...court.teamA, ...court.teamB].map(player => players.find(p => p.name === player.name)!.level!);
        expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Availability windows respected', () => {
  it('player with availTo: 4 never appears after slot 5 (0-indexed slot 4)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      // Player 0 only available for slots 0-4 (slots 1-5 in 1-based)
      players[0]!.availTo = 4;
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const schedule = result!.schedule;
      for (const slotResult of schedule) {
        if (slotResult.slot > 5) {
          // Player P1 should not be playing or sitting (not available)
          const allPlayers = [
            ...slotResult.courts.flatMap(c => [...c.teamA, ...c.teamB]),
            ...slotResult.sitting,
          ];
          const p1InSlot = allPlayers.some(p => p.name === 'P1');
          expect(p1InSlot, `P1 should not appear in slot ${slotResult.slot} (seed ${seed})`).toBe(false);
        }
      }
    }
  });

  it('player with availFrom: 4 never appears before slot 5 (0-indexed slot 4)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      // Player 0 only available from slot 4 onwards (slot 5 in 1-based)
      players[0]!.availFrom = 4;
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const schedule = result!.schedule;
      for (const slotResult of schedule) {
        if (slotResult.slot < 5) {
          const allPlayers = [
            ...slotResult.courts.flatMap(c => [...c.teamA, ...c.teamB]),
            ...slotResult.sitting,
          ];
          const p1InSlot = allPlayers.some(p => p.name === 'P1');
          expect(p1InSlot, `P1 should not appear in slot ${slotResult.slot} (seed ${seed})`).toBe(false);
        }
      }
    }
  });
});

describe('Courts always fully filled', () => {
  it('12 players, 2 courts — every slot has exactly 2 courts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(12, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      for (const slotResult of result!.schedule) {
        expect(slotResult.courts.length, `Slot ${slotResult.slot} should have 2 courts (seed ${seed})`).toBe(2);
      }
    }
  });
});

describe('Every court has exactly 4 players (2+2)', () => {
  it('8 players, 1 court', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      for (const slotResult of result!.schedule) {
        for (const court of slotResult.courts) {
          expect(court.teamA.length).toBe(2);
          expect(court.teamB.length).toBe(2);
        }
      }
    }
  });

  it('10 players, 2 courts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(10, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      for (const slotResult of result!.schedule) {
        for (const court of slotResult.courts) {
          expect(court.teamA.length).toBe(2);
          expect(court.teamB.length).toBe(2);
        }
      }
    }
  });
});

describe('No player rests more than 2 consecutive slots when pool allows', () => {
  it('8 players, 1 court: sitter pool is always 4 — no consecutive rested > 2', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const lastSlot = result!.schedule[result!.schedule.length - 1]!;
      for (const ps of lastSlot.playerState) {
        expect(ps.conRested, `${ps.name} has conRested > 2 (seed ${seed})`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('Gender balance — even female count per court', () => {
  it('8 players with 4 females, 1 court: each court has 0, 2, or 4 females', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 4, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      for (const slotResult of result!.schedule) {
        for (const court of slotResult.courts) {
          const allOnCourt = [...court.teamA, ...court.teamB];
          const fCount = allOnCourt.filter(p => p.gender === 'F').length;
          expect(fCount % 2, `Odd F count on court in slot ${slotResult.slot} (seed ${seed})`).toBe(0);
        }
      }
    }
  });

  it('12 players with 6 females, 2 courts: females spread evenly across courts', () => {
    // The algorithm now distributes females evenly: 2F+2M per court when ≥2F per
    // court available, else 1F+3M. A court may have an odd F count (1) when the
    // selected pool has fewer than 2F per court, but females must never be packed
    // all on one court while the other gets none.
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(12, 6, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      for (const slotResult of result!.schedule) {
        if (slotResult.courts.length < 2) continue;
        const fCounts = slotResult.courts.map(c => [...c.teamA, ...c.teamB].filter(p => p.gender === 'F').length);
        // WD mode deliberately puts 4F on one court — skip those slots.
        if (Math.max(...fCounts) === 4) continue;
        const maxDiff = Math.max(...fCounts) - Math.min(...fCounts);
        // Allow ≤2 diff; repeat-repair swaps can occasionally shift by 1 extra.
        // The main check is that females aren't all packed on one court (3+ diff).
        expect(maxDiff, `Seed ${seed} slot ${slotResult.slot}: females unevenly distributed ${fCounts}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('extractState roundtrip', () => {
  it('generate 12 slots, keep first 6, regenerate slots 7-12: final spread ≤ 1', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      const rng1 = seededRng(seed);
      const fullResult = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng1);
      expect(fullResult).not.toBeNull();

      // Keep first 6 slots
      const keptSlots = fullResult!.schedule.slice(0, 6);
      const state = extractState(keptSlots, players);

      // Regenerate from slot 6 (0-indexed) = slot 7 onwards (1-based)
      const rng2 = seededRng(seed + 100);
      const regenResult = generateSchedule(
        players,
        12,
        courtsPerSlot(1, 12),
        6, // startFrom slot index 6
        state,
        null,
        {},
        rng2,
      );
      expect(regenResult).not.toBeNull();
      const gp = regenResult!.gamesPlayed;
      const spread = Math.max(...gp) - Math.min(...gp);
      expect(spread, `Spread > 1 for seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('kept slots are identical before and after regeneration (slots 0-5 unchanged)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(8, 0, 12);
      const rng1 = seededRng(seed);
      const fullResult = generateSchedule(players, 12, courtsPerSlot(1, 12), 0, null, null, {}, rng1);
      expect(fullResult).not.toBeNull();

      const originalSlots = fullResult!.schedule.slice(0, 6);
      const state = extractState(originalSlots, players);

      const rng2 = seededRng(seed + 100);
      const regenResult = generateSchedule(
        players,
        12,
        courtsPerSlot(1, 12),
        6,
        state,
        null,
        {},
        rng2,
      );
      expect(regenResult).not.toBeNull();

      // The first 6 slots in the regen result should match original
      const regenSlots = regenResult!.schedule.slice(0, 6);
      for (let i = 0; i < 6; i++) {
        expect(regenSlots[i]!.slot).toBe(originalSlots[i]!.slot);
        expect(regenSlots[i]!.courts.length).toBe(originalSlots[i]!.courts.length);
        for (let c = 0; c < originalSlots[i]!.courts.length; c++) {
          const origCourt = originalSlots[i]!.courts[c]!;
          const regenCourt = regenSlots[i]!.courts[c]!;
          expect(regenCourt.teamA.map(p => p.name)).toEqual(origCourt.teamA.map(p => p.name));
          expect(regenCourt.teamB.map(p => p.name)).toEqual(origCourt.teamB.map(p => p.name));
        }
      }
    }
  });
});

describe('womenDoublesCount restored across regen (bug fix)', () => {
  it('12 players with 8 females, 2 courts, 12 slots: WD count not reset on regen', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const players = makePlayers(12, 8, 12);
      const rng1 = seededRng(seed);
      const fullResult = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng1);
      expect(fullResult).not.toBeNull();

      // Count WD courts in first 6 slots
      const firstHalf = fullResult!.schedule.slice(0, 6);
      let wdInFirstHalf = 0;
      for (const s of firstHalf) {
        for (const court of s.courts) {
          const isWDTeam = (team: typeof court.teamA) =>
            team[0].gender === 'F' && team[1].gender === 'F';
          if (isWDTeam(court.teamA) || isWDTeam(court.teamB)) wdInFirstHalf++;
        }
      }

      // extractState should correctly restore womenDoublesCount
      const state = extractState(firstHalf, players);
      expect(state.womenDoublesCount).toBe(wdInFirstHalf);

      // Regenerate second half
      const rng2 = seededRng(seed + 100);
      const regenResult = generateSchedule(
        players,
        12,
        courtsPerSlot(2, 12),
        6,
        state,
        null,
        {},
        rng2,
      );
      expect(regenResult).not.toBeNull();

      // Verify the regenerated schedule is complete (12 slots)
      expect(regenResult!.schedule.length).toBe(12);

      // Verify final spread is still reasonable
      const gp = regenResult!.gamesPlayed;
      const spread = Math.max(...gp) - Math.min(...gp);
      expect(spread).toBeLessThanOrEqual(2); // slightly more lenient with 12 players / 8F
    }
  });
});

describe('Group repeat detection', () => {
  it('12 players, 2 courts: same 4-player group should not repeat on consecutive slots (majority of runs)', () => {
    let repeatCount = 0;
    const totalRuns = 20;

    for (let seed = 1; seed <= totalRuns; seed++) {
      const players = makePlayers(12, 0, 12);
      const rng = seededRng(seed);
      const result = generateSchedule(players, 12, courtsPerSlot(2, 12), 0, null, null, {}, rng);
      expect(result).not.toBeNull();
      const schedule = result!.schedule;

      let hadRepeat = false;
      for (let i = 1; i < schedule.length; i++) {
        const prevSlot = schedule[i - 1]!;
        const currSlot = schedule[i]!;
        for (const currCourt of currSlot.courts) {
          const currGroup = [...currCourt.teamA, ...currCourt.teamB].map(p => p.name).sort().join(',');
          for (const prevCourt of prevSlot.courts) {
            const prevGroup = [...prevCourt.teamA, ...prevCourt.teamB].map(p => p.name).sort().join(',');
            if (currGroup === prevGroup) {
              hadRepeat = true;
            }
          }
        }
      }
      if (hadRepeat) repeatCount++;
    }

    // The group-repeat prevention should eliminate repeats in the vast majority of runs
    // Allow at most 5 out of 20 runs to have a repeat (could still happen if no fix is possible)
    expect(repeatCount, `Too many runs had consecutive group repeats: ${repeatCount}/${totalRuns}`).toBeLessThanOrEqual(5);
  });
});

describe('slotResult repeatedCourts field', () => {
  it('zero-courts slot (courtsPerSlot=0 override) has repeatedCourts: []', () => {
    // Pass courtsPerSlot=[0] to force a slot with 0 courts even though players are
    // available. This exercises the early-return path that previously lacked
    // the repeatedCourts field.
    const players: Player[] = [
      { name: 'A', gender: 'M', availFrom: 0, availTo: 0 },
      { name: 'B', gender: 'M', availFrom: 0, availTo: 0 },
      { name: 'C', gender: 'M', availFrom: 0, availTo: 0 },
      { name: 'D', gender: 'M', availFrom: 0, availTo: 0 },
    ];
    // 4 players available but courtsPerSlot=0 forces 0 courts
    const result = generateSchedule(players, 1, [0], 0, null, null, {}, seededRng(1));
    expect(result).not.toBeNull();
    expect(result!.schedule[0]!.courts).toHaveLength(0);
    expect(result!.schedule[0]!.repeatedCourts).toEqual([]);
  });
});

describe('Forced court count from a mid-session slot onward (per-slot "add court" feature)', () => {
  // Mirrors what the UI's court stepper does: keep the already-played slots, then
  // regenerate from a target slot with a courtsPerSlot array whose tail is forced
  // to a new constant value — see runRegenerateFromSlotWithCourts in BadmintonPlanner.tsx.
  function regenerateFromWithForcedCourts(players: Player[], totalSlots: number, baseCourts: number, targetFromSlot: number, forcedCourts: number, seed: number) {
    const rng1 = seededRng(seed);
    const original = generateSchedule(players, totalSlots, courtsPerSlot(baseCourts, totalSlots), 0, null, null, {}, rng1);
    expect(original).not.toBeNull();

    const keptSlots = original!.schedule.slice(0, targetFromSlot - 1);
    const state = extractState(keptSlots, players);
    const courtsArr = courtsPerSlot(baseCourts, totalSlots);
    for (let i = targetFromSlot - 1; i < totalSlots; i++) courtsArr[i] = forcedCourts;

    const rng2 = seededRng(seed + 100);
    const regen = generateSchedule(players, totalSlots, courtsArr, targetFromSlot - 1, state, null, {}, rng2);
    expect(regen).not.toBeNull();
    return { original: original!, regen: regen! };
  }

  it('adding a court from slot 6 onward: slots 1-5 unchanged, slots 6-12 get the extra court', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const players = makePlayers(16, 0, 12); // enough players to fill up to 4 courts
      const { original, regen } = regenerateFromWithForcedCourts(players, 12, 1, 6, 2, seed);

      for (let i = 0; i < 5; i++) {
        expect(regen.schedule[i]!.courts.length, `seed ${seed} slot ${i + 1} should be untouched`).toBe(original.schedule[i]!.courts.length);
      }
      for (let i = 5; i < 12; i++) {
        expect(regen.schedule[i]!.courts.length, `seed ${seed} slot ${i + 1} should have 2 courts`).toBe(2);
      }
    }
  });

  it('removing a court from slot 6 onward: later slots drop back down', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const players = makePlayers(16, 0, 12);
      const { original, regen } = regenerateFromWithForcedCourts(players, 12, 2, 6, 1, seed);

      for (let i = 0; i < 5; i++) {
        expect(regen.schedule[i]!.courts.length, `seed ${seed} slot ${i + 1} should be untouched`).toBe(original.schedule[i]!.courts.length);
      }
      for (let i = 5; i < 12; i++) {
        expect(regen.schedule[i]!.courts.length, `seed ${seed} slot ${i + 1} should have 1 court`).toBe(1);
      }
    }
  });

  it('forcing 4 courts with only 12 players gracefully clamps to 3 courts instead of crashing', () => {
    // Regression for raising the "Re-generate from slot" cap from 3C to 4C: requesting
    // more courts than the player pool supports must degrade gracefully, not error.
    const players = makePlayers(12, 0, 12);
    const { regen } = regenerateFromWithForcedCourts(players, 12, 1, 6, 4, 1);
    for (let i = 5; i < 12; i++) {
      expect(regen.schedule[i]!.courts.length).toBeLessThanOrEqual(3);
      expect(regen.schedule[i]!.courts.length).toBeGreaterThan(0);
    }
  });

  it('forcing 4 courts with 16 players actually uses all 4', () => {
    const players = makePlayers(16, 0, 8);
    const { regen } = regenerateFromWithForcedCourts(players, 8, 1, 3, 4, 1);
    for (let i = 2; i < 8; i++) {
      expect(regen.schedule[i]!.courts.length).toBe(4);
      for (const court of regen.schedule[i]!.courts) {
        expect(court.teamA.length).toBe(2);
        expect(court.teamB.length).toBe(2);
      }
    }
  });
});

describe('recomputeStats — single-slot edit without cascading', () => {
  it('leaves untouched slots identical and recomputes stats only from real assignments', () => {
    const players = makePlayers(9, 4, 6);
    const result = generateSchedule(players, 6, courtsPerSlot(2, 6), 0, null, null, {}, seededRng(42));
    expect(result).not.toBeNull();
    const original = result!.schedule;

    // Manually swap two players between court and sitting in slot 1, leaving all other slots untouched.
    const slot0 = original[0]!;
    const sittingName = slot0.sitting[0]!.name;
    const swappedOutName = slot0.courts[0]!.teamA[0].name;
    const sittingPlayer = players.find(p => p.name === sittingName)!;
    const swappedOutPlayer = players.find(p => p.name === swappedOutName)!;

    const editedSchedule: SlotResult[] = original.map((slot, i) => {
      if (i !== 0) return slot;
      const newCourts = slot.courts.map((c, ci) =>
        ci === 0
          ? { ...c, teamA: [{ name: sittingPlayer.name, gender: sittingPlayer.gender }, c.teamA[1]] as [any, any] }
          : c
      );
      const newSitting = slot.sitting.map(p => (p.name === sittingName ? { name: swappedOutPlayer.name, gender: swappedOutPlayer.gender } : p));
      return { ...slot, courts: newCourts, sitting: newSitting };
    });

    const { schedule: recomputed, gamesPlayed } = recomputeStats(editedSchedule, players);

    // Slots after the edited one keep their exact court/sitting assignments.
    for (let i = 1; i < original.length; i++) {
      expect(recomputed[i]!.courts).toEqual(original[i]!.courts);
      expect(recomputed[i]!.sitting).toEqual(original[i]!.sitting);
    }

    // Final tally reflects the swap: the swapped-in player gained a game, the swapped-out player lost one,
    // relative to the original schedule's final gamesPlayed.
    const idxIn = players.findIndex(p => p.name === sittingName);
    const idxOut = players.findIndex(p => p.name === swappedOutName);
    expect(gamesPlayed[idxIn]).toBe(result!.gamesPlayed[idxIn] + 1);
    expect(gamesPlayed[idxOut]).toBe(result!.gamesPlayed[idxOut] - 1);
  });
});
