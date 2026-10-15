import { C, FONT } from '../constants';
import type { Player } from '../algorithm/types';
import type { PlannerResult, WinLossMap } from '../types';
import type { GameRef } from '../utils/liveQueue';
import { calculatePlayerStats } from '../utils/playerStats';

interface PlayerStatsPanelProps {
  players: Player[];
  result: PlannerResult | null;
  completedGames: GameRef[];
  liveGames: GameRef[];
  winLoss: WinLossMap;
}

export default function PlayerStatsPanel({ players, result, completedGames, liveGames, winLoss }: PlayerStatsPanelProps) {
  const stats = calculatePlayerStats(players, result, completedGames, liveGames, winLoss)
    .sort((a, b) => a.gender.localeCompare(b.gender) || a.name.localeCompare(b.name));

  return (
    <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Player stats</h3>
      <p style={{ margin: '0 0 12px', color: C.textDim, fontSize: 12 }}>Actual recorded games and completed rotation rests.</p>
      {stats.length === 0 ? <p style={{ color: C.textMuted, fontSize: 13 }}>No players yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT }}>
            <thead>
              <tr style={{ color: C.textDim, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px 8px 0' }}>Player</th>
                <th style={{ padding: '6px 8px' }}>Played</th>
                <th style={{ padding: '6px 8px' }}>Rested</th>
                <th style={{ padding: '6px 8px' }}>Live</th>
                <th style={{ padding: '6px 0 8px 8px' }}>W–L</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(stat => (
                <tr key={stat.name} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 8px 8px 0', color: stat.gender === 'F' ? C.pink : C.text, fontWeight: 600 }}>{stat.name}</td>
                  <td style={{ padding: '8px', color: C.text }}>{stat.played}</td>
                  <td style={{ padding: '8px', color: C.textDim }}>{stat.rested}</td>
                  <td style={{ padding: '8px', color: stat.live > 0 ? C.accent : C.textDim }}>{stat.live}</td>
                  <td style={{ padding: '8px 0 8px 8px', color: C.textDim }}>{stat.wins}–{stat.losses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
