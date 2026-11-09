import type { SharePayload } from '../types';
import type { GameRef } from './liveQueue';
import { computeCourtsPerSlot } from './courtsPerSlot';
import { reconstructScheduleFromSharePayload } from './sharePayload';
import { makePlayedGame, mergePlayedGames } from './playedHistory';
import { publicPlayedGames } from './playedHistoryCodec';

export type SharedAction =
  | { type: 'finish' | 'start'; id: string; gameId: string; at?: number; displayCourt?: number; replacements?: Array<{ replacee: string; replacer: string }> }
  | { type: 'undo'; id: string; target: string; confirmDependents?: boolean };

const same = (a: GameRef, b: GameRef) => a.slot === b.slot && a.court === b.court;
function indices(data: SharePayload, game: GameRef): number[] {
  return data.slots.find(slot => slot.s === game.slot)?.c?.[game.court]?.flat() ?? [];
}

/** Stable across revisions, but changes whenever the planned lineup changes. */
export function sharedGameId(data: SharePayload, slot: number, court: number): string {
  const lineup = indices(data, { slot, court }).map(i => data.ids?.[i] ?? data.p[i]?.[0] ?? '?');
  return JSON.stringify(data.planId ? [data.planId, slot, court, lineup] : [slot, court, lineup]);
}

export function commitSharedSnapshot(current: SharePayload | null, expectedRevision: number, next: SharePayload): SharePayload | null {
  if (!current || (current.revision ?? 0) !== expectedRevision) return null;
  const decoded = reconstructScheduleFromSharePayload(current, { currentGameMinutes: 15, currentNumCourts: 1 });
  const epoch = current.historyEpoch ?? 0, nextEpoch = next.historyEpoch ?? epoch;
  const newPlan = (next.planId ?? 'legacy') !== (current.planId ?? 'legacy');
  const incoming = next.history ? publicPlayedGames(next.history) : [];
  if (nextEpoch !== epoch && !(nextEpoch === epoch + 1 && newPlan && incoming.length === 0)) return null;
  const history = nextEpoch !== epoch ? [] : mergePlayedGames(decoded.playedGames, incoming).map(game => {
    const changed = incoming.find(item => item.id === game.id);
    return changed?.score ? { ...game, score: changed.score } : game;
  });
  // Receipts outlive replaced plans so delayed requests cannot replay an undone action.
  return { ...next, history, historyEpoch: nextEpoch, actions: newPlan ? [] : current.actions ?? [], receipts: current.receipts ?? [], revision: expectedRevision + 1, schema: 3 };
}

/** Pure RTDB transaction reducer; no random IDs, side effects or client clocks. */
export function applySharedAction(current: SharePayload | null, action: SharedAction): SharePayload | null {
  if (!current) return null;
  if (current.receipts?.includes(action.id)) return current;
  const data = structuredClone(current);
  const decoded = reconstructScheduleFromSharePayload(data, { currentGameMinutes: 15, currentNumCourts: 1 });
  data.history = decoded.playedGames;
  data.historyEpoch = decoded.historyEpoch;
  let live = data.runtime?.live ?? [];
  let completed = data.runtime?.completed ?? [];
  const history = data.actions ?? [];
  const acknowledgeDuplicate = () => ({ ...current, receipts: [...(current.receipts ?? []), action.id], revision: (current.revision ?? 0) + 1 });
  const totalSlots = Math.max(1, ...data.slots.map(slot => slot.s));
  const boundary = Math.min(totalSlots, Math.max(1, ...live.map(g => g.slot + 1), ...completed.map(g => g.slot + 1)));
  const capacity = computeCourtsPerSlot({ totalSlots, gameMinutes: data.cfg?.g ?? 15, numCourts: data.cfg?.c ?? 1,
    extraCourt: data.cfg?.extraCourt ?? { enabled: false, startMin: 0, durationMin: 0 }, courtOverrides: data.cfg?.courtOverrides })[boundary - 1] ?? 1;
  const available = (game: GameRef) => {
    const roster = indices(data, game);
    return roster.length === 4 && new Set(roster).size === 4 && roster.every(i =>
      i >= 0 && i < data.p.length && !data.q?.includes(i)
      && !data.runtime?.suspended?.includes(data.p[i]![0])
      && (!data.availability?.[i] || (game.slot - 1 >= data.availability[i]!.from && game.slot - 1 <= data.availability[i]!.to)));
  };
  const hasConflict = (game: GameRef, others: GameRef[]) => {
    const roster = new Set(indices(data, game));
    return others.some(other => indices(data, other).some(i => roster.has(i)));
  };
  if (action.type === 'undo') {
    const prior = history.find(item => item.id === action.target);
    if (!prior || sharedGameId(data, prior.game.slot, prior.game.court) !== prior.gameId) return null;
    // A replacement that has already finished (or changed lineup) is a dependency.
    const promoted = prior.promoted ?? [];
    if (promoted.length && !action.confirmDependents) return null;
    if (!completed.some(game => same(game, prior.game)) || promoted.some(game => !live.some(item => same(item, game)) || game.id !== sharedGameId(data, game.slot, game.court))) return null;
    const remaining = live.filter(game => !promoted.some(item => same(item, game)));
    if (remaining.length >= capacity || hasConflict(prior.game, remaining)) return null;
    const used = new Set(remaining.map(g => g.displayCourt ?? g.court));
    const originalLane = prior.game.displayCourt ?? prior.game.court;
    const lane = originalLane < capacity && !used.has(originalLane) ? originalLane : Array.from({ length: capacity }, (_, i) => i).find(i => !used.has(i));
    if (lane == null) return null;
    live = [...remaining, { ...prior.game, displayCourt: lane }].sort((a, b) => (a.displayCourt ?? a.court) - (b.displayCourt ?? b.court));
    completed = completed.filter(game => !same(game, prior.game));
    data.actions = history.filter(item => item.id !== prior.id);
    data.history = data.history.filter(record => record.id !== prior.playedGameId && !(record.planId === (data.planId ?? 'legacy') && record.slot === prior.game.slot && record.court === prior.game.court));
  } else {
    const game = data.slots.flatMap(slot => (slot.c ?? []).map((_, court) => ({ slot: slot.s, court })))
      .find(item => sharedGameId(data, item.slot, item.court) === action.gameId);
    if (!game) return null;
    if (action.type === 'finish') {
      // Duplicate completion is a successful no-op, even with a new request ID.
      if (completed.some(item => same(item, game))) return acknowledgeDuplicate();
      const active = live.find(item => same(item, game));
      if (!active) return null;
      const played = makePlayedGame(decoded.result, decoded.players, { ...active, id: action.gameId }, decoded.scores, live, action.at ?? 0);
      if (!played) return null;
      data.history = mergePlayedGames(data.history, [played]);
      live = live.filter(item => !same(item, game));
      completed = [...completed, active];
      const next = data.slots.flatMap(slot => (slot.c ?? []).map((_, court) => ({ slot: slot.s, court })))
        .find(item => !completed.some(done => same(done, item)) && !live.some(on => same(on, item)) && available(item) && !hasConflict(item, live));
      const used = new Set(live.map(g => g.displayCourt ?? g.court));
      const finishingLane = active.displayCourt ?? active.court;
      const lane = finishingLane < capacity && !used.has(finishingLane) ? finishingLane : Array.from({ length: capacity }, (_, i) => i).find(i => !used.has(i));
      const promoted: GameRef[] = next && live.length < capacity && lane != null ? [{ ...next, id: sharedGameId(data, next.slot, next.court), displayCourt: lane, players: indices(data, next).map(i => data.p[i]![0]) }] : [];
      live = [...live, ...promoted];
      data.actions = [...history, { id: action.id, gameId: action.gameId, game: active, promoted, playedGameId: played.id }].slice(-20);
    } else {
      if (live.some(item => same(item, game))) return acknowledgeDuplicate();
      if (completed.some(item => same(item, game))) return null;
      if (action.replacements?.length) {
        const court = data.slots.find(slot => slot.s === game.slot)!.c[game.court]!;
        const original = new Set(court.flat());
        const replaced = new Set<number>();
        for (const replacement of action.replacements) {
          const oldIndex = data.p.findIndex(p => p[0] === replacement.replacee);
          const newIndex = data.p.findIndex(p => p[0] === replacement.replacer);
          if (oldIndex < 0 || newIndex < 0 || !original.has(oldIndex) || replaced.has(oldIndex)) return null;
          replaced.add(oldIndex);
          for (const team of court) for (let i = 0; i < team.length; i++) if (team[i] === oldIndex) team[i] = newIndex;
        }
        if (data.scores) delete data.scores[`s${game.slot}c${game.court}`];
      }
      if (completed.some(item => same(item, game)) || live.length >= capacity || !available(game) || hasConflict(game, live)) return null;
      const used = new Set(live.map(item => item.displayCourt ?? item.court));
      const lane = action.displayCourt ?? Array.from({ length: capacity }, (_, i) => i).find(i => !used.has(i));
      if (lane == null || lane < 0 || lane >= capacity || used.has(lane)) return null;
      const started = { ...game, id: sharedGameId(data, game.slot, game.court), displayCourt: lane, players: indices(data, game).map(i => data.p[i]![0]) };
      live = [...live, started];
      // An explicitly accepted substitution fills the free lane left by this Finish.
      const priorFinish = [...history].reverse().find(item => (item.game.displayCourt ?? item.game.court) === lane && !(item.promoted?.length) && completed.some(done => same(done, item.game)));
      if (priorFinish) data.actions = history.map(item => item.id === priorFinish.id ? { ...item, promoted: [started] } : item);
    }
  }
  data.runtime = { ...data.runtime, live, completed };
  // Keep request receipts after Undo so a delayed retry cannot repeat an undone Finish.
  data.receipts = [...(data.receipts ?? []), action.id].slice(-1000);
  data.revision = (current.revision ?? 0) + 1;
  data.schema = 3;
  return data;
}
