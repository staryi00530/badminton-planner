import type { Player } from '../algorithm/types';
import type { PlannerResult } from '../types';
import type { GameRef } from './liveQueue';
import { matchesPlayer, mergePlayedGames, type PlayedGame } from './playedHistory';

export function formatPlayingDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`
    : `${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
}

export function recordedPlayingDuration(game: PlayedGame): number | null {
  return Number.isSafeInteger(game.startedAt) && game.startedAt! >= 0 && Number.isSafeInteger(game.durationMs)
    && game.durationMs! >= 0 && game.startedAt! + game.durationMs! === game.completedAt ? game.durationMs! : null;
}

/** Completed totals exclude unknown timing; live court time is a separate provisional value. */
export function playerPlayingTimes(history: PlayedGame[], currentPlayers: Player[], live: GameRef[], result: PlannerResult | null, now: number) {
  const games = mergePlayedGames([], history);
  const seenLive = new Set<string>();
  const active = live.filter(ref => {
    const key = `${ref.slot}:${ref.court}`;
    if (seenLive.has(key)) return false;
    seenLive.add(key); return true;
  });
  const activeLineups = active.map(ref => {
    const court = result?.schedule.find(slot=>slot.slot===ref.slot)?.courts[ref.court];
    const original = court ? [...court.teamA,...court.teamB] : [];
    const lineup = (ref.players ?? original.map(player=>player.name)).flatMap(name => {
      const snapshot = original.find(player=>player.name===name);
      const matches = currentPlayers.filter(player=>[player.name,...(player.aliases ?? [])].includes(name));
      const player = snapshot ?? (matches.length === 1 ? matches[0] : undefined);
      return player ? [{id:player.id ?? `legacy:${player.name.trim().toLowerCase()}`,name:player.name,gender:player.gender}] : [];
    });
    return {ref,lineup};
  });
  const players = [...currentPlayers];
  for (const record of [...games.flatMap(game=>[...game.teamA,...game.teamB]),...activeLineups.flatMap(game=>game.lineup)]) {
    if (!players.some(current => matchesPlayer(record,current))) players.push({...record,availFrom:0,availTo:0});
  }
  return players.map(player => {
    const played = games.filter(game => [...game.teamA,...game.teamB].some(record=>matchesPlayer(record,player)));
    const durations = played.flatMap(game => { const duration = recordedPlayingDuration(game); return duration == null ? [] : [duration]; });
    const completedMs = durations.reduce((sum,duration)=>sum+duration,0);
    const liveGames = activeLineups.filter(game=>game.lineup.some(record=>matchesPlayer(record,player))).map(game=>game.ref);
    const timedLive = liveGames.filter(ref => Number.isSafeInteger(ref.startedAt) && ref.startedAt! >= 0 && ref.startedAt! <= now);
    return { player, completedMs, timedGames:durations.length, unknownGames:played.length-durations.length,
      averageMs:durations.length ? completedMs/durations.length : null,
      liveMs:timedLive.reduce((sum,ref)=>sum+now-ref.startedAt!,0), liveGames:liveGames.length,
      untimedLiveGames:liveGames.length-timedLive.length };
  });
}
