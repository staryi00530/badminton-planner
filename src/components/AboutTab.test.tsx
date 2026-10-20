// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AboutTab from './AboutTab';

describe('How it works', () => {
  it('explains the live game, queue, and mid-session actions', () => {
    render(<AboutTab />);

    expect(screen.getByRole('heading', { name: 'Keep Games Moving' })).toBeInTheDocument();
    expect(screen.getByText(/Any player can mark.*finished with Finish game/i)).toBeInTheDocument();
    expect(screen.getByText(/substitute unavailable players.*playable queued game/i)).toBeInTheDocument();
    expect(screen.getByText(/Here now.*Leaving.*Add court.*Remove court/i)).toBeInTheDocument();
    expect(screen.getByText(/Suspend a player/i)).toBeInTheDocument();
    expect(screen.getByText(/Undo last action/i)).toBeInTheDocument();
    expect(screen.getByText(/Past games.*player stats/i)).toBeInTheDocument();
  });

  it('describes private levels and preferred pairings as scheduler preferences, not guarantees', () => {
    render(<AboutTab />);

    const section = screen.getByRole('heading', { name: /How Matchups Are Made/i }).parentElement!;
    expect(within(section).getByText(/preferred pairings/i)).toBeInTheDocument();
    expect(within(section).getByText(/private skill settings/i)).toBeInTheDocument();
    expect(within(section).getByText(/scheduling goals, not guarantees.*repeats or level gaps can still happen/i)).toBeInTheDocument();
  });
});
