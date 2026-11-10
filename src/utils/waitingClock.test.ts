import { describe, it, expect } from 'vitest';
import { reconcileWaitingClock, validWaitingClock, waitingPlayerStatuses, waitingPlayerKey } from './waitingClock';
import type { WaitingClockContext } from './waitingClock';
const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: 'M' as const, skill: 2, availFrom: 0, availTo: 2 }));
const context: WaitingClockContext = { players, result: { schedule: [1, 2, 3].map(slot => ({ slot, courts: [{ court: 1, teamA: [players[0]!, players[1]!] as [typeof players[0], typeof players[0]], teamB: [players[2]!, players[3]!] as [typeof players[0], typeof players[0]] }], sitting: [], playerState: [], repeatedCourts: [] })), gamesPlayed: [] }, liveGames: [{ slot: 1, court: 0 }], completedGames: [], staggerMode: 'none', suspendedPlayerNames: [] };
describe('waiting clocks', () => {
  it('does not count preparation, then times only available bench players', () => {
    expect(reconcileWaitingClock(undefined, context, context, 100)).toEqual({ since: {} });
    const clock = reconcileWaitingClock(undefined, context, context, 100, { start: true });
    expect(clock).toEqual({ trackingStartedAt: 100, since: { p4: 100, p5: 100, p6: 100, p7: 100 } });
    expect(reconcileWaitingClock(clock, context, context, 200)).toBe(clock);
  });
  it('clears unavailable clocks and starts fresh on return, preserving identity on rename', () => {
    const clock = reconcileWaitingClock(undefined, context, context, 100, { start: true });
    const away = { ...context, suspendedPlayerNames: ['P4'] };
    const departed = reconcileWaitingClock(clock, context, away, 200);
    expect(departed.since.p4).toBeUndefined();
    expect(reconcileWaitingClock(departed, away, context, 300).since.p4).toBe(300);
    const renamed = { ...context, players: players.map(p => p.id === 'p4' ? { ...p, name: 'New' } : p) };
    expect(reconcileWaitingClock(clock, context, renamed, 300).since.p4).toBe(100);
    expect(reconcileWaitingClock(clock, context, context, 300, { reset: true })).toEqual({ since: {} });
  });
  it('initializes after an actual start and never accrues playing or quarantined players', () => {
    const started = { ...context, liveGames: [{ slot: 1, court: 0, startedAt: 500 }], players: players.map(p => p.id === 'p4' ? { ...p, quarantined: true } : p) };
    expect(reconcileWaitingClock(undefined, context, started, 500)).toEqual({ trackingStartedAt: 500, since: { p5: 500, p6: 500, p7: 500 } });
    expect(waitingPlayerStatuses(started).filter(p => p.status === 'playing')).toHaveLength(4);
  });
  it('validates bounded timestamps', () => {
    expect(validWaitingClock({ since: { p: 10 } })).toBe(false);
    expect(validWaitingClock({ trackingStartedAt: 0, since: { p: Infinity } })).toBe(false);
    expect(validWaitingClock({ trackingStartedAt: 0, since: { p: 0 } })).toBe(true);
    expect(validWaitingClock({ trackingStartedAt: 0 })).toBe(true); // RTDB omits empty children.
    expect(waitingPlayerKey({ name: 'A.B / $[x]#' })).not.toMatch(/[./$\[\]#]/);
  });
  it('keeps bench clocks running while final-slot courts are still playing', () => {
    const clock = reconcileWaitingClock(undefined, context, context, 100, { start: true });
    const final = { ...context, liveGames: [{ slot: 3, court: 0, startedAt: 200 }] };
    expect(reconcileWaitingClock(clock, context, final, 200).since.p4).toBe(100);
    expect(waitingPlayerStatuses(final).filter(p => p.status === 'waiting')).toHaveLength(4);
  });
  it('starts tracking a legacy Finish even if no game is promoted', () => {
    const finished = { ...context, liveGames: [], completedGames: [{ slot: 1, court: 0 }] };
    expect(reconcileWaitingClock(undefined, context, finished, 300).since.p0).toBe(300);
    expect(reconcileWaitingClock(undefined, context, finished, 300).trackingStartedAt).toBe(300);
  });
});
