// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PairingsTab from './PairingsTab';

describe('PairingsTab', () => {
  const players = ['Ana', 'Bea', 'Cara', 'Drew'].map(name => ({
    name, gender: 'F' as const, availFrom: 0, availTo: 9,
  }));
  const completedGames = [
    { slot: 1, court: 0, players: ['Ana', 'Bea', 'Cara', 'Drew'] },
    { slot: 2, court: 0, players: ['Ana', 'Cara', 'Bea', 'Drew'] },
  ];

  it('shows teammate and opponent counts for the selected player', () => {
    render(<PairingsTab players={players} result={null} completedGames={completedGames} scores={{}} />);

    expect(screen.getByRole('heading', { name: 'Pairings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Find player')).toHaveValue('Ana');
    expect(within(screen.getByRole('region', { name: 'Teammates' })).getByText('Bea')).toBeInTheDocument();
    expect(screen.getAllByText('1 game')).toHaveLength(4);
    expect(screen.getByText('2 games')).toBeInTheDocument();
    expect(screen.getByText('Teammates')).toBeInTheDocument();
    expect(screen.getByText('Opponents')).toBeInTheDocument();
  });

  it('lets the user search for a player who has left the active roster', () => {
    render(<PairingsTab players={players.slice(0, 1)} result={null} completedGames={completedGames} scores={{}} />);
    const search = screen.getByLabelText('Find player');
    fireEvent.change(search, { target: { value: 'Bea' } });

    expect(within(screen.getByRole('region', { name: 'Teammates' })).getByText('Ana')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Teammates' })).getByText('Drew')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Opponents' })).getByText('Cara')).toBeInTheDocument();
  });
});
