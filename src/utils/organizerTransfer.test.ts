import { describe, expect, it } from 'vitest';
import type { PlannerState } from '../types';
import { DEFAULT_QUALITY_WEIGHTS } from './gameQuality';
import { generateSchedule } from '../algorithm/scheduler';
import { buildOrganizerSetup, decryptOrganizerSetup, encryptOrganizerSetup, organizerSetupPatch } from './organizerTransfer';
const now = Date.now();
function state(): PlannerState {
    const players = Array.from({ length: 35 }, (_, i) => ({ id: `id-${i}`, name: `羽球 É ${i}`, gender: 'M' as const, level: (i % 5 + 1) as 1 | 2 | 3 | 4 | 5, aliases: [`alias-${i}`], statsKey: `stats-${i}`, availFrom: 0, availTo: 10, quarantined: i === 34 }));
    return { players, playerHistory: players.map(({ availFrom, availTo, ...p }) => p), result: null, scores: {}, playedGames: [], historyEpoch: 3, gameMinutes: 15, numCourts: 4, totalMinutes: 180, sessionStart: '18:00', staggerMode: 'none', extraCourt: { enabled: false, startMin: 60, durationMin: 90 }, courtOverrides: {}, liveGames: [], completedGames: [], suspendedPlayerNames: [], isConfirmed: false, preferMixedTeams: true, preferredPairs: [[players[0]!.name, players[1]!.name]], fromSlot: 2, fromSlotCourts: 0, shareToken: 'SECRET', pinInput: 'SECRET', winLoss: { SECRET: { wins: 9, losses: 0 } }, savedPlans: [] } as unknown as PlannerState;
}
describe('organizer transfer', () => {
    it('preserves 35 private players and setup-only preferences without credentials', async () => {
        const source = state(), setup = buildOrganizerSetup(source, DEFAULT_QUALITY_WEIGHTS, now);
        source.players[0]!.name = 'changed';
        const encrypted = await encryptOrganizerSetup(setup);
        expect(JSON.stringify(encrypted.envelope)).not.toMatch(/羽球|alias-|stats-|level|SECRET/);
        expect(JSON.stringify(setup)).not.toContain('SECRET');
        const restored = await decryptOrganizerSetup(encrypted.envelope, encrypted.key, now);
        expect(restored.players).toEqual(state().players);
        expect(organizerSetupPatch(restored)).toMatchObject({ players: state().players, playerHistory: state().playerHistory, result: null, preferMixedTeams: true, preferredPairs: state().preferredPairs, fromSlot: 2, fromSlotCourts: 0 });
    });
    it('preserves schedule, score drafts, live/completed games and history', async () => {
        const s = state();
        s.result = generateSchedule(s.players, 2, [4, 4], 0, null, null, {})!;
        s.result.planId = 'plan';
        s.scores = { s1c0: { a: '12', b: '9', applied: false, teamA: s.result.schedule[0]!.courts[0]!.teamA.map(p => p.name), teamB: s.result.schedule[0]!.courts[0]!.teamB.map(p => p.name) } };
        s.liveGames = [{ slot: 1, court: 0, displayCourt: 2 }];
        s.completedGames = [{ slot: 1, court: 1 }];
        const c = s.result.schedule[0]!.courts[1]!;
        s.playedGames = [{ id: 'played', planId: 'old-plan', slot: 1, court: 1, completedAt: 123, teamA: c.teamA.map(p => ({ id: p.id!, name: p.name, gender: p.gender })) as any, teamB: c.teamB.map(p => ({ id: p.id!, name: p.name, gender: p.gender })) as any, waitingIds: ['id-0'] }];
        const setup = buildOrganizerSetup(s, DEFAULT_QUALITY_WEIGHTS, now), encrypted = await encryptOrganizerSetup(setup);
        const patch = organizerSetupPatch(await decryptOrganizerSetup(encrypted.envelope, encrypted.key, now));
        expect(patch.scores).toEqual(s.scores);
        expect(patch.liveGames).toEqual(s.liveGames);
        expect(patch.completedGames).toEqual(s.completedGames);
        expect(patch.playedGames).toEqual(s.playedGames);
        expect(patch.result?.schedule).toHaveLength(2);
    });
    it('rejects wrong keys, tampering, expiry, malformed private values and bounds', async () => {
        const setup = buildOrganizerSetup(state(), DEFAULT_QUALITY_WEIGHTS, now), a = await encryptOrganizerSetup(setup), b = await encryptOrganizerSetup(setup);
        expect(a.key).not.toEqual(b.key);
        await expect(decryptOrganizerSetup(a.envelope, b.key, now)).rejects.toThrow('Invalid organizer transfer');
        await expect(decryptOrganizerSetup({}, a.key, now)).rejects.toThrow('Invalid organizer transfer');
        await expect(decryptOrganizerSetup(a.envelope, '', now)).rejects.toThrow('Invalid organizer transfer');
        const tampered = structuredClone(a.envelope) as any;
        const ciphertext = tampered.organizerTransfer.ciphertext;
        tampered.organizerTransfer.ciphertext = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
        await expect(decryptOrganizerSetup(tampered, a.key, now)).rejects.toThrow('Invalid organizer transfer');
        await expect(decryptOrganizerSetup(a.envelope, a.key, now + 7 * 86400000 + 1)).rejects.toThrow('Invalid organizer transfer');
        expect(() => buildOrganizerSetup({ ...state(), players: [{ ...state().players[0]!, level: 9 }] } as any, DEFAULT_QUALITY_WEIGHTS, now)).toThrow();
        expect(() => buildOrganizerSetup({ ...state(), players: Array(501).fill(state().players[0]) }, DEFAULT_QUALITY_WEIGHTS, now)).toThrow();
        expect(() => buildOrganizerSetup(state(), { ...DEFAULT_QUALITY_WEIGHTS, levels: NaN }, now)).toThrow();
        expect(() => buildOrganizerSetup(state(), DEFAULT_QUALITY_WEIGHTS, -1)).toThrow();
        expect(() => buildOrganizerSetup({ ...state(), playerHistory: Array(2001).fill(state().playerHistory[0]) }, DEFAULT_QUALITY_WEIGHTS, now)).toThrow();
    });
    it('retains removed historical players without reactivating them and preserves lineups', async () => {
        const s = state();
        s.result = generateSchedule(s.players, 1, [4], 0, null, null, {})!;
        s.result.preserveLineups = true;
        const historical = s.result.schedule[0]!.courts[0]!.teamA[0]!;
        s.players = s.players.filter(p => p.id !== historical.id);
        const setup = buildOrganizerSetup(s, DEFAULT_QUALITY_WEIGHTS, now), encrypted = await encryptOrganizerSetup(setup);
        const patch = organizerSetupPatch(await decryptOrganizerSetup(encrypted.envelope, encrypted.key, now));
        expect(patch.players).toEqual(s.players);
        expect(patch.result?.schedule[0]!.courts[0]!.teamA[0]).toEqual({ id: historical.id, name: historical.name, gender: historical.gender });
        expect(patch.result?.preserveLineups).toBe(true);
    });
    it('preserves ledger-seeded forecast totals and streaks after a recovery reroll', async () => {
        const s = state();
        s.result = generateSchedule(s.players, 2, [4, 4], 0, null, null, {})!;
        s.result.planId = 'recovery-plan';
        const court = s.result.schedule[0]!.courts[0]!;
        s.playedGames = [{ id: 'old-finish', planId: 'previous-plan', slot: 1, court: 0, completedAt: 123,
            teamA: court.teamA.map(p => ({ id: p.id!, name: p.name, gender: p.gender })) as any,
            teamB: court.teamB.map(p => ({ id: p.id!, name: p.name, gender: p.gender })) as any, waitingIds: [] }];
        s.result.gamesPlayed = s.result.gamesPlayed.map(total => total + 5);
        for (const slot of s.result.schedule) {
            slot.playerState = slot.playerState.map(p => ({ ...p, total: p.total + 5, conPlayed: p.playing ? 3 : 0, conRested: p.playing ? 0 : 4 }));
            slot.repeatedCourts = [0, 2];
        }
        const expected = structuredClone(s.result);
        const encrypted = await encryptOrganizerSetup(buildOrganizerSetup(s, DEFAULT_QUALITY_WEIGHTS, now));
        const patch = organizerSetupPatch(await decryptOrganizerSetup(encrypted.envelope, encrypted.key, now));
        expect(patch.result?.gamesPlayed).toEqual(expected.gamesPlayed);
        expect(patch.result?.schedule.map(slot => slot.playerState)).toEqual(expected.schedule.map(slot => slot.playerState));
        expect(patch.result?.schedule.map(slot => slot.repeatedCourts)).toEqual(expected.schedule.map(slot => slot.repeatedCourts));
        expect(patch.playedGames).toEqual(s.playedGames);
    });
    it('validates and whitelists organizer forecast snapshots', async () => {
        const s = state();
        s.result = generateSchedule(s.players, 1, [4], 0, null, null, {})!;
        const setup = buildOrganizerSetup(s, DEFAULT_QUALITY_WEIGHTS, now);
        (setup.forecast!.slots[0]!.playerState[0] as any).token = 'SECRET';
        const encrypted = await encryptOrganizerSetup(setup);
        const restored = await decryptOrganizerSetup(encrypted.envelope, encrypted.key, now);
        expect(JSON.stringify(restored)).not.toContain('SECRET');
        for (const field of ['total', 'conPlayed', 'conRested'] as const) {
            const malformed = structuredClone(setup);
            malformed.forecast!.slots[0]!.playerState[0]![field] = -1;
            await expect(encryptOrganizerSetup(malformed)).rejects.toThrow('Invalid organizer transfer');
        }
        const malformed = structuredClone(setup);
        malformed.forecast!.slots[0]!.playerState[0]!.gender = '?' as any;
        await expect(encryptOrganizerSetup(malformed)).rejects.toThrow('Invalid organizer transfer');
        malformed.forecast = { gamesPlayed: Array(2501).fill(0), slots: [] };
        await expect(encryptOrganizerSetup(malformed)).rejects.toThrow('Invalid organizer transfer');
    });
    it('whitelists arbitrary private and nested metadata', () => {
        const s = state();
        (s.players[0] as any).token = 'SECRET';
        (s.extraCourt as any).pin = 'SECRET';
        const setup = buildOrganizerSetup(s, { ...DEFAULT_QUALITY_WEIGHTS, token: 'SECRET' } as any, now);
        expect(JSON.stringify(setup)).not.toContain('SECRET');
        expect(organizerSetupPatch(setup)).not.toHaveProperty('winLoss');
        expect(organizerSetupPatch(setup)).not.toHaveProperty('savedPlans');
    });
});
