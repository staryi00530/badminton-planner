import type { Player, PlannerState, SharePayload, SlotResult } from '../types';
import { buildSharePayload, reconstructScheduleFromSharePayload } from './sharePayload';
import { DEFAULT_QUALITY_WEIGHTS, type QualityWeights } from './gameQuality';
import { publicPlayedGames } from './playedHistoryCodec';
export interface OrganizerSetup {
    v: 1;
    createdAt: number;
    players: Player[];
    playerHistory: PlannerState['playerHistory'];
    publicSession: SharePayload;
    hasPlan: boolean;
    preserveLineups?: boolean;
    /** Organizer-only forecast snapshots retain ledger-seeded totals after rerolls. */
    forecast?: { gamesPlayed: number[]; slots: Array<Pick<SlotResult, 'slot' | 'playerState' | 'repeatedCourts'>> };
    preferMixedTeams: boolean;
    preferredPairs: PlannerState['preferredPairs'];
    qualityWeights: QualityWeights;
    fromSlot: number;
    fromSlotCourts: number;
}
const MAX = 2 * 1024 * 1024, TTL = 7 * 86400000;
const invalid = () => new Error('Invalid organizer transfer');
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const int = (v: unknown, min = 0, max = 10000): v is number => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
function player(p: Player, availability: boolean): Player {
    if (!p || !text(p.name) || !['M', 'F'].includes(p.gender) || (p.id !== undefined && !text(p.id)) || (p.statsKey !== undefined && !text(p.statsKey))
        || (p.level !== undefined && !int(p.level, 1, 5)) || (p.quarantined !== undefined && typeof p.quarantined !== 'boolean')
        || (p.aliases !== undefined && (!Array.isArray(p.aliases) || p.aliases.length > 100 || !p.aliases.every(text)))
        || (availability && (!int(p.availFrom) || !int(p.availTo, -1) || (p.group !== undefined && !text(p.group)) || (p.leavesAt != null && !int(p.leavesAt, -1)))))
        throw invalid();
    return { name: p.name, gender: p.gender, ...(p.id !== undefined ? { id: p.id } : {}), ...(p.statsKey !== undefined ? { statsKey: p.statsKey } : {}),
        ...(p.aliases ? { aliases: [...p.aliases] } : {}), ...(p.level !== undefined ? { level: p.level } : {}), ...(p.quarantined !== undefined ? { quarantined: p.quarantined } : {}),
        ...(availability ? { availFrom: p.availFrom, availTo: p.availTo, ...(p.group !== undefined ? { group: p.group } : {}), ...(p.leavesAt !== undefined ? { leavesAt: p.leavesAt } : {}) } : {}) } as Player;
}
function forecastSnapshot(value: OrganizerSetup['forecast'], session: SharePayload): OrganizerSetup['forecast'] {
    if (value === undefined) return undefined;
    if (!value || !Array.isArray(value.gamesPlayed) || value.gamesPlayed.length > 2500 || !value.gamesPlayed.every(n => int(n, 0, 1000000))
        || !Array.isArray(value.slots) || value.slots.length !== session.slots.length) throw invalid();
    const slots = value.slots.map((slot, i) => {
        const planned = session.slots[i]!;
        if (!slot || slot.slot !== planned.s || !Array.isArray(slot.playerState) || slot.playerState.length > 2500
            || !Array.isArray(slot.repeatedCourts) || slot.repeatedCourts.length > planned.c.length
            || new Set(slot.repeatedCourts).size !== slot.repeatedCourts.length
            || !slot.repeatedCourts.every(court => int(court, 0, planned.c.length - 1))) throw invalid();
        const playerState = slot.playerState.map(p => {
            if (!p || !text(p.name) || !['M', 'F'].includes(p.gender)
                || !int(p.total, 0, 1000000) || !int(p.conPlayed, 0, 1000000) || !int(p.conRested, 0, 1000000)
                || typeof p.playing !== 'boolean' || typeof p.available !== 'boolean') throw invalid();
            return { name: p.name, gender: p.gender, total: p.total, conPlayed: p.conPlayed, conRested: p.conRested, playing: p.playing, available: p.available };
        });
        return { slot: slot.slot, playerState, repeatedCourts: [...slot.repeatedCourts] };
    });
    return { gamesPlayed: [...value.gamesPlayed], slots };
}
/** Validate the authenticated snapshot and rebuild every nested object from approved fields. */
function validate(value: unknown, now: number): OrganizerSetup {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX)
        throw invalid();
    const s = value as OrganizerSetup;
    if (!s || s.v !== 1 || (!Number.isFinite(s.createdAt) || s.createdAt < 0) || s.createdAt > now + 60000 || now - s.createdAt > TTL || !Array.isArray(s.players) || s.players.length > 500
        || !Array.isArray(s.playerHistory) || s.playerHistory.length > 2000 || typeof s.hasPlan !== 'boolean' || typeof s.preferMixedTeams !== 'boolean'
        || (s.preserveLineups !== undefined && typeof s.preserveLineups !== 'boolean') || !int(s.fromSlot, 1) || !int(s.fromSlotCourts, 0, 5) || !Array.isArray(s.preferredPairs) || s.preferredPairs.length > 10000
        || s.preferredPairs.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(text) || p[0] === p[1]))
        throw invalid();
    const players = s.players.map(p => player(p, true)), playerHistory = s.playerHistory.map(p => player(p as Player, false));
    for (const list of [players, playerHistory]) {
        const ids = list.flatMap(p => p.id ? [p.id] : []);
        if (new Set(ids).size !== ids.length)
            throw invalid();
    }
    const qualityWeights = {} as QualityWeights;
    for (const k of Object.keys(DEFAULT_QUALITY_WEIGHTS) as Array<keyof QualityWeights>) {
        const n = s.qualityWeights?.[k];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)
            throw invalid();
        qualityWeights[k] = n;
    }
    const p = s.publicSession, c = p?.cfg;
    if (!p || p.v !== 1 || !Array.isArray(p.p) || p.p.length > 2500 || !Array.isArray(p.slots) || p.slots.length > 10000 || !c || !int(c.g, 1, 1440) || !int(c.c, 1, 5)
        || !int(c.totalMinutes, 1, 100000) || typeof c.sessionStart !== 'string' || c.sessionStart.length > 100 || !['none', 'group', 'custom'].includes(c.staggerMode!)
        || !c.extraCourt || Array.isArray(c.extraCourt) || typeof c.extraCourt.enabled !== 'boolean' || !int(c.extraCourt.startMin) || !int(c.extraCourt.durationMin) || !c.courtOverrides || Array.isArray(c.courtOverrides)
        || Object.entries(c.courtOverrides).some(([k, v]) => !/^\d+$/.test(k) || !int(v, 1, 5)) || !Array.isArray(p.history) || p.history.length > 10000
        || Object.keys(p.scores ?? {}).length > 10000 || Object.entries(p.scores ?? {}).some(([k, v]) => !/^s\d+c\d+$/.test(k) || !v || typeof v.a !== 'string' || typeof v.b !== 'string' || v.a.length > 100 || v.b.length > 100 || typeof v.applied !== 'boolean')
        || !Array.isArray(p.runtime?.suspended) || !p.runtime.suspended.every(text))
        throw invalid();
    if (new Set(p.slots.map(slot => slot.s)).size !== p.slots.length || p.slots.some(slot => !int(slot.s, 1) || !Array.isArray(slot.c) || slot.c.length > 5 || slot.c.some(court => new Set(court.flat()).size !== 4)))
        throw invalid();
    const d = reconstructScheduleFromSharePayload(p, { currentGameMinutes: c.g!, currentNumCourts: c.c! });
    if (!s.hasPlan && p.slots.length)
        throw invalid();
    if (d.players.length !== players.length || d.players.some((v, i) => v.name !== players[i]!.name || v.id !== (players[i]!.id ?? `legacy:${players[i]!.name.toLocaleLowerCase()}`)))
        throw invalid();
    const forecast = forecastSnapshot(s.forecast, p);
    const refs = (games: typeof d.liveGames) => games.map(g => ({ slot: g.slot, court: g.court, ...(g.id ? { id: g.id } : {}), ...(g.startedAt !== undefined ? { startedAt: g.startedAt } : {}), ...(g.displayCourt !== undefined ? { displayCourt: g.displayCourt } : {}), ...(g.players ? { players: [...g.players] } : {}) }));
    for (const g of [...d.liveGames, ...d.completedGames])
        if ((g.startedAt !== undefined && (typeof g.startedAt !== 'number' || !Number.isInteger(g.startedAt) || g.startedAt < 0)) || (g.id !== undefined && !text(g.id)) || (g.displayCourt !== undefined && !int(g.displayCourt, 0, 4)) || (g.players !== undefined && (!Array.isArray(g.players) || g.players.length !== 4 || !g.players.every(text))))
            throw invalid();
    const publicSession = buildSharePayload({ result: d.result, playersWithAvailability: d.players, gameMinutes: d.gameMinutes, numCourts: d.numCourts, scores: d.scores, isConfirmed: d.isConfirmed,
        settings: { totalMinutes: d.totalMinutes, sessionStart: d.sessionStart, staggerMode: d.staggerMode, extraCourt: { enabled: d.extraCourt.enabled, startMin: d.extraCourt.startMin, durationMin: d.extraCourt.durationMin }, courtOverrides: { ...d.courtOverrides } },
        runtime: { live: refs(d.liveGames), completed: refs(d.completedGames), suspended: [...d.suspendedPlayerNames], waitingClock: d.waitingClock }, includeScoreDrafts: true, playedGames: publicPlayedGames(p.history), historyEpoch: d.historyEpoch })!;
    return { v: 1, createdAt: s.createdAt, players, playerHistory, publicSession, hasPlan: s.hasPlan, ...(forecast ? { forecast } : {}), ...(s.preserveLineups !== undefined ? { preserveLineups: s.preserveLineups } : {}), preferMixedTeams: s.preferMixedTeams, preferredPairs: s.preferredPairs.map(p => [p[0], p[1]]), qualityWeights, fromSlot: s.fromSlot, fromSlotCourts: s.fromSlotCourts };
}
export function buildOrganizerSetup(s: PlannerState, qualityWeights: QualityWeights, now = Date.now()): OrganizerSetup {
    const publicSession = buildSharePayload({ result: s.result ?? { schedule: [] }, playersWithAvailability: s.players, gameMinutes: s.gameMinutes, numCourts: s.numCourts, scores: s.scores, isConfirmed: s.isConfirmed,
        settings: { totalMinutes: s.totalMinutes, sessionStart: s.sessionStart, staggerMode: s.staggerMode, extraCourt: s.extraCourt, courtOverrides: s.courtOverrides }, runtime: { live: s.liveGames, completed: s.completedGames, suspended: s.suspendedPlayerNames, waitingClock: s.waitingClock }, includeScoreDrafts: true, playedGames: s.playedGames, historyEpoch: s.historyEpoch })!;
    return validate({ v: 1, createdAt: now, players: s.players, playerHistory: s.playerHistory, publicSession, hasPlan: !!s.result, ...(s.result ? { forecast: { gamesPlayed: s.result.gamesPlayed, slots: s.result.schedule.map(slot => ({slot:slot.slot,playerState:slot.playerState,repeatedCourts:slot.repeatedCourts})) } } : {}), ...(s.result?.preserveLineups !== undefined ? { preserveLineups: s.result.preserveLineups } : {}), preferMixedTeams: s.preferMixedTeams, preferredPairs: s.preferredPairs, qualityWeights, fromSlot: s.fromSlot, fromSlotCourts: s.fromSlotCourts }, now);
}
export function organizerSetupPatch(setup: OrganizerSetup): Partial<PlannerState> {
    const s = validate(setup, Date.now()), d = reconstructScheduleFromSharePayload(s.publicSession, { currentGameMinutes: s.publicSession.cfg!.g!, currentNumCourts: s.publicSession.cfg!.c! });
    const result = s.hasPlan && d.result.schedule.length ? {
        ...d.result,
        ...(s.forecast ? { gamesPlayed: [...s.forecast.gamesPlayed], schedule: d.result.schedule.map((slot, i) => ({ ...slot,
            playerState: structuredClone(s.forecast!.slots[i]!.playerState), repeatedCourts: [...s.forecast!.slots[i]!.repeatedCourts] })) } : {}),
        ...(s.preserveLineups !== undefined ? { preserveLineups: s.preserveLineups } : {})
    } : null;
    return { ...d, players: structuredClone(s.players), playerHistory: structuredClone(s.playerHistory), result, preferMixedTeams: s.preferMixedTeams, preferredPairs: structuredClone(s.preferredPairs), fromSlot: s.fromSlot, fromSlotCourts: s.fromSlotCourts,
        undoSnapshot: null, loadedPlanId: null, scheduleDirty: false, editingSlot: null, editLayout: null, pendingOverwrite: null, sessionChangeNotice: null, pendingSessionChange: null, queueAdjustment: null, queuePromotionPrompt: null };
}
function encode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(s: unknown): Uint8Array<ArrayBuffer> {
    if (typeof s !== 'string' || !s || !/^[A-Za-z0-9_-]+$/.test(s) || s.length > MAX * 2)
        throw invalid();
    const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function encryptOrganizerSetup(setup: OrganizerSetup): Promise<{
    envelope: unknown;
    key: string;
}> {
    try {
        const clean = validate(setup, setup.createdAt), raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(clean))));
        return { envelope: { v: 1, p: [['Organizer setup', '?']], slots: [], organizerTransfer: { v: 1, iv: encode(iv), ciphertext: encode(ciphertext) } }, key: encode(raw) };
    }
    catch {
        throw invalid();
    }
}
export async function decryptOrganizerSetup(envelope: unknown, key: string, now = Date.now()): Promise<OrganizerSetup> {
    try {
        const e = envelope as {
            v: number;
            organizerTransfer: {
                v: number;
                iv: string;
                ciphertext: string;
            };
        };
        if (!e || e.v !== 1 || e.organizerTransfer?.v !== 1)
            throw invalid();
        const raw = decode(key), iv = decode(e.organizerTransfer.iv), ciphertext = decode(e.organizerTransfer.ciphertext);
        if (raw.length !== 32 || iv.length !== 12 || ciphertext.length > MAX + 16)
            throw invalid();
        const imported = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, imported, ciphertext);
        return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)), now);
    }
    catch {
        throw invalid();
    }
}
