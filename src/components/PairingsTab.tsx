import { useState } from 'react';
import { C, FONT } from '../constants';
import type { Player } from '../algorithm/types';
import type { PlannerResult, ScoresMap } from '../types';
import type { GameRef } from '../utils/liveQueue';
import { calculatePairingHistory, completedGameLineup } from '../utils/pairingHistory';

interface PairingsTabProps {
  players: Player[];
  result: PlannerResult | null;
  completedGames: GameRef[];
  scores: ScoresMap;
}

function PairingList({ title, records }: { title: string; records: ReturnType<typeof calculatePairingHistory>['teammates'] }) {
  return (
    <section aria-label={title}>
      <h3 style={{ margin: '0 0 8px', color: C.text, fontSize: 14 }}>{title}</h3>
      {records.length === 0 ? <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>No games together yet.</p> : (
        <div role="list">
          {records.map(record => (
            <div role="listitem" key={record.name} style={{ borderTop: `1px solid ${C.border}`, padding: '9px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{record.name}</span>
                <span style={{ color: C.textDim, fontFamily: FONT, fontSize: 12, whiteSpace: 'nowrap' }}>
                  {record.games} {record.games === 1 ? 'game' : 'games'}
                </span>
              </div>
              <div style={{ marginTop: 3, color: C.textMuted, fontSize: 11 }}>
                Most recent: Game {record.lastGame.number} · Slot {record.lastGame.slot} · Court {record.lastGame.court + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PairingsTab({ players, result, completedGames, scores }: PairingsTabProps) {
  const names = [...new Set([
    ...players.map(player => player.name),
    ...completedGames.flatMap(game => completedGameLineup(game, result)),
  ])].sort((a, b) => a.localeCompare(b));
  const [selectedPlayer, setSelectedPlayer] = useState(() => names[0] ?? '');
  const hasSelectedPlayer = names.includes(selectedPlayer);
  const history = calculatePairingHistory(selectedPlayer, completedGames, scores, result);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <h2 style={{ margin: '0 0 6px', color: C.text, fontSize: 16 }}>Pairings</h2>
      <p style={{ margin: '0 0 16px', color: C.textDim, fontSize: 12 }}>
        Partner and opponent history from completed games.
      </p>
      <label htmlFor="pairings-player" style={{ display: 'block', marginBottom: 6, color: C.textDim, fontSize: 12, fontWeight: 600 }}>
        Find player
      </label>
      <input
        id="pairings-player"
        type="search"
        list="pairings-player-options"
        value={selectedPlayer}
        onChange={event => setSelectedPlayer(event.target.value)}
        placeholder="Search players"
        style={{ width: '100%', maxWidth: 340, boxSizing: 'border-box', padding: '9px 10px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, font: `13px ${FONT}` }}
      />
      <datalist id="pairings-player-options">
        {names.map(name => <option key={name} value={name} />)}
      </datalist>
      {!hasSelectedPlayer ? (
        <p role="status" style={{ color: C.textMuted, fontSize: 13, marginTop: 16 }}>Choose a player from the list.</p>
      ) : completedGames.length === 0 ? (
        <p style={{ color: C.textMuted, fontSize: 13, marginTop: 16 }}>Completed games will appear here.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '20px 32px', marginTop: 20 }}>
          <PairingList title="Teammates" records={history.teammates} />
          <PairingList title="Opponents" records={history.opponents} />
        </div>
      )}
    </div>
  );
}
