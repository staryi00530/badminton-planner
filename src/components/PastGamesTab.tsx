import { C, FONT } from '../constants';
import type { PlannerResult, ScoresMap } from '../types';
import type { GameRef } from '../utils/liveQueue';

interface PastGamesTabProps {
  result: PlannerResult | null;
  completedGames: GameRef[];
  scores: ScoresMap;
}

export default function PastGamesTab({ result, completedGames, scores }: PastGamesTabProps) {
  const games = completedGames.map((ref, index) => {
    const court = result?.schedule.find(slot => slot.slot === ref.slot)?.courts[ref.court];
    const players = ref.players ?? (court ? [...court.teamA, ...court.teamB].map(player => player.name) : []);
    return { ...ref, index, players, score: scores[`s${ref.slot}c${ref.court}`] };
  });

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Past games</h2>
      <p style={{ margin: '0 0 16px', color: C.textDim, fontSize: 12 }}>Completed games in the order they were recorded.</p>
      {games.length === 0 ? <p style={{ color: C.textMuted, fontSize: 13 }}>No completed games yet.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {games.map(game => (
            <div key={`${game.slot}-${game.court}-${game.index}`} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textDim, fontSize: 11, fontFamily: FONT, fontWeight: 700 }}>
                <span>Game {game.index + 1} · Slot {game.slot} · Court {game.court + 1}</span>
                {game.score?.applied && <span>{game.score.a}–{game.score.b}</span>}
              </div>
              <div style={{ marginTop: 6, fontSize: 14, color: C.text }}>
                {game.players.slice(0, 2).join(' · ')} <span style={{ color: C.textMuted }}>VS</span> {game.players.slice(2, 4).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
