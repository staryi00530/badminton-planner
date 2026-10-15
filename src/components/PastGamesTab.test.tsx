// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PastGamesTab from './PastGamesTab';

describe('PastGamesTab', () => {
  it('shows the recorded lineup snapshot instead of a regenerated schedule lineup', () => {
    const { container } = render(
      <PastGamesTab
        players={[
          { name: 'Played A', gender: 'M', availFrom: 0, availTo: 9 },
          { name: 'Played B', gender: 'M', availFrom: 0, availTo: 9 },
          { name: 'Played C', gender: 'M', availFrom: 0, availTo: 9 },
          { name: 'Played D', gender: 'M', availFrom: 0, availTo: 9 },
        ]}
        result={{
          schedule: [{
            slot: 1,
            courts: [{
              court: 1,
              teamA: [{ name: 'Later A', gender: 'M' }, { name: 'Later B', gender: 'M' }],
              teamB: [{ name: 'Later C', gender: 'M' }, { name: 'Later D', gender: 'M' }],
            }],
            sitting: [],
            repeatedCourts: [],
            playerState: [],
          }],
          gamesPlayed: [],
        }}
        completedGames={[{ slot: 1, court: 0, players: ['Played A', 'Played B', 'Played C', 'Played D'] }]}
        liveGames={[]}
        scores={{ 's1c0': { a: '21', b: '18', applied: true, teamA: ['Played A', 'Played B'], teamB: ['Played C', 'Played D'] } }}
        winLoss={{}}
      />
    );

    expect(container.textContent).toContain('Played A · Played B');
    expect(screen.getByText('21–18')).toBeInTheDocument();
    expect(screen.queryByText('Later A · Later B')).not.toBeInTheDocument();
  });
});
