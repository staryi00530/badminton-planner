// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('shows immutable ledger after clear and counts renamed roster identity', () => {
    const old={id:'a',name:'Old Name',gender:'M' as const};
    const partner={id:'b',name:'B',gender:'F' as const};
    render(<PastGamesTab result={null} players={[{...old,name:'New Name',availFrom:0,availTo:9}]} completedGames={[]} liveGames={[]} scores={{}} winLoss={{}}
      playedGames={[{id:'game',planId:'p',slot:1,court:0,displayCourt:0,completedAt:1,teamA:[old,partner],teamB:[{...old,id:'c',name:'C'},{...partner,id:'d',name:'D'}],waitingIds:[],score:{a:'21',b:'19',applied:true}}]} />);
    expect(screen.getByText('Old Name · B')).toBeInTheDocument();
    expect(screen.getByText('21–19')).toBeInTheDocument();
    expect(screen.getByText(/Court 1/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Download history backup'})).toBeInTheDocument();
    expect(screen.getByText('New Name').closest('tr')?.textContent).toContain('New Name1000–0');
  });

it('exports the displayed public ledger with no current plan',()=>{
 const download=vi.fn();
 const p={id:'a',name:'A',gender:'M' as const};
 render(<PastGamesTab result={null} players={[]} completedGames={[]} liveGames={[]} scores={{}} winLoss={{}} onDownloadBackup={download}
   playedGames={[{id:'backup',planId:'old',slot:2,court:0,completedAt:4,teamA:[p,{...p,id:'b',name:'B'}],teamB:[{...p,id:'c',name:'C'},{...p,id:'d',name:'D'}],waitingIds:['waiting']}]} />);
 fireEvent.click(screen.getByRole('button',{name:'Download history backup'}));
 const backup=JSON.parse(download.mock.calls[0]![0]);
 expect(backup.playedGames[0].teamA[0]).toEqual(p);
 expect(backup.playedGames[0].waitingIds).toEqual(['waiting']);
});
